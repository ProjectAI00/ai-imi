"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
// import { useSearchParams, useRouter } from "next/navigation" // Desktop doesn't use next/navigation
// Desktop: mock Next.js navigation hooks
const useSearchParams = () => ({ get: () => null })
const useRouter = () => ({ push: () => {}, replace: () => {} })
// Desktop: mock Clerk hooks
const useUser = () => ({ user: null })
const useClerk = () => ({ signOut: () => {} })
import {
  selectedAgentChatIdAtom,
  agentsMobileViewModeAtom,
  agentsPreviewSidebarOpenAtom,
  agentsSidebarOpenAtom,
  agentsSubChatsSidebarModeAtom,
  agentsSubChatsSidebarWidthAtom,
  selectedProjectAtom,
} from "../atoms"
import {
  selectedTeamIdAtom,
  agentsQuickSwitchOpenAtom,
  agentsQuickSwitchSelectedIndexAtom,
  subChatsQuickSwitchOpenAtom,
  subChatsQuickSwitchSelectedIndexAtom,
  selectedAgentChatIdsAtom,
  isAgentMultiSelectModeAtom,
  clearAgentChatSelectionAtom,
  ctrlTabTargetAtom,
  navViewModeAtom,
  selectedGoalIdAtom,
  selectedTaskIdAtom,
} from "../../../lib/atoms"
import { NewChatForm } from "../main/new-chat-form"
import { ChatView } from "../main/active-chat"
import { api } from "../../../lib/mock-api"
import { trpc } from "../../../lib/trpc"
import { useIsMobile } from "../../../lib/hooks/use-mobile"
import { AgentsSidebar } from "../../sidebar/agents-sidebar"
import { AgentsSubChatsSidebar } from "../../sidebar/agents-subchats-sidebar"
import { AgentPreview } from "./agent-preview"
import { AgentDiffView } from "./agent-diff-view"
import {
  TerminalSidebar,
  terminalSidebarOpenAtom,
  terminalSidebarWidthAtom,
  rightPanelModeAtom,
} from "../../terminal"
import { RightPanelChat } from "./right-panel-chat"
import {
  useAgentSubChatStore,
  type SubChatMeta,
} from "../stores/sub-chat-store"
import { motion, AnimatePresence } from "motion/react"
// import { ResizableSidebar } from "@/app/(alpha)/canvas/[id]/{components}/resizable-sidebar"
import { ResizableSidebar } from "../../../components/ui/resizable-sidebar"
// import { useClerk, useUser } from "@clerk/nextjs"
// import { useCombinedAuth } from "@/lib/hooks/use-combined-auth"
const useCombinedAuth = () => ({ userId: null }) // Desktop mock
import { Button } from "../../../components/ui/button"
import { IconSidebarToggle } from "../../../components/ui/icons"
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../components/ui/tooltip"
import { AgentsQuickSwitchDialog } from "../components/agents-quick-switch-dialog"
import { SubChatsQuickSwitchDialog } from "../components/subchats-quick-switch-dialog"
import { useArchiveChat } from "../../sidebar/hooks/use-archive-chat"
import { isDesktopApp } from "../../../lib/utils/platform"
import { TasksWorkspacePanel } from "./tasks-workspace-panel"
import { toast } from "sonner"
// Desktop mock
const useIsAdmin = () => false

// Main Component
export function AgentsContent() {
  const [selectedChatId, setSelectedChatId] = useAtom(selectedAgentChatIdAtom)
  const selectedProject = useAtomValue(selectedProjectAtom)
  const [selectedTeamId] = useAtom(selectedTeamIdAtom)
  const [sidebarOpen, setSidebarOpen] = useAtom(agentsSidebarOpenAtom)
  const [previewSidebarOpen, setPreviewSidebarOpen] = useAtom(
    agentsPreviewSidebarOpenAtom,
  )
  const [mobileViewMode, setMobileViewMode] = useAtom(agentsMobileViewModeAtom)
  const [subChatsSidebarMode, setSubChatsSidebarMode] = useAtom(
    agentsSubChatsSidebarModeAtom,
  )
  const setTerminalSidebarOpen = useSetAtom(terminalSidebarOpenAtom)
  const [rightPanelMode, setRightPanelMode] = useAtom(rightPanelModeAtom)
  const navViewMode = useAtomValue(navViewModeAtom)
  const setNavViewMode = useSetAtom(navViewModeAtom)
  const selectedGoalId = useAtomValue(selectedGoalIdAtom)
  const setSelectedGoalId = useSetAtom(selectedGoalIdAtom)
  const selectedTaskId = useAtomValue(selectedTaskIdAtom)
  const setSelectedTaskId = useSetAtom(selectedTaskIdAtom)

  const hasOpenedSubChatsSidebar = useRef(false)
  const wasSubChatsSidebarOpen = useRef(false)
  const [shouldAnimateSubChatsSidebar, setShouldAnimateSubChatsSidebar] =
    useState(subChatsSidebarMode !== "sidebar")
  const searchParams = useSearchParams()
  const router = useRouter()
  const isInitialized = useRef(false)
  const isFirstRenderRef = useRef(true) // Skip URL sync on first render to avoid race condition
  const isNavigatingRef = useRef(false)
  const newChatFormKeyRef = useRef(0)
  const isMobile = useIsMobile()
  const [isHydrated, setIsHydrated] = useState(false)
  const { userId } = useCombinedAuth()
  const { user } = useUser()
  const { signOut } = useClerk()
  const isAdmin = useIsAdmin()

  // Quick-switch dialog state - Agents (Opt+Ctrl+Tab)
  const [quickSwitchOpen, setQuickSwitchOpen] = useAtom(
    agentsQuickSwitchOpenAtom,
  )
  const [quickSwitchSelectedIndex, setQuickSwitchSelectedIndex] = useAtom(
    agentsQuickSwitchSelectedIndexAtom,
  )
  const holdTimerRef = useRef<NodeJS.Timeout | null>(null)
  const modifierKeysHeldRef = useRef(false)
  const wasShiftPressedRef = useRef(false)
  const isQuickSwitchingRef = useRef(false)
  const frozenRecentChatsRef = useRef<typeof agentChats>([]) // Frozen snapshot for dialog

  // Ctrl+Tab target preference
  const ctrlTabTarget = useAtomValue(ctrlTabTargetAtom)

  // Quick-switch dialog state - Sub-chats (Ctrl+Tab)
  const [subChatQuickSwitchOpen, setSubChatQuickSwitchOpen] = useAtom(
    subChatsQuickSwitchOpenAtom,
  )
  const [subChatQuickSwitchSelectedIndex, setSubChatQuickSwitchSelectedIndex] =
    useAtom(subChatsQuickSwitchSelectedIndexAtom)
  const subChatHoldTimerRef = useRef<NodeJS.Timeout | null>(null)
  const subChatModifierKeysHeldRef = useRef(false)
  const subChatWasShiftPressedRef = useRef(false)
  const frozenSubChatsRef = useRef<SubChatMeta[]>([])
  // Refs to avoid effect re-running when dialog state changes (prevents keyup event loss)
  const subChatQuickSwitchOpenRef = useRef(subChatQuickSwitchOpen)
  const subChatQuickSwitchSelectedIndexRef = useRef(
    subChatQuickSwitchSelectedIndex,
  )
  subChatQuickSwitchOpenRef.current = subChatQuickSwitchOpen
  subChatQuickSwitchSelectedIndexRef.current = subChatQuickSwitchSelectedIndex

  // Get sub-chats from store
  const allSubChats = useAgentSubChatStore((state) => state.allSubChats)
  const openSubChatIds = useAgentSubChatStore((state) => state.openSubChatIds)
  const activeSubChatId = useAgentSubChatStore((state) => state.activeSubChatId)
  const setActiveSubChat = useAgentSubChatStore(
    (state) => state.setActiveSubChat,
  )

  // Fetch teams for header
  const { data: teams } = api.teams.getUserTeams.useQuery(undefined, {
    enabled: !!selectedTeamId,
  })
  const selectedTeam = teams?.find((t: any) => t.id === selectedTeamId) as any

  // Fetch agent chats for keyboard navigation and mobile view
  const { data: agentChats } = api.agents.getAgentChats.useQuery(
    { teamId: selectedTeamId! },
    { enabled: !!selectedTeamId },
  )

  // Fetch all projects for git info (like sidebar does)
  const { data: projects } = trpc.projects.list.useQuery()

  // Create map for quick project lookup by id
  const projectsMap = useMemo(() => {
    if (!projects) return new Map()
    return new Map(projects.map((p) => [p.id, p]))
  }, [projects])

  // Fetch current chat data for preview info
  const { data: chatData } = api.agents.getAgentChat.useQuery(
    { chatId: selectedChatId! },
    { enabled: !!selectedChatId },
  )

  // In Tasks view, keep chat docked on the right and workspace in center.
  useEffect(() => {
    if (navViewMode !== "tasks" || !selectedChatId) return
    if (rightPanelMode !== "chat") {
      setRightPanelMode("chat")
    }
  }, [navViewMode, selectedChatId, rightPanelMode, setRightPanelMode])

  // In Chats view, prioritize full-width center chat instead of right-docked chat mode.
  useEffect(() => {
    if (navViewMode !== "chats") return
    if (rightPanelMode === "chat") {
      setRightPanelMode("closed")
    }
  }, [navViewMode, rightPanelMode, setRightPanelMode])
  const { data: goalsForWorkspace } = trpc.goals.list.useQuery(undefined, {
    enabled: navViewMode === "tasks",
  })
  const selectedGoalForWorkspace = useMemo(() => {
    if (!selectedGoalId || !goalsForWorkspace) return null
    return goalsForWorkspace.find((goal) => goal.id === selectedGoalId) || null
  }, [selectedGoalId, goalsForWorkspace])
  const { data: tasksForWorkspace } = trpc.tasks.list.useQuery(
    { goalId: selectedGoalId || undefined },
    {
      enabled: navViewMode === "tasks" && !!selectedGoalId,
    },
  )
  const { data: projectChatsForTasks } = trpc.chats.list.useQuery(
    { projectId: selectedProject?.id },
    {
      enabled: navViewMode === "tasks" && !!selectedProject?.id,
    },
  )
  const trpcUtils = trpc.useUtils()
  const createTaskChatMutation = trpc.chats.create.useMutation()
  const linkTaskChatMutation = trpc.tasks.linkChat.useMutation()
  const updateTaskMutation = trpc.tasks.update.useMutation()
  const updateGoalMutation = trpc.goals.update.useMutation()
  const openOpsChat = useCallback(async () => {
    const projectId = selectedProject?.id || ((chatData as any)?.project?.id as string | undefined)
    if (!projectId) {
      toast.error("Unable to open IMI Ops", {
        description: "Missing project context. Select a project and try again.",
      })
      return
    }
    const goal = selectedGoalForWorkspace
    const desiredName = goal ? `IMI Ops · ${goal.name}` : "IMI Ops"
    const existingOpsChat = projectChatsForTasks?.find((chat) => chat.name === desiredName)
    if (existingOpsChat) {
      setSelectedChatId(existingOpsChat.id)
      setRightPanelMode("chat")
      return
    }
    const createdChat = await createTaskChatMutation.mutateAsync({
      projectId,
      name: desiredName,
      mode: "ask",
      cli: "copilot",
      goalId: goal?.id,
    })
    await trpcUtils.chats.list.invalidate()
    setSelectedChatId(createdChat.id)
    setRightPanelMode("chat")
  }, [
    selectedProject?.id,
    chatData,
    selectedGoalForWorkspace,
    projectChatsForTasks,
    createTaskChatMutation,
    trpcUtils.chats.list,
    setSelectedChatId,
    setRightPanelMode,
  ])

  // Archive chat mutation with proper navigation logic
  const archiveChatMutation = useArchiveChat({
    teamId: selectedTeamId,
    selectedChatId,
  })

  // Multi-select state for bulk archive
  const selectedChatIds = useAtomValue(selectedAgentChatIdsAtom)
  const isMultiSelectMode = useAtomValue(isAgentMultiSelectModeAtom)
  const clearChatSelection = useSetAtom(clearAgentChatSelectionAtom)
  const utils = api.useUtils()

  // Batch archive mutation for multi-select
  const archiveChatsBatchMutation = api.agents.archiveChatsBatch.useMutation({
    onSuccess: () => {
      utils.agents.getAgentChats.invalidate({ teamId: selectedTeamId! })
      utils.agents.getArchivedChats.invalidate({ teamId: selectedTeamId! })
      clearChatSelection()
    },
  })

  // Track hydration
  useEffect(() => {
    setIsHydrated(true)
  }, [])

  // On mount: read URL → set atom
  useEffect(() => {
    if (isInitialized.current) return
    isInitialized.current = true

    const chatIdFromUrl = searchParams.get("chat")
    if (chatIdFromUrl) {
      setSelectedChatId(chatIdFromUrl)
    }
  }, [searchParams, setSelectedChatId])

  // When atom changes: update URL and increment NewChatForm key when returning to new chat view
  useEffect(() => {
    // Skip the first render - let the URL read effect set the initial value first
    // This prevents a race condition where this effect would clear the chat param
    // before the atom has been updated from the URL
    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false
      return
    }

    const currentChatId = searchParams.get("chat")
    if (selectedChatId !== currentChatId) {
      const url = new URL(window.location.href)
      if (selectedChatId) {
        url.searchParams.set("chat", selectedChatId)
      } else {
        url.searchParams.delete("chat")
        // Increment key to force NewChatForm remount and trigger focus
        newChatFormKeyRef.current += 1
      }
      router.replace(url.pathname + url.search, { scroll: false })
    }
  }, [selectedChatId, searchParams, router, quickSwitchOpen])

  // Auto-close sidebars on mobile devices
  useEffect(() => {
    if (isMobile && isHydrated) {
      setSidebarOpen(false)
      setPreviewSidebarOpen(false)
    }
  }, [isMobile, isHydrated, setSidebarOpen, setPreviewSidebarOpen])

  // On mobile: when chat is selected, switch to chat mode
  useEffect(() => {
    if (isMobile && selectedChatId && mobileViewMode === "chats") {
      setMobileViewMode("chat")
    }
  }, [isMobile, selectedChatId, mobileViewMode, setMobileViewMode])

  // On mobile: when in terminal mode, sync with terminal sidebar close
  const terminalSidebarOpen = useAtomValue(terminalSidebarOpenAtom)
  useEffect(() => {
    // If terminal sidebar closed while in terminal mode, go back to chat
    if (isMobile && mobileViewMode === "terminal" && !terminalSidebarOpen) {
      setMobileViewMode("chat")
    }
  }, [isMobile, mobileViewMode, terminalSidebarOpen, setMobileViewMode])

  // On mobile: hide native traffic lights when not in "chats" mode
  // Traffic lights should only show in the agents list view
  useEffect(() => {
    if (!isMobile) return
    if (
      typeof window === "undefined" ||
      !window.desktopApi?.setTrafficLightVisibility
    )
      return

    // Hide traffic lights when not in chats list mode
    if (mobileViewMode !== "chats") {
      window.desktopApi.setTrafficLightVisibility(false)
    }
  }, [isMobile, mobileViewMode])

  // Get recent chats for quick-switch dialog
  // Order: current chat first (left), then previous chats by last updated
  // IMPORTANT: Only recalculate when dialog is closed to prevent flickering
  const sortedChats = agentChats
    ? [...agentChats].sort(
        (a, b) =>
          new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
      )
    : []

  let recentChats: typeof sortedChats = []
  // Use frozen chats when dialog is open to prevent recalculation
  if (
    quickSwitchOpen &&
    frozenRecentChatsRef.current &&
    frozenRecentChatsRef.current.length > 0
  ) {
    recentChats = frozenRecentChatsRef.current ?? []
  } else if (selectedChatId) {
    // Put current chat first, then take next 4
    const currentChat = sortedChats.find((c) => c.id === selectedChatId)
    const otherChats = sortedChats
      .filter((c) => c.id !== selectedChatId)
      .slice(0, 4)
    recentChats = currentChat ? [currentChat, ...otherChats] : otherChats
  } else {
    recentChats = sortedChats.slice(0, 5)
  }

  // Keyboard navigation: Quick switch between workspaces
  // Shortcut depends on ctrlTabTarget preference:
  // - "workspaces" (default): Ctrl+Tab switches workspaces
  // - "agents": Opt+Ctrl+Tab switches workspaces
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Determine shortcut based on preference
      const isCtrlTabOnly =
        e.ctrlKey && e.key === "Tab" && !e.altKey && !e.metaKey
      const isOptCtrlTab =
        e.altKey && e.ctrlKey && e.key === "Tab" && !e.metaKey

      // Workspace switch: Ctrl+Tab by default, or Opt+Ctrl+Tab when ctrlTabTarget is "agents"
      const isWorkspaceSwitchShortcut =
        ctrlTabTarget === "workspaces" ? isCtrlTabOnly : isOptCtrlTab

      if (isWorkspaceSwitchShortcut) {
        e.preventDefault()
        wasShiftPressedRef.current = e.shiftKey

        if (recentChats.length === 0) return

        // If dialog is open, navigate through chats
        if (quickSwitchOpen) {
          let nextIndex: number
          if (e.shiftKey) {
            // Shift + Tab = Previous
            nextIndex = quickSwitchSelectedIndex - 1
            if (nextIndex < 0) {
              nextIndex = (frozenRecentChatsRef.current?.length ?? 1) - 1
            }
          } else {
            // Tab = Next
            nextIndex =
              (quickSwitchSelectedIndex + 1) %
              (frozenRecentChatsRef.current?.length ?? 1)
          }
          setQuickSwitchSelectedIndex(nextIndex)
          return
        }

        // If dialog is not open yet, start hold timer
        if (!quickSwitchOpen && !holdTimerRef.current) {
          modifierKeysHeldRef.current = true

          // Freeze current recentChats snapshot for this dialog session
          frozenRecentChatsRef.current = [...recentChats]

          // Start timer to show dialog after 30ms (almost instant)
          holdTimerRef.current = setTimeout(() => {
            // Clear timer ref AFTER it fires - this is critical for close detection
            holdTimerRef.current = null
            if (modifierKeysHeldRef.current) {
              // Show dialog
              setQuickSwitchOpen(true)

              // Current chat is always at index 0 (left), select next chat (index 1)
              // For Shift+Tab, select last chat
              if (wasShiftPressedRef.current) {
                // Shift: go to last chat
                setQuickSwitchSelectedIndex(
                  (frozenRecentChatsRef.current?.length ?? 1) - 1,
                )
              } else {
                // Tab: go to next chat (index 1), or wrap to 0 if only one chat
                setQuickSwitchSelectedIndex(
                  (frozenRecentChatsRef.current?.length ?? 1) > 1 ? 1 : 0,
                )
              }
            }
          }, 30)

          return
        }
      }
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      // ESC to close dialog without navigating
      if (e.key === "Escape" && quickSwitchOpen) {
        e.preventDefault()
        modifierKeysHeldRef.current = false
        isQuickSwitchingRef.current = false // Unblock selectedChatId changes

        if (holdTimerRef.current) {
          clearTimeout(holdTimerRef.current)
          holdTimerRef.current = null
        }

        setQuickSwitchOpen(false)
        setQuickSwitchSelectedIndex(0)
        return
      }

      // When modifier key is released
      // For workspaces mode (Ctrl+Tab only): react to Control release
      // For agents mode (Opt+Ctrl+Tab): react to Alt or Control release
      const isRelevantKeyRelease =
        ctrlTabTarget === "workspaces"
          ? e.key === "Control"
          : e.key === "Alt" || e.key === "Control"

      if (isRelevantKeyRelease) {
        modifierKeysHeldRef.current = false

        // If timer is still running (quick press - dialog not shown yet)
        if (holdTimerRef.current) {
          clearTimeout(holdTimerRef.current)
          holdTimerRef.current = null
          isQuickSwitchingRef.current = false // Unblock

          // Do quick switch without showing dialog
          if (!isNavigatingRef.current && agentChats && agentChats.length > 0) {
            // Get sorted chat list
            const sortedChats = [...agentChats].sort(
              (a, b) =>
                new Date(b.updated_at).getTime() -
                new Date(a.updated_at).getTime(),
            )
            isNavigatingRef.current = true
            setTimeout(() => {
              isNavigatingRef.current = false
            }, 300)

            // If no chat selected, select first one
            if (!selectedChatId) {
              setSelectedChatId(sortedChats[0].id)
              return
            }

            // Find current index
            const currentIndex = sortedChats.findIndex(
              (chat) => chat.id === selectedChatId,
            )

            if (currentIndex === -1) {
              setSelectedChatId(sortedChats[0].id)
              return
            }

            // Navigate forward or backward
            let nextIndex: number
            if (wasShiftPressedRef.current) {
              nextIndex = currentIndex - 1
              if (nextIndex < 0) {
                nextIndex = sortedChats.length - 1
              }
            } else {
              nextIndex = currentIndex + 1
              if (nextIndex >= sortedChats.length) {
                nextIndex = 0
              }
            }

            setSelectedChatId(sortedChats[nextIndex].id)
          }
          return
        }

        // If dialog is open, navigate to selected chat and close
        if (quickSwitchOpen) {
          const selectedChat =
            frozenRecentChatsRef.current?.[quickSwitchSelectedIndex]

          if (selectedChat) {
            setSelectedChatId(selectedChat.id)
          }

          setQuickSwitchOpen(false)
          setQuickSwitchSelectedIndex(0)
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    window.addEventListener("keyup", handleKeyUp)

    return () => {
      window.removeEventListener("keydown", handleKeyDown)
      window.removeEventListener("keyup", handleKeyUp)
      if (holdTimerRef.current) {
        clearTimeout(holdTimerRef.current)
      }
    }
  }, [
    agentChats,
    selectedChatId,
    setSelectedChatId,
    quickSwitchOpen,
    setQuickSwitchOpen,
    quickSwitchSelectedIndex,
    setQuickSwitchSelectedIndex,
    ctrlTabTarget,
    // Note: recentChats removed - we use frozenRecentChatsRef instead
  ])

  // Get open sub-chats for quick-switch (only tabs that are open in the selector)
  // Sorted by position in openSubChatIds, with active first
  const recentSubChats = useMemo(() => {
    if (!openSubChatIds || openSubChatIds.length === 0) return []

    // Get sub-chat metadata for open tabs
    const openSubChats = openSubChatIds
      .map((id) => allSubChats.find((c) => c.id === id))
      .filter((c): c is SubChatMeta => c !== undefined)

    if (openSubChats.length === 0) return []

    // Put active sub-chat first, keep rest in tab order
    if (activeSubChatId) {
      const activeChat = openSubChats.find((c) => c.id === activeSubChatId)
      const otherChats = openSubChats.filter((c) => c.id !== activeSubChatId)
      return activeChat ? [activeChat, ...otherChats] : openSubChats
    }
    return openSubChats
  }, [openSubChatIds, allSubChats, activeSubChatId])

  // Keyboard navigation: Quick switch between agents (sub-chats within workspace)
  // Shortcut depends on ctrlTabTarget preference:
  // - "workspaces" (default): Opt+Ctrl+Tab switches agents
  // - "agents": Ctrl+Tab switches agents
  // Uses refs for dialog state to avoid effect re-running and losing keyup events
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Determine shortcut based on preference
      const isCtrlTabOnly =
        e.ctrlKey && e.key === "Tab" && !e.altKey && !e.metaKey
      const isOptCtrlTab =
        e.altKey && e.ctrlKey && e.key === "Tab" && !e.metaKey

      // Agent switch: Opt+Ctrl+Tab by default, or Ctrl+Tab when ctrlTabTarget is "agents"
      const isAgentSwitchShortcut =
        ctrlTabTarget === "agents" ? isCtrlTabOnly : isOptCtrlTab

      if (isAgentSwitchShortcut) {
        e.preventDefault()
        subChatWasShiftPressedRef.current = e.shiftKey

        // If dialog is open, navigate through sub-chats
        if (subChatQuickSwitchOpenRef.current) {
          let nextIndex: number
          if (e.shiftKey) {
            nextIndex = subChatQuickSwitchSelectedIndexRef.current - 1
            if (nextIndex < 0) {
              nextIndex = (frozenSubChatsRef.current?.length ?? 1) - 1
            }
          } else {
            nextIndex =
              (subChatQuickSwitchSelectedIndexRef.current + 1) %
              (frozenSubChatsRef.current?.length ?? 1)
          }
          setSubChatQuickSwitchSelectedIndex(nextIndex)
          return
        }

        // If dialog is not open yet, start hold timer
        if (
          !subChatQuickSwitchOpenRef.current &&
          !subChatHoldTimerRef.current
        ) {
          // Get fresh data from store for snapshot
          const store = useAgentSubChatStore.getState()
          const currentOpenIds = store.openSubChatIds
          const currentAllSubChats = store.allSubChats
          const currentActiveId = store.activeSubChatId

          if (currentOpenIds.length === 0) return

          subChatModifierKeysHeldRef.current = true

          // Build frozen snapshot from current store state
          const openSubChats = currentOpenIds
            .map((id) => currentAllSubChats.find((c) => c.id === id))
            .filter((c): c is SubChatMeta => c !== undefined)

          if (openSubChats.length === 0) return

          // Put active sub-chat first
          if (currentActiveId) {
            const activeChat = openSubChats.find(
              (c) => c.id === currentActiveId,
            )
            const otherChats = openSubChats.filter(
              (c) => c.id !== currentActiveId,
            )
            frozenSubChatsRef.current = activeChat
              ? [activeChat, ...otherChats]
              : openSubChats
          } else {
            frozenSubChatsRef.current = openSubChats
          }

          subChatHoldTimerRef.current = setTimeout(() => {
            // Clear timer ref AFTER it fires - this is critical for close detection
            subChatHoldTimerRef.current = null
            if (subChatModifierKeysHeldRef.current) {
              // Update ref immediately so keyUp can detect dialog is open
              // (before React re-renders and updates the ref from state)
              subChatQuickSwitchOpenRef.current = true
              setSubChatQuickSwitchOpen(true)
              if (subChatWasShiftPressedRef.current) {
                setSubChatQuickSwitchSelectedIndex(
                  (frozenSubChatsRef.current?.length ?? 1) - 1,
                )
              } else {
                setSubChatQuickSwitchSelectedIndex(
                  (frozenSubChatsRef.current?.length ?? 1) > 1 ? 1 : 0,
                )
              }
            }
          }, 30)

          return
        }
      }
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      // ESC to close dialog without navigating
      if (e.key === "Escape" && subChatQuickSwitchOpenRef.current) {
        e.preventDefault()
        subChatModifierKeysHeldRef.current = false

        if (subChatHoldTimerRef.current) {
          clearTimeout(subChatHoldTimerRef.current)
          subChatHoldTimerRef.current = null
        }

        setSubChatQuickSwitchOpen(false)
        setSubChatQuickSwitchSelectedIndex(0)
        return
      }

      // When modifier key is released
      // For agents mode (Ctrl+Tab): react to Control release
      // For workspaces mode (Opt+Ctrl+Tab): react to Alt or Control release
      const isRelevantKeyRelease =
        ctrlTabTarget === "agents"
          ? e.key === "Control"
          : e.key === "Alt" || e.key === "Control"

      if (isRelevantKeyRelease) {
        subChatModifierKeysHeldRef.current = false

        // If timer is still running (quick press - dialog not shown yet)
        if (subChatHoldTimerRef.current) {
          clearTimeout(subChatHoldTimerRef.current)
          subChatHoldTimerRef.current = null

          // Do quick switch without showing dialog (only between open tabs)
          const store = useAgentSubChatStore.getState()
          const currentOpenIds = store.openSubChatIds
          const currentActiveId = store.activeSubChatId

          if (currentOpenIds && currentOpenIds.length > 1) {
            if (!currentActiveId) {
              store.setActiveSubChat(currentOpenIds[0])
              return
            }

            const currentIndex = currentOpenIds.indexOf(currentActiveId)
            if (currentIndex === -1) {
              store.setActiveSubChat(currentOpenIds[0])
              return
            }

            let nextIndex: number
            if (subChatWasShiftPressedRef.current) {
              nextIndex = currentIndex - 1
              if (nextIndex < 0) nextIndex = currentOpenIds.length - 1
            } else {
              nextIndex = currentIndex + 1
              if (nextIndex >= currentOpenIds.length) nextIndex = 0
            }

            store.setActiveSubChat(currentOpenIds[nextIndex])
          }
          return
        }

        // If dialog is open, navigate to selected sub-chat and close
        if (subChatQuickSwitchOpenRef.current) {
          const selectedSubChat =
            frozenSubChatsRef.current?.[
              subChatQuickSwitchSelectedIndexRef.current
            ]

          if (selectedSubChat) {
            useAgentSubChatStore.getState().setActiveSubChat(selectedSubChat.id)
          }

          setSubChatQuickSwitchOpen(false)
          setSubChatQuickSwitchSelectedIndex(0)
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    window.addEventListener("keyup", handleKeyUp)

    return () => {
      window.removeEventListener("keydown", handleKeyDown)
      window.removeEventListener("keyup", handleKeyUp)
      if (subChatHoldTimerRef.current) {
        clearTimeout(subChatHoldTimerRef.current)
      }
    }
  }, [setSubChatQuickSwitchOpen, setSubChatQuickSwitchSelectedIndex, ctrlTabTarget])

  // Keyboard shortcut: Archive current chat (or bulk archive if multi-select mode)
  // Web: Opt+Cmd+E (browser uses Cmd+E for search bar focus)
  // Desktop: Cmd+E
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isDesktop = isDesktopApp()

      // Desktop: Cmd+E (without Alt)
      const isDesktopShortcut =
        isDesktop &&
        e.metaKey &&
        e.code === "KeyE" &&
        !e.altKey &&
        !e.shiftKey &&
        !e.ctrlKey
      // Web: Opt+Cmd+E (with Alt)
      const isWebShortcut = e.altKey && e.metaKey && e.code === "KeyE"

      if (isDesktopShortcut || isWebShortcut) {
        e.preventDefault()

        // If multi-select mode, bulk archive selected chats
        if (isMultiSelectMode && selectedChatIds.size > 0) {
          if (!archiveChatsBatchMutation.isPending) {
            archiveChatsBatchMutation.mutate({
              chatIds: Array.from(selectedChatIds),
            })
          }
          return
        }

        // Otherwise archive current chat
        if (selectedChatId && !archiveChatMutation.isPending) {
          archiveChatMutation.mutate({ chatId: selectedChatId })
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [
    selectedChatId,
    archiveChatMutation,
    isMultiSelectMode,
    selectedChatIds,
    archiveChatsBatchMutation,
  ])

  const handleSignOut = async () => {
    // Check if running in Electron desktop app
    if (typeof window !== "undefined" && window.desktopApi) {
      // Use desktop logout which clears the token and shows login page
      await window.desktopApi.logout()
    } else {
      // Web: use Clerk sign out
      await signOut({ redirectUrl: window.location.pathname })
    }
  }

  // Check if sub-chats data is loaded (use separate selectors to avoid object creation)
  const subChatsStoreChatId = useAgentSubChatStore((state) => state.chatId)
  const subChatsCount = useAgentSubChatStore(
    (state) => state.allSubChats.length,
  )

  // Check if sub-chats are still loading (store not yet initialized for this chat)
  const isLoadingSubChats =
    selectedChatId !== null &&
    (subChatsStoreChatId !== selectedChatId || subChatsCount === 0)

  // Track sub-chats sidebar open state for animation control
  // Now renders even while loading to show spinner (mobile always uses tabs)
  const isSubChatsSidebarOpen =
    selectedChatId && subChatsSidebarMode === "sidebar" && !isMobile

  useEffect(() => {
    // When sidebar closes, reset for animation on next open
    if (!isSubChatsSidebarOpen && wasSubChatsSidebarOpen.current) {
      hasOpenedSubChatsSidebar.current = false
      setShouldAnimateSubChatsSidebar(true)
    }
    wasSubChatsSidebarOpen.current = !!isSubChatsSidebarOpen

    // Mark as opened after animation completes
    if (isSubChatsSidebarOpen && !hasOpenedSubChatsSidebar.current) {
      const timer = setTimeout(() => {
        hasOpenedSubChatsSidebar.current = true
        setShouldAnimateSubChatsSidebar(false)
      }, 150 + 50) // 150ms duration + 50ms buffer
      return () => clearTimeout(timer)
    } else if (isSubChatsSidebarOpen && hasOpenedSubChatsSidebar.current) {
      setShouldAnimateSubChatsSidebar(false)
    }
  }, [isSubChatsSidebarOpen])

  // Check if chat has sandbox with port for preview
  const chatMeta = chatData?.meta as
    | {
        sandboxConfig?: { port?: number }
        isQuickSetup?: boolean
        repository?: string
      }
    | undefined
  const isQuickSetup = chatMeta?.isQuickSetup === true
  const canShowPreview = !!(
    chatData?.sandbox_id &&
    !isQuickSetup &&
    chatMeta?.sandboxConfig?.port
  )
  // Check if diff can be shown (sandbox exists)
  const canShowDiff = !!chatData?.sandbox_id

  // Check if terminal can be shown (worktree exists - desktop only)
  // Use worktreePath if available, otherwise fall back to project path
  const worktreePath = ((chatData as any)?.worktreePath || (chatData as any)?.project?.path) as string | undefined
  const canShowTerminal = !!worktreePath

  // Mobile layout - completely different structure
  if (isMobile) {
    return (
      <div
        className="flex h-full bg-background"
        data-agents-page
        data-mobile-view
      >
        {/* Mobile View Modes */}
        {mobileViewMode === "chats" ? (
          // Chats List Mode (default) - uses AgentsSidebar in fullscreen
          <AgentsSidebar
            userId={userId}
            clerkUser={user}
            onSignOut={handleSignOut}
            onToggleSidebar={() => {}}
            isMobileFullscreen={true}
            onChatSelect={() => setMobileViewMode("chat")}
          />
        ) : mobileViewMode === "preview" && selectedChatId && canShowPreview ? (
          // Preview Mode
          <AgentPreview
            chatId={selectedChatId}
            sandboxId={chatData!.sandbox_id!}
            port={chatMeta?.sandboxConfig?.port!}
            isMobile={true}
            onClose={() => setMobileViewMode("chat")}
          />
        ) : mobileViewMode === "diff" && selectedChatId && canShowDiff ? (
          // Diff Mode - fullscreen diff view
          <AgentDiffView
            chatId={selectedChatId}
            sandboxId={chatData!.sandbox_id!}
            worktreePath={worktreePath}
            repository={chatMeta?.repository}
            showFooter={true}
            isMobile={true}
            onClose={() => setMobileViewMode("chat")}
          />
        ) : mobileViewMode === "terminal" &&
          selectedChatId &&
          canShowTerminal ? (
          // Terminal Mode - fullscreen terminal
          <TerminalSidebar
            chatId={selectedChatId}
            cwd={worktreePath!}
            workspaceId={selectedChatId}
            isMobileFullscreen={true}
            onClose={() => setMobileViewMode("chat")}
          />
        ) : (
          // Chat Mode - shows either ChatView or NewChatForm
          <div
            className="h-full w-full flex flex-col overflow-hidden select-text"
            data-mobile-chat-mode
          >
            {selectedChatId ? (
              <ChatView
                key={selectedChatId}
                chatId={selectedChatId}
                isSidebarOpen={false}
                onToggleSidebar={() => {}}
                selectedTeamName={selectedTeam?.name}
                selectedTeamImageUrl={selectedTeam?.image_url}
                isMobileFullscreen={true}
                onToggleSubChatsSidebar={() =>
                  setSubChatsSidebarMode((prev) =>
                    prev === "sidebar" ? "tabs" : "sidebar",
                  )
                }
                onBackToChats={() => {
                  setMobileViewMode("chats")
                  setSelectedChatId(null)
                }}
                onOpenPreview={
                  canShowPreview
                    ? () => setMobileViewMode("preview")
                    : undefined
                }
                onOpenDiff={
                  canShowDiff ? () => setMobileViewMode("diff") : undefined
                }
                onOpenTerminal={
                  canShowTerminal
                    ? () => {
                        setTerminalSidebarOpen(true)
                        setMobileViewMode("terminal")
                      }
                    : undefined
                }
                onOpenChatPanel={
                  selectedChatId
                    ? () => {
                        // Toggle: closed -> chat -> terminal -> closed
                        if (rightPanelMode === "closed") {
                          setNavViewMode("tasks")
                          setRightPanelMode("chat")
                        } else if (rightPanelMode === "chat") {
                          setRightPanelMode("terminal")
                        } else {
                          setRightPanelMode("closed")
                        }
                      }
                    : undefined
                }
              />
            ) : (
              // NewChatForm for creating new agent
              <div className="h-full flex flex-col relative overflow-hidden">
                <NewChatForm
                  isMobileFullscreen={true}
                  onBackToChats={() => setMobileViewMode("chats")}
                />
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  // Desktop layout
  return (
    <>
      <div className="flex h-full gap-1.5">
        {/* Sub-chats sidebar - only show in sidebar mode when viewing a chat */}
        <ResizableSidebar
          isOpen={!!isSubChatsSidebarOpen}
          onClose={() => {
            setShouldAnimateSubChatsSidebar(true)
            setSubChatsSidebarMode("tabs")
          }}
          widthAtom={agentsSubChatsSidebarWidthAtom}
          minWidth={160}
          maxWidth={300}
          side="left"
          animationDuration={0}
          initialWidth={0}
          exitWidth={0}
          disableClickToClose={true}
        >
          <AgentsSubChatsSidebar
            onClose={() => {
              setShouldAnimateSubChatsSidebar(true)
              setSubChatsSidebarMode("tabs")
            }}
            isMobile={isMobile}
            isSidebarOpen={sidebarOpen}
            onBackToChats={() => setSidebarOpen((prev) => !prev)}
            isLoading={isLoadingSubChats}
            agentName={chatData?.name}
          />
        </ResizableSidebar>

        {/* Main content - show ChatView unless it's been moved to right panel */}
        <div
          className="flex-1 min-w-0 overflow-hidden bg-background rounded-[14px] shadow-sm"
          style={{ minWidth: "350px" }}
        >
          {navViewMode === "tasks" ? (
            <div className="h-full flex flex-col bg-background rounded-[14px]">
              <div className="flex items-center h-10 px-2 flex-shrink-0">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setSidebarOpen((prev) => !prev)}
                      className="h-7 w-7 rounded-md text-muted-foreground hover:text-foreground"
                    >
                      <IconSidebarToggle className="h-4 w-4 scale-x-[-1]" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    {sidebarOpen ? "Close" : "Open"} sidebar<span className="ml-1.5 text-muted-foreground">⌘\</span>
                  </TooltipContent>
                </Tooltip>
              </div>
              <div className="flex-1 min-h-0">
                <TasksWorkspacePanel
                  goal={selectedGoalForWorkspace}
                  goals={goalsForWorkspace || []}
                  tasks={tasksForWorkspace || []}
                  selectedTaskId={selectedTaskId}
                  onBackToTaskBar={() => {
                    setSelectedGoalId(null)
                    setSelectedTaskId(null)
                  }}
                  onBackFromTaskDetail={() => setSelectedTaskId(null)}
                  onFollowUp={async () => {
                    await openOpsChat()
                  }}
                  onMoveChatBack={() => {
                    setRightPanelMode("closed")
                    setNavViewMode("chats")
                  }}
                  onOpenTasksSidebar={() => setSidebarOpen(true)}
                  onSelectGoal={(goalId) => {
                    setSelectedGoalId(goalId)
                    setSelectedTaskId(null)
                  }}
                  onSelectTask={(taskId) => setSelectedTaskId(taskId)}
                  onSaveGoalInput={async (goalId, input) => {
                    const selectedGoal = goalsForWorkspace?.find((goal) => goal.id === goalId)
                    const nextContext = selectedGoal?.context
                      ? `${selectedGoal.context}\n\n[Input]\n${input}`
                      : `[Input]\n${input}`
                    await updateGoalMutation.mutateAsync({
                      id: goalId,
                      context: nextContext,
                    })
                    await trpcUtils.goals.list.invalidate()
                    toast.success("Goal input saved", {
                      description: "IMI will use this guidance across related task execution.",
                    })
                  }}
                  onOpenTaskChat={async (taskId) => {
                    const selectedTask = tasksForWorkspace?.find((task) => task.id === taskId)
                    const linkedChatId = selectedTask?.chatId
                    if (linkedChatId) {
                      setSelectedChatId(linkedChatId)
                      setRightPanelMode("chat")
                      return
                    }
                    const projectId =
                      selectedTask?.projectId ||
                      selectedProject?.id ||
                      ((chatData as any)?.project?.id as string | undefined)
                    if (!selectedTask || !projectId) {
                      toast.error("Unable to open task chat", {
                        description: "Missing task or project context. Select a project and try again.",
                      })
                      return
                    }
                    try {
                      const initialPrompt = `# Task: ${selectedTask.title}\n\n${selectedTask.description}\n\nPlease continue this task and share progress updates.`
                      const createdChat = await createTaskChatMutation.mutateAsync({
                        projectId,
                        name: selectedTask.title,
                        initialMessageParts: [{ type: "text", text: initialPrompt }],
                        mode: "agent",
                        cli: "copilot",
                        goalId: selectedGoalId || undefined,
                        taskId: selectedTask.id,
                      })
                      await linkTaskChatMutation.mutateAsync({
                        taskId: selectedTask.id,
                        chatId: createdChat.id,
                      })
                      await trpcUtils.tasks.list.invalidate()
                      await trpcUtils.goals.list.invalidate()
                      setSelectedChatId(createdChat.id)
                      setRightPanelMode("chat")
                    } catch (error) {
                      toast.error("Failed to open task chat", {
                        description: error instanceof Error ? error.message : "Unknown error",
                      })
                    }
                  }}
                  onSaveTaskInstruction={async (taskId, instruction) => {
                    const selectedTask = tasksForWorkspace?.find((task) => task.id === taskId)
                    if (!selectedTask) return
                    const nextContext = selectedTask.context
                      ? `${selectedTask.context}\n\n[Feedback]\n${instruction}`
                      : `[Feedback]\n${instruction}`
                    await updateTaskMutation.mutateAsync({
                      id: taskId,
                      context: nextContext,
                    })
                    await trpcUtils.tasks.list.invalidate()
                    toast.success("Instruction saved", {
                      description: "Open task chat to continue execution with this guidance.",
                    })
                  }}
                />
              </div>
            </div>
          ) : selectedChatId && (navViewMode === "chats" || rightPanelMode !== "chat") ? (
            <div className="h-full flex flex-col relative overflow-hidden">
              <ChatView
                key={selectedChatId}
                chatId={selectedChatId}
                isSidebarOpen={sidebarOpen}
                onToggleSidebar={() => setSidebarOpen((prev) => !prev)}
                selectedTeamName={selectedTeam?.name}
                selectedTeamImageUrl={selectedTeam?.image_url}
                onToggleSubChatsSidebar={() =>
                  setSubChatsSidebarMode((prev) =>
                    prev === "sidebar" ? "tabs" : "sidebar",
                  )
                }
                onOpenChatPanel={() => {
                  // Toggle right panel: closed -> chat -> terminal -> closed
                  if (rightPanelMode === "closed") {
                    setNavViewMode("tasks")
                    setRightPanelMode("chat")
                  } else if (rightPanelMode === "chat") {
                    setRightPanelMode("terminal")
                  } else {
                    setRightPanelMode("closed")
                  }
                }}
              />
            </div>
          ) : selectedChatId && rightPanelMode === "chat" ? (
            // Chat is in right panel - show workspace placeholder in center with sidebar toggle
            <div className="h-full flex flex-col bg-background rounded-[14px]">
              {/* Header with sidebar toggle */}
              <div className="flex items-center h-10 px-2 flex-shrink-0">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setSidebarOpen((prev) => !prev)}
                      className="h-7 w-7 rounded-md text-muted-foreground hover:text-foreground"
                    >
                      <IconSidebarToggle className="h-4 w-4 scale-x-[-1]" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    {sidebarOpen ? "Close" : "Open"} sidebar<span className="ml-1.5 text-muted-foreground">⌘\</span>
                  </TooltipContent>
                </Tooltip>
              </div>
              <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
                <p className="text-sm">Chat moved to right panel</p>
                <button
                  onClick={() => setRightPanelMode("closed")}
                  className="text-xs mt-2 text-primary hover:underline"
                >
                  Move chat back
                </button>
              </div>
            </div>
          ) : (
            <div className="h-full flex flex-col relative overflow-hidden">
              <NewChatForm
                key={`new-chat-${newChatFormKeyRef.current}`}
                onOpenRightPanel={() => {
                  if (rightPanelMode === "closed") {
                    setRightPanelMode("terminal")
                  } else {
                    setRightPanelMode("closed")
                  }
                }}
                rightPanelMode={rightPanelMode}
              />
            </div>
          )}
        </div>

        {/* Right panel - Terminal or Chat - with floating card effect */}
        <ResizableSidebar
          isOpen={rightPanelMode !== "closed"}
          onClose={() => setRightPanelMode("closed")}
          widthAtom={terminalSidebarWidthAtom}
          minWidth={420}
          maxWidth={800}
          side="right"
          animationDuration={0}
          initialWidth={0}
          exitWidth={0}
        >
          <div className="h-full rounded-[14px] overflow-hidden shadow-sm bg-background">
          {rightPanelMode === "terminal" && selectedChatId && worktreePath && (
            <TerminalSidebar
              chatId={selectedChatId}
              cwd={worktreePath}
              workspaceId={selectedChatId}
              isMobileFullscreen={true}
              onClose={() => setRightPanelMode("closed")}
              onOpenChat={() => setRightPanelMode("chat")}
            />
          )}
          {rightPanelMode === "terminal" && selectedChatId && !worktreePath && (
            <div className="h-full flex flex-col items-center justify-center bg-background text-muted-foreground p-4">
              <p className="text-sm">Terminal not available</p>
              <p className="text-xs mt-1">No workspace path configured for this chat</p>
            </div>
          )}
          {rightPanelMode === "chat" && selectedChatId && (
            <div className="h-full flex flex-col overflow-hidden bg-background">
              <ChatView
                key={`right-panel-${selectedChatId}`}
                chatId={selectedChatId}
                isSidebarOpen={sidebarOpen}
                onToggleSidebar={() => setSidebarOpen((prev) => !prev)}
                selectedTeamName={selectedTeam?.name}
                selectedTeamImageUrl={selectedTeam?.image_url}
                isRightPanel={true}
                onToggleSubChatsSidebar={() =>
                  setSubChatsSidebarMode((prev) =>
                    prev === "sidebar" ? "tabs" : "sidebar",
                  )
                }
                onOpenChatPanel={() => setRightPanelMode("closed")}
                onOpenTerminal={
                  canShowTerminal ? () => setRightPanelMode("terminal") : undefined
                }
              />
            </div>
          )}
          {/* Placeholder when no chat is selected */}
          {!selectedChatId && (
            <div className="h-full flex flex-col items-center justify-center bg-background text-muted-foreground p-4">
              <p className="text-sm">Start a chat to use the right panel</p>
              <p className="text-xs mt-1 text-muted-foreground/70">Terminal and chat panel will appear here</p>
            </div>
          )}
          </div>
        </ResizableSidebar>
      </div>

      {/* Quick-switch dialog - Agents (Opt+Ctrl+Tab) */}
      <AgentsQuickSwitchDialog
        isOpen={quickSwitchOpen}
        chats={
          quickSwitchOpen ? (frozenRecentChatsRef.current ?? []) : recentChats
        }
        selectedIndex={quickSwitchSelectedIndex}
        projectsMap={projectsMap}
      />

      {/* Quick-switch dialog - Sub-chats (Ctrl+Tab) */}
      <SubChatsQuickSwitchDialog
        isOpen={subChatQuickSwitchOpen}
        subChats={
          subChatQuickSwitchOpen
            ? (frozenSubChatsRef.current ?? [])
            : recentSubChats
        }
        selectedIndex={subChatQuickSwitchSelectedIndex}
      />

      {/* Dev mode / Admin sandbox debugger */}
      {(process.env.NODE_ENV === "development" || isAdmin) &&
        chatData?.sandbox_id && (
          <a
            href={`https://codesandbox.io/p/devbox/${chatData.sandbox_id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="fixed bottom-4 right-4 z-50 bg-zinc-900 text-zinc-300 px-3 py-1.5 rounded-md text-xs font-mono opacity-70 hover:opacity-100 hover:bg-zinc-800 transition-all cursor-pointer"
          >
            sandbox: {chatData.sandbox_id}
          </a>
        )}
    </>
  )
}
