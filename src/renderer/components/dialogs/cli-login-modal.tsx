"use client"

import { useAtom } from "jotai"
import { useState, useEffect, useRef } from "react"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogCancel,
} from "../ui/alert-dialog"
import { X, ExternalLink, RefreshCw } from "lucide-react"
import { IconSpinner } from "../ui/icons"
import { Button } from "../ui/button"
import { Logo } from "../ui/logo"
import { cliLoginModalAtom } from "../../lib/atoms"
import { pendingAuthRetryMessageAtom } from "../../features/agents/atoms"
import { appStore } from "../../lib/jotai-store"

type AuthFlowState =
  | { step: "idle" }
  | { step: "launching" }
  | { step: "waiting" }
  | { step: "checking" }
  | { step: "success" }
  | { step: "error"; message: string }

// CLI-specific configuration
const CLI_CONFIG = {
  amp: {
    name: "AMP",
    loginCommand: "amp login",
    description: "Connect your AMP account to continue",
    checkCommand: "amp threads list",
    color: "#6366f1", // Indigo
    icon: "⚡",
  },
  droid: {
    name: "Droid",
    loginCommand: "droid",
    description: "Connect your Factory AI account to continue",
    checkCommand: "droid exec --help",
    color: "#10b981", // Emerald
    icon: "🤖",
  },
  cursor: {
    name: "Cursor",
    loginCommand: "cursor --login",
    description: "Connect your Cursor subscription to continue",
    checkCommand: "cursor --version",
    color: "#f59e0b", // Amber
    icon: "📝",
  },
  opencode: {
    name: "OpenCode",
    loginCommand: "opencode auth login",
    description: "Connect your OpenCode account to continue",
    checkCommand: "opencode auth status",
    color: "#3b82f6", // Blue
    icon: "🔓",
  },
} as const

export function CliLoginModal() {
  const [state, setState] = useAtom(cliLoginModalAtom)
  const [flowState, setFlowState] = useState<AuthFlowState>({ step: "idle" })
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null)

  const cli = state.cli
  const config = cli ? CLI_CONFIG[cli] : null

  // Reset state when modal closes
  useEffect(() => {
    if (!state.open) {
      setFlowState({ step: "idle" })
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
        pollIntervalRef.current = null
      }
    }
  }, [state.open])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
      }
    }
  }, [])

  // Helper to trigger retry after successful auth
  const triggerAuthRetry = () => {
    const pending = appStore.get(pendingAuthRetryMessageAtom)
    if (pending) {
      console.log(`[CliLoginModal] ${cli} auth success - triggering retry for subChatId:`, pending.subChatId)
      appStore.set(pendingAuthRetryMessageAtom, { ...pending, readyToRetry: true })
    }
  }

  // Helper to clear pending retry (on cancel/close without success)
  const clearPendingRetry = () => {
    const pending = appStore.get(pendingAuthRetryMessageAtom)
    if (pending && !pending.readyToRetry) {
      console.log(`[CliLoginModal] Modal closed without success - clearing pending retry`)
      appStore.set(pendingAuthRetryMessageAtom, null)
    }
  }

  // Check auth status by running a simple CLI command
  const checkAuthStatus = async (): Promise<boolean> => {
    if (!cli || !config) return false
    
    try {
      // Use the desktopApi to run a command and check if it succeeds
      const result = await window.desktopApi.runCommand(config.checkCommand)
      // If the command succeeds without auth error, user is authenticated
      return result.exitCode === 0 && !result.stderr?.toLowerCase().includes("auth")
    } catch {
      return false
    }
  }

  const handleLoginClick = async () => {
    if (!cli || !config) return

    setFlowState({ step: "launching" })

    try {
      // Open the login command - this will open the browser for OAuth
      await window.desktopApi.openLoginFlow(cli)
      
      setFlowState({ step: "waiting" })

      // Start polling for auth completion
      let attempts = 0
      const maxAttempts = 60 // 2 minutes max wait

      pollIntervalRef.current = setInterval(async () => {
        attempts++
        setFlowState({ step: "checking" })

        const isAuthenticated = await checkAuthStatus()
        
        if (isAuthenticated) {
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current)
            pollIntervalRef.current = null
          }
          setFlowState({ step: "success" })
          
          // Wait a moment to show success, then close and retry
          setTimeout(() => {
            triggerAuthRetry()
            setState({ open: false, cli: null })
          }, 1000)
        } else if (attempts >= maxAttempts) {
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current)
            pollIntervalRef.current = null
          }
          setFlowState({ step: "waiting" })
        } else {
          setFlowState({ step: "waiting" })
        }
      }, 2000) // Check every 2 seconds
    } catch (err) {
      setFlowState({
        step: "error",
        message: err instanceof Error ? err.message : "Failed to start authentication",
      })
    }
  }

  const handleRetryCheck = async () => {
    setFlowState({ step: "checking" })
    const isAuthenticated = await checkAuthStatus()
    
    if (isAuthenticated) {
      setFlowState({ step: "success" })
      setTimeout(() => {
        triggerAuthRetry()
        setState({ open: false, cli: null })
      }, 1000)
    } else {
      setFlowState({ step: "waiting" })
    }
  }

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      clearPendingRetry()
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
        pollIntervalRef.current = null
      }
    }
    setState({ open, cli: open ? state.cli : null })
  }

  if (!config) return null

  const isLoading = flowState.step === "launching" || flowState.step === "checking"
  const isWaiting = flowState.step === "waiting"
  const isSuccess = flowState.step === "success"

  return (
    <AlertDialog open={state.open} onOpenChange={handleOpenChange}>
      <AlertDialogContent className="w-[380px] p-6">
        {/* Close button */}
        <AlertDialogCancel className="absolute right-4 top-4 h-6 w-6 p-0 border-0 bg-transparent hover:bg-muted rounded-sm opacity-70 hover:opacity-100">
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </AlertDialogCancel>

        <div className="space-y-8">
          {/* Header with icons */}
          <div className="text-center space-y-4">
            <div className="flex items-center justify-center gap-2 p-2 mx-auto w-max rounded-full border border-border">
              <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center">
                <Logo className="w-5 h-5" fill="white" />
              </div>
              <div 
                className="w-10 h-10 rounded-full flex items-center justify-center text-xl"
                style={{ backgroundColor: config.color }}
              >
                {config.icon}
              </div>
            </div>
            <div className="space-y-1">
              <h1 className="text-base font-semibold tracking-tight">
                {config.name}
              </h1>
              <p className="text-sm text-muted-foreground">
                {config.description}
              </p>
            </div>
          </div>

          {/* Content */}
          <div className="space-y-6">
            {/* Initial state - Login button */}
            {flowState.step === "idle" && (
              <Button onClick={handleLoginClick} className="w-full">
                <ExternalLink className="h-4 w-4 mr-2" />
                Open {config.name} Login
              </Button>
            )}

            {/* Loading state */}
            {isLoading && (
              <div className="flex flex-col items-center gap-4">
                <IconSpinner className="h-8 w-8" />
                <p className="text-sm text-muted-foreground">
                  {flowState.step === "launching" ? "Opening browser..." : "Checking authentication..."}
                </p>
              </div>
            )}

            {/* Waiting for auth */}
            {isWaiting && (
              <div className="space-y-4">
                <div className="p-4 bg-muted rounded-lg text-center">
                  <p className="text-sm text-muted-foreground mb-3">
                    Complete authentication in your browser, then click below.
                  </p>
                  <Button onClick={handleRetryCheck} variant="secondary" className="w-full">
                    <RefreshCw className="h-4 w-4 mr-2" />
                    I've logged in
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground text-center">
                  Or run <code className="px-1 py-0.5 bg-muted rounded">{config.loginCommand}</code> in your terminal
                </p>
              </div>
            )}

            {/* Success state */}
            {isSuccess && (
              <div className="flex flex-col items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center">
                  <span className="text-2xl">✓</span>
                </div>
                <p className="text-sm text-green-600 dark:text-green-400">
                  Successfully authenticated!
                </p>
              </div>
            )}

            {/* Error state */}
            {flowState.step === "error" && (
              <div className="space-y-4">
                <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
                  <p className="text-sm text-destructive">{flowState.message}</p>
                </div>
                <Button
                  variant="secondary"
                  onClick={handleLoginClick}
                  className="w-full"
                >
                  Try Again
                </Button>
              </div>
            )}
          </div>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  )
}
