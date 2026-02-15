import { Button } from "../../../components/ui/button"
import { cn } from "../../../lib/utils"
import { AlertCircle, CheckCircle2, Circle, Loader2, Target } from "lucide-react"

type GoalStatus = "todo" | "ongoing" | "review" | "done"
type TaskStatus = "todo" | "in_progress" | "review" | "done"
type Priority = "low" | "medium" | "high"

type WorkspaceGoal = {
  id: string
  name: string
  description: string
  status: GoalStatus | string
  priority: Priority | string
}

type WorkspaceTask = {
  id: string
  title: string
  description: string
  status: TaskStatus | string
  priority: Priority | string
  summary: string | null
}

interface TasksWorkspacePanelProps {
  goal: WorkspaceGoal | null
  tasks: WorkspaceTask[]
  selectedTaskId: string | null
  onFollowUp: () => void
  onMoveChatBack: () => void
  onOpenTasksSidebar: () => void
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
  tasks,
  selectedTaskId,
  onFollowUp,
  onMoveChatBack,
  onOpenTasksSidebar,
}: TasksWorkspacePanelProps) {
  if (!goal) {
    return (
      <div className="h-full flex items-center justify-center p-6">
        <div className="max-w-md rounded-xl border border-border bg-card p-6 text-center space-y-4">
          <h2 className="text-lg font-semibold text-balance">Select a goal to open its workspace</h2>
          <p className="text-sm text-muted-foreground text-pretty">
            Use the left Tasks sidebar to open a goal. You will see status, subtasks, and follow-up actions here.
          </p>
          <Button size="sm" onClick={onOpenTasksSidebar}>
            Open tasks sidebar
          </Button>
        </div>
      </div>
    )
  }

  const completedCount = tasks.filter((task) => task.status === "done").length

  return (
    <div className="h-full overflow-y-auto px-5 py-4">
      <div className="mx-auto w-full max-w-3xl py-2 space-y-5">
        <div className="space-y-2.5">
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
              Follow up
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
                  <div
                    key={task.id}
                    className={cn(
                      "rounded-md border px-3 py-2.5 space-y-1.5 bg-muted/20",
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
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 pt-1">
          <Button className="h-8 px-3" onClick={onFollowUp}>Follow up in chat</Button>
          <Button className="h-8 px-2.5" variant="ghost" onClick={onMoveChatBack}>
            Move chat back
          </Button>
        </div>
      </div>
    </div>
  )
}
