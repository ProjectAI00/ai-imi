import { useEffect, useMemo, useState, Component, ReactNode } from "react"
import { Provider as JotaiProvider, useAtomValue, useSetAtom } from "jotai"
import { ThemeProvider } from "next-themes"
import { TRPCProvider } from "./contexts/TRPCProvider"
import { AgentsLayout } from "./features/layout/agents-layout"
import {
  AnthropicOnboardingPage,
  SelectRepoPage,
} from "./features/onboarding"
import { TooltipProvider } from "./components/ui/tooltip"
import { appStore } from "./lib/jotai-store"
import { initAnalytics, identify, shutdown } from "./lib/analytics"
import { VSCodeThemeProvider } from "./lib/themes/theme-provider"
import { anthropicOnboardingCompletedAtom } from "./lib/atoms"
import { selectedProjectAtom } from "./features/agents/atoms"
import { trpc } from "./lib/trpc"

// Timeout for loading state (in milliseconds)
const LOADING_TIMEOUT_MS = 5000

// Error boundary to catch React errors and prevent blank screen
interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: any) {
    console.error("[App] React Error Boundary caught:", error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="h-screen w-screen flex items-center justify-center bg-background text-foreground p-8">
          <div className="max-w-md text-center">
            <h1 className="text-xl font-semibold mb-4">Something went wrong</h1>
            <p className="text-muted-foreground mb-4">
              {this.state.error?.message || "An unexpected error occurred"}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:opacity-90"
            >
              Reload App
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

/**
 * Main content router - decides which page to show based on onboarding state
 */
function AppContent() {
  const anthropicOnboardingCompleted = useAtomValue(
    anthropicOnboardingCompletedAtom
  )
  const selectedProject = useAtomValue(selectedProjectAtom)
  const setSelectedProject = useSetAtom(selectedProjectAtom)

  // Fetch projects to validate selectedProject exists
  const { data: projects, isLoading: isLoadingProjects, isError } =
    trpc.projects.list.useQuery(undefined, {
      // Retry once with short delay, then give up
      retry: 1,
      retryDelay: 500,
    })

  // Fetch default project for auto-selection (always fetch to have it ready)
  const { data: defaultProject } = trpc.projects.getDefault.useQuery()

  // Loading timeout - if tRPC query takes too long, show select repo page
  const [hasTimedOut, setHasTimedOut] = useState(false)
  useEffect(() => {
    if (isLoadingProjects && !hasTimedOut) {
      const timer = setTimeout(() => {
        console.warn("[App] Loading timeout reached, showing SelectRepoPage")
        setHasTimedOut(true)
      }, LOADING_TIMEOUT_MS)
      return () => clearTimeout(timer)
    }
  }, [isLoadingProjects, hasTimedOut])

  // Validated project - only valid if exists in DB
  const validatedProject = useMemo(() => {
    if (!selectedProject) return null
    // While loading (and not timed out), trust localStorage value to prevent flicker
    if (isLoadingProjects && !hasTimedOut && !isError) return selectedProject
    // After loading, validate against DB
    if (!projects) return null
    const exists = projects.some((p) => p.id === selectedProject.id)
    return exists ? selectedProject : null
  }, [selectedProject, projects, isLoadingProjects, hasTimedOut, isError])

  // Auto-select default project when no valid project is selected
  useEffect(() => {
    // Only auto-select after loading is complete and we have no valid project
    if (isLoadingProjects || hasTimedOut || isError) return
    if (validatedProject) return // Already have a valid project
    if (!defaultProject) return // No default project available
    
    console.log("[App] Auto-selecting default project:", defaultProject.id)
    setSelectedProject({
      id: defaultProject.id,
      name: defaultProject.name,
      path: defaultProject.path,
      gitRemoteUrl: defaultProject.gitRemoteUrl,
      gitProvider: defaultProject.gitProvider as "github" | "gitlab" | "bitbucket" | null,
      gitOwner: defaultProject.gitOwner,
      gitRepo: defaultProject.gitRepo,
    })
  }, [validatedProject, defaultProject, isLoadingProjects, hasTimedOut, isError, setSelectedProject])

  // Log state for debugging
  useEffect(() => {
    console.log("[AppContent] State:", {
      anthropicOnboardingCompleted,
      selectedProject: selectedProject?.id,
      validatedProject: validatedProject?.id,
      defaultProject: defaultProject?.id,
      isLoadingProjects,
      isError,
      hasTimedOut,
      projectsCount: projects?.length,
    })
  }, [anthropicOnboardingCompleted, selectedProject, validatedProject, defaultProject, isLoadingProjects, isError, hasTimedOut, projects])

  // Determine which page to show:
  // 1. Anthropic onboarding not completed -> AnthropicOnboardingPage
  // 2. No valid project selected (or loading timed out / errored) -> SelectRepoPage
  // 3. Otherwise -> AgentsLayout
  if (!anthropicOnboardingCompleted) {
    return <AnthropicOnboardingPage />
  }

  // While loading, show nothing to prevent flicker
  if (isLoadingProjects && !hasTimedOut) {
    return null
  }

  if (!validatedProject && (!isLoadingProjects || hasTimedOut || isError)) {
    return <SelectRepoPage />
  }

  return <AgentsLayout />
}

export function App() {
  // Initialize analytics on mount
  useEffect(() => {
    initAnalytics()

    // Sync analytics opt-out status to main process
    const syncOptOutStatus = async () => {
      try {
        const optOut =
          localStorage.getItem("preferences:analytics-opt-out") === "true"
        await window.desktopApi?.setAnalyticsOptOut(optOut)
      } catch (error) {
        console.warn("[Analytics] Failed to sync opt-out status:", error)
      }
    }
    syncOptOutStatus()

    // Identify user if already authenticated
    const identifyUser = async () => {
      try {
        const user = await window.desktopApi?.getUser()
        if (user?.id) {
          identify(user.id, { email: user.email, name: user.name })
        }
      } catch (error) {
        console.warn("[Analytics] Failed to identify user:", error)
      }
    }
    identifyUser()

    // Cleanup on unmount
    return () => {
      shutdown()
    }
  }, [])

  return (
    <ErrorBoundary>
      <JotaiProvider store={appStore}>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <VSCodeThemeProvider>
            <TooltipProvider delayDuration={100}>
              <TRPCProvider>
                <div
                  data-agents-page
                  className="h-screen w-screen bg-background text-foreground overflow-hidden"
                >
                  <AppContent />
                </div>
              </TRPCProvider>
            </TooltipProvider>
          </VSCodeThemeProvider>
        </ThemeProvider>
      </JotaiProvider>
    </ErrorBoundary>
  )
}
