import { useMemo, useState } from "react"
import { Button } from "../../../components/ui/button"
import { Textarea } from "../../../components/ui/textarea"
import { cn } from "../../../lib/utils"
import { AlertCircle, CheckCircle2, Circle, Loader2, Target } from "lucide-react"

type GoalStatus = "todo" | "ongoing" | "review" | "done"
type TaskStatus = "todo" | "in_progress" | "review" | "done"
type Priority = "low" | "medium" | "high"

type WorkspaceGoal = {
  id: string
  name: string
  description: string
  context?: string | null
  status: GoalStatus | string
  priority: Priority | string
}

type WorkspaceTask = {
  id: string
  title: string
  description: string
  context?: string | null
  status: TaskStatus | string
  priority: Priority | string
  summary: string | null
  chatId?: string | null
  projectId?: string | null
}

interface TasksWorkspacePanelProps {
  goal: WorkspaceGoal | null
  goals: WorkspaceGoal[]
  tasks: WorkspaceTask[]
  selectedTaskId: string | null
  onBackToTaskBar: () => void
  onBackFromTaskDetail: () => void
  onSaveGoalInput: (goalId: string, input: string) => Promise<void>
  onFollowUp: () => void
  onMoveChatBack: () => void
  onOpenTasksSidebar: () => void
  onSelectGoal: (goalId: string) => void
  onSelectTask: (taskId: string) => void
  onOpenTaskChat: (taskId: string) => void
  onSaveTaskInstruction: (taskId: string, instruction: string) => Promise<void>
}

const goalStatusLabel: Record<string, string> = {
  todo: "Todo",
  ongoing: "In Progress",
  review: "Review",
  done: "Done",
}

const goalStatusClassName: Record<string, string> = {
  todo: "bg-muted text-muted-foreground",
  ongoing: "bg-blue-500/10 text-blue-500",
  review: "bg-orange-500/10 text-orange-500",
  done: "bg-green-500/10 text-green-500",
}

const priorityClassName: Record<string, string> = {
  low: "bg-muted text-muted-foreground",
  medium: "bg-blue-500/10 text-blue-500",
  high: "bg-orange-500/10 text-orange-500",
}

const taskStatusIcon: Record<string, typeof Circle> = {
  todo: Circle,
  in_progress: Loader2,
  review: AlertCircle,
  done: CheckCircle2,
}

const taskStatusClassName: Record<string, string> = {
  todo: "text-muted-foreground",
  in_progress: "text-blue-500",
  review: "text-orange-500",
  done: "text-green-500",
}

export function TasksWorkspacePanel({
  goal,
  goals,
  tasks,
  selectedTaskId,
  onBackToTaskBar,
  onBackFromTaskDetail,
  onSaveGoalInput,
  onFollowUp,
  onMoveChatBack,
  onOpenTasksSidebar,
  onSelectGoal,
  onSelectTask,
  onOpenTaskChat,
  onSaveTaskInstruction,
}: TasksWorkspacePanelProps) {
  const [activeStatus, setActiveStatus] = useState<GoalStatus>("todo")
  const [goalInputText, setGoalInputText] = useState("")
  const [isSavingGoalInput, setIsSavingGoalInput] = useState(false)
  const [instructionText, setInstructionText] = useState("")
  const [isSavingInstruction, setIsSavingInstruction] = useState(false)
  const goalCounts = useMemo(() => {
    return {
      todo: goals.filter((item) => item.status === "todo").length,
      ongoing: goals.filter((item) => item.status === "ongoing").length,
      review: goals.filter((item) => item.status === "review").length,
    }
  }, [goals])
  const filteredGoals = useMemo(
    () => goals.filter((item) => item.status === activeStatus),
    [goals, activeStatus],
  )
  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId) || null,
    [tasks, selectedTaskId],
  )
  const selectedTaskHasError = useMemo(() => {
    if (!selectedTask) return false
    return (
      selectedTask.status === "review" &&
      !!selectedTask.summary &&
      /(error|failed|exception|blocked)/i.test(selectedTask.summary)
    )
  }, [selectedTask])

  if (!goal) {
    return (
      <div className="h-full overflow-y-auto px-5 py-4">
        <div className="mx-auto w-full max-w-3xl py-2 space-y-4">
          <div className="inline-flex items-center rounded-lg bg-muted/40 p-1">
            {(["todo", "ongoing", "review"] as const).map((status) => (
              <button
                key={status}
                onClick={() => setActiveStatus(status)}
                className={cn(
                  "h-8 rounded-md px-3 text-sm capitalize",
                  activeStatus === status
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {status === "ongoing" ? "Ongoing" : goalStatusLabel[status]} ({goalCounts[status]})
              </button>
            ))}
          </div>

          {filteredGoals.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
              No {goalStatusLabel[activeStatus].toLowerCase()} goals yet.
            </div>
          ) : (
            <div className="space-y-2">
              {filteredGoals.map((item) => (
                <button
                  key={item.id}
                  onClick={() => onSelectGoal(item.id)}
                  className="w-full rounded-lg border border-border/70 bg-muted/20 px-4 py-3 text-left hover:bg-muted/40"
                >
                  <p className="text-lg font-semibold truncate">{item.name}</p>
                  <div className="mt-1 flex items-center gap-2">
                    <span
                      className={cn(
                        "inline-flex rounded-md px-2 py-0.5 text-xs",
                        priorityClassName[item.priority] || "bg-muted text-muted-foreground",
                      )}
                    >
                      {item.priority}
                    </span>
                    <span className="text-sm text-muted-foreground truncate">{item.description}</span>
                  </div>
                </button>
              ))}
            </div>
          )}

          <div className="pt-1">
            <Button size="sm" variant="ghost" onClick={onOpenTasksSidebar}>
              Open tasks sidebar
            </Button>
          </div>
        </div>
      </div>
    )
  }

  if (selectedTask) {
    return (
      <div className="h-full overflow-y-auto px-5 py-4">
        <div className="mx-auto w-full max-w-3xl py-2 space-y-4">
          <Button size="sm" variant="ghost" className="h-7 px-2 text-muted-foreground" onClick={onBackFromTaskDetail}>
            Back
          </Button>
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-[11px]">
              <span className="inline-flex rounded-md bg-muted px-2 py-0.5 text-muted-foreground">{selectedTask.status}</span>
              <span
                className={cn(
                  "inline-flex rounded-md px-2 py-0.5",
                  priorityClassName[selectedTask.priority] || "bg-muted text-muted-foreground",
                )}
              >
                {selectedTask.priority}
              </span>
            </div>
            <h2 className="text-3xl font-semibold text-balance">{selectedTask.title}</h2>
            <p className="text-base text-muted-foreground text-pretty">{selectedTask.description}</p>
          </div>
          <div className="rounded-lg border border-border/70 bg-muted/20 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Task activity</p>
              <span className="text-xs text-muted-foreground">{selectedTask.status}</span>
            </div>
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">Agent summary</p>
              <p className="text-sm text-muted-foreground text-pretty">
                {selectedTask.summary
                  ? selectedTask.summary
                  : selectedTask.status === "in_progress"
                    ? "Agent is currently working on this task. Open chat to add guidance."
                    : selectedTask.status === "review"
                      ? "This task is in review. Open chat to leave feedback."
                      : "No execution summary yet. Open chat to start or continue this task."}
              </p>
              {selectedTaskHasError ? (
                <p className="text-xs text-orange-500">Execution flagged an issue. Please review and send feedback.</p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">Add instruction</p>
              <Textarea
                value={instructionText}
                onChange={(event) => setInstructionText(event.target.value)}
                placeholder="Add guidance for this task..."
                className="min-h-[78px] resize-none text-sm"
              />
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={() => onOpenTaskChat(selectedTask.id)}>
                Open task chat
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!instructionText.trim() || isSavingInstruction}
                onClick={async () => {
                  const instruction = instructionText.trim()
                  if (!instruction) return
                  setIsSavingInstruction(true)
                  try {
                    await onSaveTaskInstruction(selectedTask.id, instruction)
                    setInstructionText("")
                  } finally {
                    setIsSavingInstruction(false)
                  }
                }}
              >
                Add instruction
              </Button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const completedCount = tasks.filter((task) => task.status === "done").length

  return (
    <div className="h-full overflow-y-auto px-5 py-4">
      <div className="mx-auto w-full max-w-3xl py-2 space-y-5">
        <div className="space-y-2.5">
          <Button size="sm" variant="ghost" className="h-7 px-2 text-muted-foreground" onClick={onBackToTaskBar}>
            Back
          </Button>
          <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
            <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-muted-foreground">
              <Target className="h-3 w-3" />
              Goal workspace
            </span>
            <span
              className={cn(
                "inline-flex items-center rounded-md px-2 py-0.5 tabular-nums",
                goalStatusClassName[goal.status] || "bg-muted text-muted-foreground",
              )}
            >
              {goalStatusLabel[goal.status] || goal.status}
            </span>
            <span
              className={cn(
                "inline-flex items-center rounded-md px-2 py-0.5 tabular-nums",
                priorityClassName[goal.priority] || "bg-muted text-muted-foreground",
              )}
            >
              {goal.priority}
            </span>
            <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-muted-foreground tabular-nums">
              {completedCount}/{tasks.length} done
            </span>
          </div>

          <h1 className="text-[38px] leading-[1.06] font-semibold tracking-tight text-balance">{goal.name}</h1>
          <p className="text-base text-muted-foreground leading-relaxed text-pretty max-w-[90%]">{goal.description}</p>
        </div>

        <div className="space-y-3">
            <div className="flex items-center justify-between pb-1 border-b border-border/60">
              <h2 className="text-sm font-medium text-muted-foreground">Sub-tasks</h2>
              <Button size="sm" variant="ghost" className="h-7 px-2.5 text-muted-foreground" onClick={onFollowUp}>
                Open IMI Ops
              </Button>
            </div>

          {tasks.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
              No tasks in this goal yet.
            </div>
          ) : (
            <div className="space-y-1.5">
              {tasks.map((task) => {
                const TaskIcon = taskStatusIcon[task.status] || Circle
                return (
                  <button
                    key={task.id}
                    onClick={() => onSelectTask(task.id)}
                    className={cn(
                      "w-full rounded-md border px-3 py-2.5 space-y-1.5 bg-muted/20 text-left hover:bg-muted/30",
                      selectedTaskId === task.id ? "border-primary/40 bg-primary/5" : "border-border/70",
                    )}
                  >
                    <div className="flex items-start gap-2">
                      <TaskIcon
                        className={cn(
                          "h-4 w-4 mt-0.5",
                          taskStatusClassName[task.status] || "text-muted-foreground",
                          task.status === "in_progress" && "animate-spin",
                        )}
                      />
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <p className="text-sm font-medium truncate leading-5">{task.title}</p>
                        <p className="text-xs text-muted-foreground line-clamp-2 text-pretty leading-5">
                          {task.description}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-[11px] flex-wrap">
                      <span className="inline-flex rounded-md bg-muted px-2 py-0.5 text-muted-foreground">
                        {task.status}
                      </span>
                      <span
                        className={cn(
                          "inline-flex rounded-md px-2 py-0.5",
                          priorityClassName[task.priority] || "bg-muted text-muted-foreground",
                        )}
                      >
                        {task.priority}
                      </span>
                      {task.summary ? (
                        <span className="inline-flex rounded-md bg-green-500/10 px-2 py-0.5 text-green-600">
                          Summary ready
                        </span>
                      ) : null}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <div className="rounded-lg border border-border/70 bg-muted/20 p-3 space-y-2">
          <p className="text-sm font-medium">Goal input</p>
          <p className="text-xs text-muted-foreground">Add extra direction. IMI will use this context across task orchestration.</p>
          <Textarea
            value={goalInputText}
            onChange={(event) => setGoalInputText(event.target.value)}
            placeholder="Add direction, constraints, or new requirements for this goal..."
            className="min-h-[78px] resize-none text-sm"
          />
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={!goalInputText.trim() || isSavingGoalInput}
              onClick={async () => {
                const input = goalInputText.trim()
                if (!input) return
                setIsSavingGoalInput(true)
                try {
                  await onSaveGoalInput(goal.id, input)
                  setGoalInputText("")
                } finally {
                  setIsSavingGoalInput(false)
                }
              }}
            >
              Add to goal
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-2 pt-1">
          <Button className="h-8 px-3" onClick={onFollowUp}>Open IMI Ops chat</Button>
          <Button className="h-8 px-2.5" variant="ghost" onClick={onMoveChatBack}>
            Move chat back
          </Button>
        </div>
      </div>
    </div>
  )
}
