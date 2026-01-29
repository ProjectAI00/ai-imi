/**
 * Goals Tree Sidebar
 *
 * Displays collapsible goals with nested tasks.
 * Clicking a task opens/creates a chat for execution.
 */

import { useState, useMemo } from "react"
import { useAtom, useSetAtom } from "jotai"
import { motion, AnimatePresence } from "motion/react"
import { trpc } from "../../lib/trpc"
import { selectedAgentChatIdAtom, selectedProjectAtom } from "../agents/atoms"
import { cn } from "../../lib/utils"
import {
  ChevronRight,
  Circle,
  Loader2,
  AlertCircle,
  Check,
  Target,
} from "lucide-react"
import { toast } from "sonner"

// Status configuration for tasks
const taskStatusConfig = {
  todo: { icon: Circle, className: "text-muted-foreground", label: "To Do" },
  in_progress: { icon: Loader2, className: "text-blue-500 animate-spin", label: "In Progress" },
  review: { icon: AlertCircle, className: "text-orange-500", label: "Review" },
  done: { icon: Check, className: "text-green-500", label: "Done" },
} as const

// Status configuration for goals
const goalStatusConfig = {
  todo: { className: "text-muted-foreground" },
  ongoing: { className: "text-blue-500" },
  review: { className: "text-orange-500" },
  done: { className: "text-green-500" },
} as const

type TaskStatus = keyof typeof taskStatusConfig
type GoalStatus = keyof typeof goalStatusConfig

interface GoalsTreeSidebarProps {
  onStartTask?: (taskId: string) => void
}

export function GoalsTreeSidebar({ onStartTask }: GoalsTreeSidebarProps) {
  const [expandedGoals, setExpandedGoals] = useState<Set<string>>(new Set())
  const [selectedProject] = useAtom(selectedProjectAtom)
  const setSelectedChatId = useSetAtom(selectedAgentChatIdAtom)

  // Fetch goals
  const { data: goals, isLoading: goalsLoading } = trpc.goals.list.useQuery()

  // Fetch all tasks
  const { data: tasks, isLoading: tasksLoading } = trpc.tasks.list.useQuery()

  // Group tasks by goalId
  const tasksByGoal = useMemo(() => {
    if (!tasks) return new Map<string, typeof tasks>()
    const grouped = new Map<string, typeof tasks>()
    tasks.forEach((task) => {
      if (task.goalId) {
        const existing = grouped.get(task.goalId) || []
        grouped.set(task.goalId, [...existing, task])
      }
    })
    return grouped
  }, [tasks])

  // Mutations
  const utils = trpc.useUtils()
  const updateTaskStatusMutation = trpc.tasks.updateStatus.useMutation({
    onSuccess: () => {
      utils.tasks.list.invalidate()
    },
  })
  const createChatMutation = trpc.chats.create.useMutation()

  const toggleGoal = (goalId: string) => {
    setExpandedGoals((prev) => {
      const next = new Set(prev)
      if (next.has(goalId)) {
        next.delete(goalId)
      } else {
        next.add(goalId)
      }
      return next
    })
  }

  const handleTaskClick = async (task: NonNullable<typeof tasks>[number]) => {
    // If task already has a linked chat, navigate to it
    if (task.chatId) {
      setSelectedChatId(task.chatId)
      return
    }

    // Otherwise, create a new chat and start the task
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

      // Update task status and link chat
      await updateTaskStatusMutation.mutateAsync({
        id: task.id,
        status: "in_progress",
      })

      // Navigate to the new chat
      setSelectedChatId(chat.id)

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

  // Calculate progress for a goal
  const getGoalProgress = (goalId: string) => {
    const goalTasks = tasksByGoal.get(goalId) || []
    const total = goalTasks.length
    const done = goalTasks.filter((t) => t.status === "done").length
    return { done, total }
  }

  const isLoading = goalsLoading || tasksLoading

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 text-muted-foreground animate-spin" />
      </div>
    )
  }

  if (!goals || goals.length === 0) {
    return (
      <div className="text-center py-8 px-4">
        <div className="text-muted-foreground/60 text-sm mb-1">No goals yet</div>
        <div className="text-muted-foreground/40 text-xs">
          Create goals to organize your tasks
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-1">
      <AnimatePresence mode="popLayout">
        {goals.map((goal) => {
          const isExpanded = expandedGoals.has(goal.id)
          const goalTasks = tasksByGoal.get(goal.id) || []
          const { done, total } = getGoalProgress(goal.id)
          const statusCfg = goalStatusConfig[goal.status as GoalStatus]

          return (
            <motion.div
              key={goal.id}
              layout
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
            >
              {/* Goal Row */}
              <button
                onClick={() => toggleGoal(goal.id)}
                className={cn(
                  "w-full text-left px-2 py-1.5 rounded-md transition-colors group",
                  "hover:bg-foreground/5 text-foreground"
                )}
              >
                <div className="flex items-center gap-2">
                  <motion.div
                    animate={{ rotate: isExpanded ? 90 : 0 }}
                    transition={{ duration: 0.15 }}
                  >
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                  </motion.div>
                  <Target
                    className={cn(
                      "h-4 w-4 flex-shrink-0",
                      statusCfg?.className || "text-muted-foreground"
                    )}
                  />
                  <span className="text-sm font-medium truncate flex-1">
                    {goal.name}
                  </span>
                  {total > 0 && (
                    <span className="text-xs text-muted-foreground flex-shrink-0">
                      {done}/{total}
                    </span>
                  )}
                </div>
              </button>

              {/* Tasks (nested, animated) */}
              <AnimatePresence>
                {isExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="pl-6 space-y-0.5 py-1">
                      {goalTasks.length > 0 ? (
                        goalTasks.map((task) => {
                          const taskStatus = task.status as TaskStatus
                          const TaskStatusIcon =
                            taskStatusConfig[taskStatus]?.icon || Circle
                          const statusClassName =
                            taskStatusConfig[taskStatus]?.className ||
                            "text-muted-foreground"

                          return (
                            <motion.button
                              key={task.id}
                              layout
                              initial={{ opacity: 0, y: -5 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, scale: 0.95 }}
                              onClick={() => handleTaskClick(task)}
                              disabled={createChatMutation.isPending}
                              className={cn(
                                "w-full text-left px-2 py-1.5 rounded-md transition-colors group",
                                "hover:bg-foreground/5",
                                task.status === "done"
                                  ? "text-muted-foreground"
                                  : "text-foreground/80"
                              )}
                            >
                              <div className="flex items-center gap-2">
                                <TaskStatusIcon
                                  className={cn("h-3.5 w-3.5 flex-shrink-0", statusClassName)}
                                />
                                <span
                                  className={cn(
                                    "text-sm truncate flex-1",
                                    task.status === "done" && "line-through"
                                  )}
                                >
                                  {task.title}
                                </span>
                              </div>
                            </motion.button>
                          )
                        })
                      ) : (
                        <div className="px-2 py-1.5 text-xs text-muted-foreground/60">
                          No tasks in this goal
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}
