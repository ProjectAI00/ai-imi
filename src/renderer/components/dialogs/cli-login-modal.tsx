"use client"

import { useAtom } from "jotai"
import { useState, useEffect, useRef } from "react"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogCancel,
} from "../ui/alert-dialog"
import { X, ExternalLink, RefreshCw } from "lucide-react"
import { IconSpinner, CursorIcon, GitHubLogo } from "../ui/icons"
import { Button } from "../ui/button"
import { cliLoginModalAtom } from "../../lib/atoms"
import { pendingAuthRetryMessageAtom } from "../../features/agents/atoms"
import { appStore } from "../../lib/jotai-store"
import { trpc } from "../../lib/trpc"

type AuthFlowState =
  | { step: "idle" }
  | { step: "launching" }
  | { step: "waiting"; oauthUrl?: string }
  | { step: "checking" }
  | { step: "success" }
  | { step: "error"; message: string }

// CLI-specific configuration
const CLI_CONFIG = {
  cursor: {
    name: "Cursor",
    description: "Connect your Cursor subscription to continue",
    color: "#000000",
    iconType: "cursor" as const,
  },
  copilot: {
    name: "GitHub Copilot",
    description: "Connect your GitHub Copilot subscription to continue",
    color: "#000000",
    iconType: "github" as const,
  },
  codex: {
    name: "OpenAI Codex",
    description: "Connect your OpenAI account to continue",
    color: "#10a37f",
    iconType: "codex" as const,
  },
  amp: {
    name: "AMP",
    description: "Connect your AMP account to continue",
    color: "#6366f1",
    iconType: "emoji" as const,
    emoji: "⚡",
  },
  droid: {
    name: "Droid",
    description: "Connect your Factory AI account to continue",
    color: "#10b981",
    iconType: "emoji" as const,
    emoji: "🤖",
  },
  opencode: {
    name: "OpenCode",
    description: "Connect your OpenCode account to continue",
    color: "#3b82f6",
    iconType: "emoji" as const,
    emoji: "🔓",
  },
} as const

// Codex/OpenAI icon
const CodexIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
    <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08-4.778 2.758a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z" />
  </svg>
)

export function CliLoginModal() {
  const [state, setState] = useAtom(cliLoginModalAtom)
  const [flowState, setFlowState] = useState<AuthFlowState>({ step: "idle" })
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null)

  const cli = state.cli
  const config = cli ? CLI_CONFIG[cli] : null

  // tRPC mutations
  const startCursorAuth = trpc.cliAuth.startCursorAuth.useMutation()
  const startCopilotAuth = trpc.cliAuth.startCopilotAuth.useMutation()
  const startCodexAuth = trpc.cliAuth.startCodexAuth.useMutation()
  const openAuthUrl = trpc.cliAuth.openAuthUrl.useMutation()
  const checkAuthQuery = trpc.cliAuth.checkAuthStatus.useQuery(
    { cli: cli as "cursor" | "copilot" | "codex" },
    { enabled: false }
  )

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

  const handleLoginClick = async () => {
    if (!cli || !config) return

    setFlowState({ step: "launching" })

    try {
      let result: { oauthUrl?: string | null; needsManualAuth?: boolean; alreadyAuthenticated?: boolean }
      
      // Start the appropriate auth flow
      if (cli === "cursor") {
        result = await startCursorAuth.mutateAsync()
      } else if (cli === "copilot") {
        result = await startCopilotAuth.mutateAsync()
      } else if (cli === "codex") {
        result = await startCodexAuth.mutateAsync()
      } else {
        throw new Error(`Unsupported CLI: ${cli}`)
      }
      
      console.log(`[CliLoginModal] ${cli} auth result:`, result)
      
      // If already authenticated, success!
      if (result.alreadyAuthenticated) {
        setFlowState({ step: "success" })
        setTimeout(() => {
          triggerAuthRetry()
          setState({ open: false, cli: null })
        }, 1000)
        return
      }
      
      // Open the OAuth URL in browser
      if (result.oauthUrl) {
        await openAuthUrl.mutateAsync({ url: result.oauthUrl })
      }
      
      setFlowState({ step: "waiting", oauthUrl: result.oauthUrl || undefined })

      // Start polling for auth completion
      let attempts = 0
      const maxAttempts = 60 // 2 minutes max wait

      pollIntervalRef.current = setInterval(async () => {
        attempts++
        
        try {
          const status = await checkAuthQuery.refetch()
          
          if (status.data?.isAuthenticated) {
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
            // Keep waiting state - user can manually click "I've logged in"
          }
        } catch (err) {
          console.error(`[CliLoginModal] Error checking auth status:`, err)
        }
      }, 2000) // Check every 2 seconds
    } catch (err) {
      console.error(`[CliLoginModal] Error starting auth:`, err)
      setFlowState({
        step: "error",
        message: err instanceof Error ? err.message : "Failed to start authentication",
      })
    }
  }

  const handleRetryCheck = async () => {
    setFlowState({ step: "checking" })
    
    try {
      const status = await checkAuthQuery.refetch()
      
      if (status.data?.isAuthenticated) {
        setFlowState({ step: "success" })
        setTimeout(() => {
          triggerAuthRetry()
          setState({ open: false, cli: null })
        }, 1000)
      } else {
        setFlowState({ step: "waiting" })
      }
    } catch {
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

  // Render the appropriate icon based on CLI type
  const renderIcon = () => {
    switch (config.iconType) {
      case "cursor":
        return <CursorIcon className="w-8 h-8 text-white" />
      case "github":
        return <GitHubLogo className="w-8 h-8 text-white" />
      case "codex":
        return <CodexIcon className="w-8 h-8 text-white" />
      case "emoji":
        return <span className="text-2xl">{(config as any).emoji}</span>
      default:
        return null
    }
  }

  return (
    <AlertDialog open={state.open} onOpenChange={handleOpenChange}>
      <AlertDialogContent className="w-[380px] p-6">
        {/* Close button */}
        <AlertDialogCancel className="absolute right-4 top-4 h-6 w-6 p-0 border-0 bg-transparent hover:bg-muted rounded-sm opacity-70 hover:opacity-100">
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </AlertDialogCancel>

        <div className="space-y-8">
          {/* Header with single icon */}
          <div className="text-center space-y-4">
            <div 
              className="flex items-center justify-center p-4 mx-auto w-max rounded-full"
              style={{ backgroundColor: config.color }}
            >
              {renderIcon()}
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
                Connect
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
