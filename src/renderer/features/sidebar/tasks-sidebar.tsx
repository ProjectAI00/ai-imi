/**
 * Tasks Sidebar
 *
 * Goal-first hierarchy: Goals → Goal Detail (with tasks) → Task Detail
 * Breadcrumb navigation for clarity
 */

import { useEffect, useState, useMemo } from "react"
import { useAtom, useSetAtom } from "jotai"
import { motion, AnimatePresence } from "motion/react"
import { trpc } from "../../lib/trpc"
import { selectedGoalIdAtom, selectedTaskIdAtom } from "../../lib/atoms"
import { selectedAgentChatIdAtom, selectedProjectAtom } from "../agents/atoms"
import { cn } from "../../lib/utils"
import { Button } from "../../components/ui/button"
import { Input } from "../../components/ui/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "../../components/ui/dropdown-menu"
import {
  PlayIcon,
  TrashIcon,
  CheckIcon,
  IconArrowRight,
  IconSpinner,
  IconChatBubble,
  PlusIcon,
} from "../../components/ui/icons"
import { MoreHorizontal, Circle, Clock, AlertCircle, ChevronLeft, ChevronRight, Target, ChevronDown } from "lucide-react"
import { toast } from "sonner"

interface TasksSidebarProps {
  onToggleSidebar?: () => void
  onStartTask?: (taskId: string) => void
  navViewMode?: "chats" | "tasks"
  onNavViewModeChange?: (mode: "chats" | "tasks") => void
  workspaces?: Array<{ id: string; name: string; color?: string | null; icon?: string | null }>
  selectedWorkspace?: { id: string; name: string; color?: string | null; icon?: string | null } | null
  onWorkspaceSelect?: (workspace: { id: string; name: string; color?: string | null; icon?: string | null }) => void
}

// Navigation state type
type NavState = 
  | { view: "goals" }
  | { view: "goal"; goalId: string }
  | { view: "task"; goalId: string; taskId: string }

// Priority badge colors
const priorityConfig = {
  low: { label: "Low", className: "bg-muted text-muted-foreground" },
  medium: { label: "Medium", className: "bg-blue-500/10 text-blue-500" },
  high: { label: "High", className: "bg-orange-500/10 text-orange-500" },
}

// Status config
const statusConfig = {
  todo: { label: "To Do", icon: Circle, className: "text-muted-foreground" },
  in_progress: { label: "In Progress", icon: IconSpinner, className: "text-blue-500" },
  review: { label: "Review", icon: AlertCircle, className: "text-orange-500" },
  done: { label: "Done", icon: CheckIcon, className: "text-green-500" },
}

// Time frame display
const timeFrameLabels: Record<string, string> = {
  today: "Today",
  tomorrow: "Tomorrow",
  this_week: "This Week",
  next_week: "Next Week",
  no_rush: "No Rush",
}

export function TasksSidebar({ 
  onToggleSidebar, 
  onStartTask, 
  navViewMode = "tasks", 
  onNavViewModeChange,
  workspaces = [],
  selectedWorkspace,
  onWorkspaceSelect,
}: TasksSidebarProps) {
  const [selectedTaskId, setSelectedTaskId] = useAtom(selectedTaskIdAtom)
  const setSelectedGoalId = useSetAtom(selectedGoalIdAtom)
  const setSelectedChatId = useSetAtom(selectedAgentChatIdAtom)
  const [selectedProject] = useAtom(selectedProjectAtom)
  const [searchQuery, setSearchQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState<string | null>(null)
  const [navState, setNavState] = useState<NavState>({ view: "goals" })
  const [showNewWorkspaceInput, setShowNewWorkspaceInput] = useState(false)
  const [newWorkspaceName, setNewWorkspaceName] = useState("")

  useEffect(() => {
    if (navState.view === "goals") {
      setSelectedGoalId(null)
      setSelectedTaskId(null)
      return
    }

    if (navState.view === "goal") {
      setSelectedGoalId(navState.goalId)
      setSelectedTaskId(null)
      return
    }

    setSelectedGoalId(navState.goalId)
    setSelectedTaskId(navState.taskId)
  }, [navState, setSelectedGoalId, setSelectedTaskId])

  // Fetch goals
  const { data: goals, isLoading: goalsLoading } = trpc.goals.list.useQuery()
  const { data: goalCounts } = trpc.goals.counts.useQuery()

  // Fetch tasks for selected goal
  const { data: goalTasks } = trpc.tasks.list.useQuery(
    { goalId: navState.view === "goal" || navState.view === "task" ? navState.goalId : undefined },
    { enabled: navState.view === "goal" || navState.view === "task" }
  )

  // Get current goal
  const currentGoal = useMemo(() => {
    if (navState.view === "goals" || !goals) return null
    return goals.find((g) => g.id === navState.goalId)
  }, [navState, goals])

  // Get current task
  const currentTask = useMemo(() => {
    if (navState.view !== "task" || !goalTasks) return null
    return goalTasks.find((t) => t.id === navState.taskId)
  }, [navState, goalTasks])

  // Mutations
  const utils = trpc.useUtils()
  const updateTaskStatusMutation = trpc.tasks.updateStatus.useMutation({
    onSuccess: () => {
      utils.tasks.list.invalidate()
      utils.tasks.counts.invalidate()
    },
  })
  const updateGoalStatusMutation = trpc.goals.updateStatus.useMutation({
    onSuccess: () => {
      utils.goals.list.invalidate()
      utils.goals.counts.invalidate()
    },
  })
  const deleteTaskMutation = trpc.tasks.delete.useMutation({
    onSuccess: () => {
      utils.tasks.list.invalidate()
      utils.tasks.counts.invalidate()
      if (navState.view === "task") {
        setNavState({ view: "goal", goalId: navState.goalId })
      }
      toast.success("Task deleted")
    },
  })
  const deleteGoalMutation = trpc.goals.delete.useMutation({
    onSuccess: () => {
      utils.goals.list.invalidate()
      utils.goals.counts.invalidate()
      setNavState({ view: "goals" })
      toast.success("Goal deleted")
    },
  })

  // Create chat for task execution
  const createChatMutation = trpc.chats.create.useMutation()
  
  // Create workspace
  const createWorkspaceMutation = trpc.workspaces.create.useMutation({
    onSuccess: (newWorkspace) => {
      utils.workspaces.list.invalidate()
      setShowNewWorkspaceInput(false)
      setNewWorkspaceName("")
      onWorkspaceSelect?.(newWorkspace)
      toast.success("Workspace created", {
        description: `"${newWorkspace.name}" is ready to use.`,
      })
    },
    onError: (error) => {
      toast.error("Failed to create workspace", {
        description: error.message,
      })
    },
  })
  
  const handleCreateWorkspace = () => {
    const name = newWorkspaceName.trim()
    if (!name) {
      toast.error("Please enter a workspace name")
      return
    }
    createWorkspaceMutation.mutate({ name })
  }

  // Filter goals
  const filteredGoals = useMemo(() => {
    if (!goals) return []
    let result = goals

    if (statusFilter) {
      result = result.filter((g) => g.status === statusFilter)
    }

    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      result = result.filter(
        (g) =>
          g.name.toLowerCase().includes(query) ||
          g.description?.toLowerCase().includes(query)
      )
    }

    return result
  }, [goals, statusFilter, searchQuery])

  // Handle starting a task
  const handleStartTask = async (task: NonNullable<typeof currentTask>) => {
    try {
      const initialPrompt = `# Task: ${task.title}

${task.description}

${task.context ? `## Context\n${task.context}` : ""}

Please help me complete this task.`

      const chat = await createChatMutation.mutateAsync({
        projectId: selectedProject?.id || task.projectId || "",
        name: task.title,
        initialMessageParts: [{ type: "text", text: initialPrompt }],
        mode: "agent",
        cli: "copilot",
      })

      await updateTaskStatusMutation.mutateAsync({
        id: task.id,
        status: "in_progress",
      })

      setSelectedChatId(chat.id)
      setSelectedTaskId(null)

      toast.success("Task started", {
        description: "Opening workspace...",
      })

      if (onStartTask) {
        onStartTask(task.id)
      }
    } catch (error) {
      toast.error("Failed to start task", {
        description: error instanceof Error ? error.message : "Unknown error",
      })
    }
  }

  // Handle starting a goal (all tasks)
  const handleStartGoal = async (goal: NonNullable<typeof currentGoal>, tasks: typeof goalTasks) => {
    try {
      // Determine which project to use for execution
      // Priority: goal's workspace > currently selected project
      const projectId = goal.workspaceId || selectedProject?.id
      
      if (!projectId) {
        toast.error("No project selected", {
          description: "Please select a project or assign one to this goal first.",
        })
        return
      }
      
      const taskList = tasks?.map((t, i) => `${i + 1}. **${t.title}**\n   ${t.description}`).join("\n\n") || "No tasks defined"
      
      const initialPrompt = `# Goal: ${goal.name}

${goal.description}

${goal.context ? `## Context\n${goal.context}\n` : ""}
## Tasks
${taskList}

Please help me complete this goal by working through the tasks.`

      const chat = await createChatMutation.mutateAsync({
        projectId,
        name: goal.name,
        initialMessageParts: [{ type: "text", text: initialPrompt }],
        mode: "agent",
        cli: "copilot",
        goalId: goal.id, // Pass goalId for state engine context injection
      })

      await updateGoalStatusMutation.mutateAsync({
        id: goal.id,
        status: "ongoing",
      })

      setSelectedChatId(chat.id)

      toast.success("Goal started", {
        description: "Opening workspace...",
      })
    } catch (error) {
      toast.error("Failed to start goal", {
        description: error instanceof Error ? error.message : "Unknown error",
      })
    }
  }

  // Breadcrumb component
  const Breadcrumb = () => {
    if (navState.view === "goals") return null

    return (
      <div className="flex items-center gap-1 text-xs text-muted-foreground px-3 py-1.5 overflow-hidden">
        <button
          onClick={() => setNavState({ view: "goals" })}
          className="hover:text-foreground transition-colors shrink-0"
        >
          Goals
        </button>
        {navState.view !== "goals" && currentGoal && (
          <>
            <ChevronRight className="h-3 w-3 shrink-0" />
            <button
              onClick={() => setNavState({ view: "goal", goalId: navState.goalId })}
              className={cn(
                "truncate max-w-[120px]",
                navState.view === "goal" ? "text-foreground" : "hover:text-foreground transition-colors"
              )}
            >
              {currentGoal.name}
            </button>
          </>
        )}
        {navState.view === "task" && currentTask && (
          <>
            <ChevronRight className="h-3 w-3 shrink-0" />
            <span className="text-foreground truncate max-w-[100px]">{currentTask.title}</span>
          </>
        )}
      </div>
    )
  }

  // ============ TASK DETAIL VIEW ============
  if (navState.view === "task" && currentTask) {
    const StatusIcon = statusConfig[currentTask.status as keyof typeof statusConfig]?.icon || Circle
    const statusCfg = statusConfig[currentTask.status as keyof typeof statusConfig]
    const priorityCfg = priorityConfig[currentTask.priority as keyof typeof priorityConfig]

    return (
      <div className="flex flex-col h-full bg-shell overflow-hidden">
        <Breadcrumb />
        
        {/* Header */}
        <div className="px-3 pt-4 pb-2 flex items-center justify-between">
          <button
            onClick={() => setNavState({ view: "goal", goalId: navState.goalId })}
            className="p-1 rounded hover:bg-foreground/5 text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="p-1 rounded hover:bg-foreground/5 text-muted-foreground hover:text-foreground transition-colors">
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem
                onClick={() => updateTaskStatusMutation.mutate({ id: currentTask.id, status: "done" })}
                className="gap-2"
              >
                <CheckIcon className="h-3.5 w-3.5" />
                Mark Done
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => deleteTaskMutation.mutate({ id: currentTask.id })}
                className="gap-2 text-destructive focus:text-destructive"
              >
                <TrashIcon className="h-3.5 w-3.5" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Task Content */}
        <div className="flex-1 overflow-y-auto px-3 py-2 pb-14">
          <h2 className="text-base font-medium text-foreground mb-3">{currentTask.title}</h2>

          {/* Status & Priority badges */}
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <span className={cn("inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs", statusCfg?.className || "bg-muted text-muted-foreground")}>
              <StatusIcon className="h-3 w-3" />
              {statusCfg?.label || currentTask.status}
            </span>
            {priorityCfg && (
              <span className={cn("px-2 py-0.5 rounded-full text-xs", priorityCfg.className)}>{priorityCfg.label}</span>
            )}
            {currentTask.timeFrame && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-muted text-muted-foreground">
                <Clock className="h-3 w-3" />
                {timeFrameLabels[currentTask.timeFrame] || currentTask.timeFrame}
              </span>
            )}
          </div>

          {currentTask.description && (
            <div className="mb-4">
              <h3 className="text-xs font-medium text-muted-foreground mb-1.5">Description</h3>
              <p className="text-sm text-foreground/80 whitespace-pre-wrap">{currentTask.description}</p>
            </div>
          )}

          {currentTask.context && (
            <div className="mb-4">
              <h3 className="text-xs font-medium text-muted-foreground mb-1.5">Context</h3>
              <p className="text-sm text-foreground/60 whitespace-pre-wrap">{currentTask.context}</p>
            </div>
          )}
        </div>

        {/* Start Task Button */}
        {currentTask.status !== "done" && (
        <div className="px-2 pt-2 pb-2.5">
          <Button
            onClick={() => handleStartTask(currentTask)}
            disabled={createChatMutation.isPending}
            className="w-full gap-2"
              variant="default"
            >
              {createChatMutation.isPending ? (
                <>
                  <IconSpinner className="h-4 w-4" />
                  Starting...
                </>
              ) : (
                <>
                  <PlayIcon className="h-4 w-4" />
                  Start Task
                </>
              )}
            </Button>
          </div>
        )}
      </div>
    )
  }

  // ============ GOAL DETAIL VIEW ============
  if (navState.view === "goal" && currentGoal) {
    const taskCount = goalTasks?.length || 0
    const completedCount = goalTasks?.filter((t) => t.status === "done").length || 0

    return (
      <div className="flex flex-col h-full bg-shell overflow-hidden">
        <Breadcrumb />
        
        {/* Header */}
        <div className="px-3 pt-4 pb-2 flex items-center justify-between">
          <button
            onClick={() => setNavState({ view: "goals" })}
            className="p-1 rounded hover:bg-foreground/5 text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="p-1 rounded hover:bg-foreground/5 text-muted-foreground hover:text-foreground transition-colors">
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem
                onClick={() => updateGoalStatusMutation.mutate({ id: currentGoal.id, status: "done" })}
                className="gap-2"
              >
                <CheckIcon className="h-3.5 w-3.5" />
                Mark Done
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => deleteGoalMutation.mutate({ id: currentGoal.id })}
                className="gap-2 text-destructive focus:text-destructive"
              >
                <TrashIcon className="h-3.5 w-3.5" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Goal Summary */}
        <div className="px-3 py-2">
          <h2 className="text-base font-medium text-foreground mb-2">{currentGoal.name}</h2>
          <p className="text-sm text-muted-foreground mb-2">{currentGoal.description}</p>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{completedCount}/{taskCount} tasks</span>
            {currentGoal.priority && (
              <span className={cn("px-1.5 py-0.5 rounded", priorityConfig[currentGoal.priority as keyof typeof priorityConfig]?.className)}>
                {priorityConfig[currentGoal.priority as keyof typeof priorityConfig]?.label}
              </span>
            )}
          </div>
        </div>

        {/* Tasks List */}
        <div className="flex-1 overflow-y-auto px-2 py-2">
          <div className="text-xs font-medium text-muted-foreground px-1 mb-2">Tasks</div>
          {goalTasks && goalTasks.length > 0 ? (
            <div className="space-y-1">
              {goalTasks.map((task) => {
                const StatusIcon = statusConfig[task.status as keyof typeof statusConfig]?.icon || Circle
                return (
                  <button
                    key={task.id}
                    onClick={() => setNavState({ view: "task", goalId: navState.goalId, taskId: task.id })}
                    className="w-full text-left px-2 py-2 rounded-md transition-colors hover:bg-foreground/5 group"
                  >
                    <div className="flex items-start gap-2.5">
                      <StatusIcon className={cn("h-4 w-4 mt-0.5", statusConfig[task.status as keyof typeof statusConfig]?.className)} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium truncate flex-1">{task.title}</span>
                          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                        {task.description && (
                          <span className="text-[11px] text-muted-foreground/60 truncate block">
                            {task.description.slice(0, 50)}{task.description.length > 50 ? "..." : ""}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="text-center py-4 text-muted-foreground/60 text-sm">No tasks yet</div>
          )}
        </div>

        {/* Start Goal Button */}
        {currentGoal.status !== "done" && (
          <div className="px-2 pt-2 pb-2.5">
            <Button
              onClick={() => handleStartGoal(currentGoal, goalTasks)}
              disabled={createChatMutation.isPending}
              className="w-full gap-2"
              variant="default"
            >
              {createChatMutation.isPending ? (
                <>
                  <IconSpinner className="h-4 w-4" />
                  Starting...
                </>
              ) : (
                <>
                  <PlayIcon className="h-4 w-4" />
                  Start Goal
                </>
              )}
            </Button>
          </div>
        )}
      </div>
    )
  }

  // ============ GOALS LIST VIEW ============
  return (
    <div className="flex flex-col h-full bg-shell overflow-hidden">
      {/* Top bar: workspace dropdown + close */}
      <div className="px-2 pt-1.5 pb-1 flex items-center gap-1.5">
        {/* Workspace dropdown - Linear style */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex-1 flex items-center gap-1.5 px-1.5 h-7 rounded-md hover:bg-foreground/5 transition-colors text-left min-w-0">
              {/* Workspace name */}
              <span className="text-sm font-medium text-foreground truncate flex-1">
                {selectedWorkspace?.name || "Workspace"}
              </span>
              {/* Dropdown chevron */}
              <ChevronDown className="w-3 h-3 text-muted-foreground flex-shrink-0" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52">
            {workspaces?.map((workspace) => {
              const isSelected = selectedWorkspace?.id === workspace.id
              const initial = workspace.name.charAt(0).toUpperCase()
              return (
                <DropdownMenuItem
                  key={workspace.id}
                  onClick={() => onWorkspaceSelect?.(workspace)}
                  className="gap-2"
                >
                  <div 
                    className={cn(
                      "w-5 h-5 rounded flex items-center justify-center text-xs font-medium",
                      isSelected ? "bg-primary text-primary-foreground" : "bg-muted"
                    )}
                    style={workspace.color && !isSelected ? { backgroundColor: workspace.color + '20', color: workspace.color } : undefined}
                  >
                    {workspace.icon || initial}
                  </div>
                  <span className="flex-1 truncate">{workspace.name}</span>
                  {isSelected && <CheckIcon className="w-4 h-4" />}
                </DropdownMenuItem>
              )
            })}
            <DropdownMenuSeparator />
            <DropdownMenuItem 
              className="gap-2"
              onClick={() => setShowNewWorkspaceInput(true)}
            >
              <PlusIcon className="w-4 h-4 text-muted-foreground" />
              New Workspace
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        

      </div>

      {/* New workspace input */}
      {showNewWorkspaceInput && (
        <div className="px-2 pb-2">
          <div className="flex items-center gap-1.5">
            <Input
              placeholder="Workspace name..."
              value={newWorkspaceName}
              onChange={(e) => setNewWorkspaceName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreateWorkspace()
                if (e.key === "Escape") {
                  setShowNewWorkspaceInput(false)
                  setNewWorkspaceName("")
                }
              }}
              autoFocus
              className="flex-1 h-7 text-sm"
            />
            <Button
              size="sm"
              variant="ghost"
              onClick={handleCreateWorkspace}
              disabled={createWorkspaceMutation.isPending || !newWorkspaceName.trim()}
              className="h-7 px-2"
            >
              {createWorkspaceMutation.isPending ? (
                <IconSpinner className="h-3.5 w-3.5" />
              ) : (
                <CheckIcon className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="px-2 pb-2">
        <Input
          placeholder="Search goals..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full rounded-lg text-sm bg-muted border border-input placeholder:text-muted-foreground/40 h-7"
        />
      </div>

      {/* Status filters - no "All" button */}
      <div className="px-2 pb-2">
        <div className="flex gap-1 text-xs flex-wrap">
          <button
            onClick={() => setStatusFilter(statusFilter === "todo" ? null : "todo")}
            className={cn(
              "px-2 py-1 rounded transition-colors",
              statusFilter === "todo"
                ? "bg-foreground/10 text-foreground"
                : "text-muted-foreground hover:bg-foreground/5"
            )}
          >
            Todo {goalCounts?.todo ? `(${goalCounts.todo})` : ""}
          </button>
          <button
            onClick={() => setStatusFilter(statusFilter === "ongoing" ? null : "ongoing")}
            className={cn(
              "px-2 py-1 rounded transition-colors",
              statusFilter === "ongoing"
                ? "bg-foreground/10 text-foreground"
                : "text-muted-foreground hover:bg-foreground/5"
            )}
          >
            Ongoing {goalCounts?.ongoing ? `(${goalCounts.ongoing})` : ""}
          </button>
          <button
            onClick={() => setStatusFilter(statusFilter === "review" ? null : "review")}
            className={cn(
              "px-2 py-1 rounded transition-colors",
              statusFilter === "review"
                ? "bg-foreground/10 text-foreground"
                : "text-muted-foreground hover:bg-foreground/5"
            )}
          >
            Review {goalCounts?.review ? `(${goalCounts.review})` : ""}
          </button>
        </div>
      </div>

      {/* Goals list */}
      <div className="flex-1 overflow-y-auto px-2 scrollbar-thin scrollbar-thumb-muted-foreground/20 scrollbar-track-transparent">
        {goalsLoading ? (
          <div className="flex items-center justify-center py-8">
            <IconSpinner className="h-5 w-5 text-muted-foreground" />
          </div>
        ) : filteredGoals.length > 0 ? (
          <div className="space-y-1">
            <AnimatePresence mode="popLayout">
              {filteredGoals.map((goal) => {
                const priorityCfg = priorityConfig[goal.priority as keyof typeof priorityConfig]
                return (
                  <motion.button
                    key={goal.id}
                    layout
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    onClick={() => setNavState({ view: "goal", goalId: goal.id })}
                    className="w-full text-left px-2 py-2.5 rounded-md transition-colors group hover:bg-foreground/5"
                  >
                    <div className="flex items-start gap-2.5">
                      <Target className="h-4 w-4 mt-0.5 text-muted-foreground" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium truncate flex-1">{goal.name}</span>
                          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          {priorityCfg && (
                            <span className={cn("px-1.5 py-0 rounded text-[10px]", priorityCfg.className)}>
                              {priorityCfg.label}
                            </span>
                          )}
                          {goal.description && (
                            <span className="text-[11px] text-muted-foreground/60 truncate">
                              {goal.description.slice(0, 40)}{goal.description.length > 40 ? "..." : ""}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </motion.button>
                )
              })}
            </AnimatePresence>
          </div>
        ) : (
          <div className="text-center py-8 px-4">
            <div className="text-muted-foreground/60 text-sm mb-1">
              {searchQuery ? "No goals match your search" : "No goals yet"}
            </div>
            <div className="text-muted-foreground/40 text-xs">
              {searchQuery ? "Try a different search term" : "Start a conversation in Plan mode to create goals"}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
