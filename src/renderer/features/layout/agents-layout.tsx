import { useCallback, useEffect, useState, useMemo } from "react"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { isDesktopApp } from "../../lib/utils/platform"
import { useIsMobile } from "../../lib/hooks/use-mobile"

import {
  agentsSidebarOpenAtom,
  agentsSidebarWidthAtom,
  agentsSettingsDialogOpenAtom,
  agentsSettingsDialogActiveTabAtom,
  agentsShortcutsDialogOpenAtom,
  isDesktopAtom,
  isFullscreenAtom,
  anthropicOnboardingCompletedAtom,
  navViewModeAtom,
  selectedWorkspaceAtom,
  type NavViewMode,
  type SelectedWorkspace,
} from "../../lib/atoms"
import { selectedAgentChatIdAtom, selectedProjectAtom } from "../agents/atoms"
import { trpc } from "../../lib/trpc"
import { useAgentsHotkeys } from "../agents/lib/agents-hotkeys-manager"
import { AgentsSettingsDialog } from "../../components/dialogs/agents-settings-dialog"
import { AgentsShortcutsDialog } from "../../components/dialogs/agents-shortcuts-dialog"
import { ClaudeLoginModal } from "../../components/dialogs/claude-login-modal"
import { CliLoginModal } from "../../components/dialogs/cli-login-modal"
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from "../../components/ui/tooltip"
import { ResizableSidebar } from "../../components/ui/resizable-sidebar"
import { AgentsSidebar } from "../sidebar/agents-sidebar"
import { TasksSidebar } from "../sidebar/tasks-sidebar"
import { AgentsContent } from "../agents/ui/agents-content"
import { UpdateBanner } from "../../components/update-banner"
import { useUpdateChecker } from "../../lib/hooks/use-update-checker"
import { useAgentSubChatStore } from "../../lib/stores/sub-chat-store"
import { cn } from "../../lib/utils"
import { IconChatBubble, CheckIcon, SettingsIcon, PlusIcon } from "../../components/ui/icons"

// ============================================================================
// Constants
// ============================================================================

const SIDEBAR_MIN_WIDTH = 160
const SIDEBAR_MAX_WIDTH = 300
const SIDEBAR_ANIMATION_DURATION = 0
const SIDEBAR_CLOSE_HOTKEY = "⌘\\"

// ============================================================================
// Component
// ============================================================================

export function AgentsLayout() {
  // No useHydrateAtoms - desktop doesn't need SSR, atomWithStorage handles persistence
  const isMobile = useIsMobile()

  // Global desktop/fullscreen state - initialized here at root level
  const [isDesktop, setIsDesktop] = useAtom(isDesktopAtom)
  const [, setIsFullscreen] = useAtom(isFullscreenAtom)

  // Initialize isDesktop on mount
  useEffect(() => {
    setIsDesktop(isDesktopApp())
  }, [setIsDesktop])

  // Subscribe to fullscreen changes from Electron
  useEffect(() => {
    if (
      !isDesktop ||
      typeof window === "undefined" ||
      !window.desktopApi?.windowIsFullscreen
    )
      return

    // Get initial fullscreen state
    window.desktopApi.windowIsFullscreen().then(setIsFullscreen)

    // In dev mode, HMR breaks IPC event subscriptions, so we poll instead
    const isDev = import.meta.env.DEV
    if (isDev) {
      const interval = setInterval(() => {
        window.desktopApi?.windowIsFullscreen?.().then(setIsFullscreen)
      }, 300)
      return () => clearInterval(interval)
    }

    // In production, use events (more efficient)
    const unsubscribe = window.desktopApi.onFullscreenChange?.(setIsFullscreen)
    return unsubscribe
  }, [isDesktop, setIsFullscreen])

  // Check for updates on mount and periodically
  useUpdateChecker()

  const [sidebarOpen, setSidebarOpen] = useAtom(agentsSidebarOpenAtom)
  const [sidebarWidth, setSidebarWidth] = useAtom(agentsSidebarWidthAtom)
  const [settingsOpen, setSettingsOpen] = useAtom(agentsSettingsDialogOpenAtom)
  const setSettingsActiveTab = useSetAtom(agentsSettingsDialogActiveTabAtom)
  const [shortcutsOpen, setShortcutsOpen] = useAtom(
    agentsShortcutsDialogOpenAtom,
  )
  const [selectedChatId, setSelectedChatId] = useAtom(selectedAgentChatIdAtom)
  const [selectedProject, setSelectedProject] = useAtom(selectedProjectAtom)
  const [navViewMode, setNavViewMode] = useAtom(navViewModeAtom)
  const [selectedWorkspace, setSelectedWorkspace] = useAtom(selectedWorkspaceAtom)
  const setAnthropicOnboardingCompleted = useSetAtom(
    anthropicOnboardingCompletedAtom
  )

  // Fetch workspaces for workspace switcher
  const { data: workspaces } = trpc.workspaces.list.useQuery()
  const { data: defaultWorkspace } = trpc.workspaces.getDefault.useQuery()

  // Auto-select default workspace if none selected
  useEffect(() => {
    if (!selectedWorkspace && defaultWorkspace) {
      setSelectedWorkspace({
        id: defaultWorkspace.id,
        name: defaultWorkspace.name,
        color: defaultWorkspace.color,
        icon: defaultWorkspace.icon,
      })
    }
  }, [selectedWorkspace, defaultWorkspace, setSelectedWorkspace])

  // Fetch projects to validate selectedProject exists
  const { data: projects, isLoading: isLoadingProjects } =
    trpc.projects.list.useQuery()

  // Validated project - only valid if exists in DB
  // While loading, trust localStorage value to prevent clearing on app restart
  const validatedProject = useMemo(() => {
    if (!selectedProject) return null
    // While loading, trust localStorage value to prevent flicker and clearing
    if (isLoadingProjects) return selectedProject
    // After loading, validate against DB
    if (!projects) return null
    const exists = projects.some((p) => p.id === selectedProject.id)
    return exists ? selectedProject : null
  }, [selectedProject, projects, isLoadingProjects])

  // Clear invalid project from storage (only after loading completes)
  useEffect(() => {
    if (
      selectedProject &&
      projects &&
      !isLoadingProjects &&
      !validatedProject
    ) {
      setSelectedProject(null)
    }
  }, [
    selectedProject,
    projects,
    isLoadingProjects,
    validatedProject,
    setSelectedProject,
  ])

  // Hide native traffic lights when sidebar is closed (no traffic lights needed when sidebar is closed)
  useEffect(() => {
    if (!isDesktop) return
    if (
      typeof window === "undefined" ||
      !window.desktopApi?.setTrafficLightVisibility
    )
      return

    // When sidebar is closed, hide native traffic lights
    // When sidebar is open, TrafficLights component handles visibility
    if (!sidebarOpen) {
      window.desktopApi.setTrafficLightVisibility(false)
    }
  }, [sidebarOpen, isDesktop])
  const setChatId = useAgentSubChatStore((state) => state.setChatId)

  // Desktop user state
  const [desktopUser, setDesktopUser] = useState<{
    id: string
    email: string
    name: string | null
    imageUrl: string | null
    username: string | null
  } | null>(null)

  // Fetch desktop user on mount
  useEffect(() => {
    async function fetchUser() {
      if (window.desktopApi?.getUser) {
        const user = await window.desktopApi.getUser()
        setDesktopUser(user)
      }
    }
    fetchUser()
  }, [])

  // Auto-open sidebar when project is selected, close when no project
  // Only act after projects have loaded to avoid closing sidebar during initial load
  useEffect(() => {
    if (!projects) return // Don't change sidebar state while loading

    if (validatedProject) {
      setSidebarOpen(true)
    } else {
      setSidebarOpen(false)
    }
  }, [validatedProject, projects, setSidebarOpen])

  // Handle sign out
  const handleSignOut = useCallback(async () => {
    // Clear selected project and anthropic onboarding on logout
    setSelectedProject(null)
    setSelectedChatId(null)
    setAnthropicOnboardingCompleted(false)
    if (window.desktopApi?.logout) {
      await window.desktopApi.logout()
    }
  }, [setSelectedProject, setSelectedChatId, setAnthropicOnboardingCompleted])

  // Initialize sub-chats when chat is selected
  useEffect(() => {
    if (selectedChatId) {
      setChatId(selectedChatId)
    } else {
      setChatId(null)
    }
  }, [selectedChatId, setChatId])

  // Initialize hotkeys manager
  useAgentsHotkeys({
    setSelectedChatId,
    setSidebarOpen,
    setSettingsDialogOpen: setSettingsOpen,
    setSettingsActiveTab,
    setShortcutsDialogOpen: setShortcutsOpen,
    selectedChatId,
  })

  const handleCloseSidebar = useCallback(() => {
    setSidebarOpen(false)
  }, [setSidebarOpen])

  return (
    <TooltipProvider delayDuration={300}>
      <AgentsSettingsDialog
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
      <AgentsShortcutsDialog
        isOpen={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
      />
      <ClaudeLoginModal />
      <CliLoginModal />
      <div className="flex w-full h-full relative overflow-hidden bg-shell select-none p-1.5 gap-1.5">
        {/* Workspace Switcher Rail */}
        <div className="flex flex-col items-center w-12 pt-1.5 pb-1.5 gap-1 flex-shrink-0">
          {/* Workspace icons */}
          {workspaces?.map((workspace) => {
            const isSelected = selectedWorkspace?.id === workspace.id
            const initial = workspace.name.charAt(0).toUpperCase()
            return (
              <Tooltip key={workspace.id}>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setSelectedWorkspace({
                      id: workspace.id,
                      name: workspace.name,
                      color: workspace.color,
                      icon: workspace.icon,
                    })}
                    className={cn(
                      "w-10 h-10 rounded-xl flex items-center justify-center text-sm font-medium transition-all",
                      isSelected
                        ? "bg-primary text-primary-foreground ring-2 ring-primary/50"
                        : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                    style={workspace.color && !isSelected ? { backgroundColor: workspace.color + '20', color: workspace.color } : undefined}
                  >
                    {workspace.icon || initial}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">{workspace.name}</TooltipContent>
              </Tooltip>
            )
          })}
          
          {/* Add workspace button */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => {
                  // TODO: Open create workspace dialog
                }}
                className="w-10 h-10 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors border-2 border-dashed border-muted-foreground/30 hover:border-muted-foreground/50"
              >
                <PlusIcon className="w-5 h-5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">New Workspace</TooltipContent>
          </Tooltip>
          
          <div className="flex-1" />
          
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setSettingsOpen(true)}
                className="w-9 h-9 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors"
              >
                <SettingsIcon className="w-5 h-5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Settings</TooltipContent>
          </Tooltip>
        </div>

        {/* Left Sidebar (Agents/Tasks based on view mode) */}
        <ResizableSidebar
          isOpen={!isMobile && sidebarOpen}
          onClose={handleCloseSidebar}
          widthAtom={agentsSidebarWidthAtom}
          minWidth={SIDEBAR_MIN_WIDTH}
          maxWidth={SIDEBAR_MAX_WIDTH}
          side="left"
          closeHotkey={SIDEBAR_CLOSE_HOTKEY}
          animationDuration={SIDEBAR_ANIMATION_DURATION}
          initialWidth={0}
          exitWidth={0}
          showResizeTooltip={true}
          className="overflow-hidden bg-shell"
        >
          {navViewMode === "chats" ? (
            <AgentsSidebar
              desktopUser={desktopUser}
              onSignOut={handleSignOut}
              onToggleSidebar={handleCloseSidebar}
              navViewMode={navViewMode}
              onNavViewModeChange={setNavViewMode}
            />
          ) : (
            <TasksSidebar 
              onToggleSidebar={handleCloseSidebar}
              navViewMode={navViewMode}
              onNavViewModeChange={setNavViewMode}
            />
          )}
        </ResizableSidebar>

        {/* Main Content - Rounded card panel */}
        <div className="flex-1 overflow-hidden flex flex-col min-w-0 bg-background rounded-[14px] shadow-sm">
          <AgentsContent />
        </div>

        {/* Update Banner */}
        <UpdateBanner />
      </div>
    </TooltipProvider>
  )
}
