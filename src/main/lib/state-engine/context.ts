import { getDatabase, tasks, goals, memories } from "../db"
import { eq } from "drizzle-orm"

/**
 * Build execution context for a GOAL (orchestrator mode)
 * Agent sees all tasks and decides execution strategy (parallel vs sequential)
 */
export function buildContextForGoal(goalId: string): string {
  const db = getDatabase()

  const goal = db.select().from(goals).where(eq(goals.id, goalId)).get()
  if (!goal) {
    throw new Error(`Goal not found: ${goalId}`)
  }

  const goalTasks = db.select().from(tasks).where(eq(tasks.goalId, goalId)).all()
  const goalMemories = db.select().from(memories).where(eq(memories.goalId, goalId)).all()

  const todoTasks = goalTasks.filter((t) => t.status === "todo")
  const inProgressTasks = goalTasks.filter((t) => t.status === "in_progress")
  const completedTasks = goalTasks.filter((t) => t.status === "done")

  const parts: string[] = []

  // Goal overview
  parts.push(`# Goal: ${goal.name}`)
  parts.push("")
  parts.push(goal.description)
  parts.push("")

  if (goal.context) {
    parts.push(`## User Context`)
    parts.push(goal.context)
    parts.push("")
  }

  // Workspace and files context
  if (goal.workspacePath) {
    parts.push(`## Workspace`)
    parts.push(`Working directory: ${goal.workspacePath}`)
    parts.push("")
  }

  const relevantFiles = goal.relevantFiles ? JSON.parse(goal.relevantFiles) : []
  if (relevantFiles.length > 0) {
    parts.push(`## Relevant Files`)
    parts.push(`These files are important for this goal:`)
    relevantFiles.forEach((f: string) => parts.push(`- ${f}`))
    parts.push("")
  }

  // All tasks with status
  parts.push(`## Tasks Overview (${completedTasks.length}/${goalTasks.length} complete)`)
  parts.push("")
  goalTasks.forEach((t, i) => {
    const statusIcon = t.status === "done" ? "✅" : t.status === "in_progress" ? "🔄" : "⬜"
    parts.push(`${i + 1}. ${statusIcon} **${t.title}** [${t.status}]`)
    parts.push(`   ${t.description}`)
    if (t.status === "done" && t.summary) {
      const summaryClean = t.summary.replace(/INSIGHT:.*$/gm, "").replace(/SUMMARY:\s*/g, "").trim()
      parts.push(`   → Result: ${summaryClean.substring(0, 150)}${summaryClean.length > 150 ? "..." : ""}`)
    }
    parts.push("")
  })

  // Insights learned
  if (goalMemories.length > 0) {
    parts.push(`## Insights (from completed work)`)
    goalMemories.forEach((m) => {
      parts.push(`- **${m.key}**: ${m.value}`)
    })
    parts.push("")
  }

  // Execution instructions
  parts.push(`## Your Job: Execute This Goal`)
  parts.push("")
  parts.push(`You are the orchestrator. Analyze all tasks and execute them efficiently.`)
  parts.push("")
  parts.push(`### Execution Strategy`)
  parts.push("")
  parts.push(`1. **Analyze dependencies**: Which tasks depend on others? Which are independent?`)
  parts.push("")
  parts.push(`2. **Sequential tasks**: If task B needs task A's output → do A first, then B.`)
  parts.push("")
  parts.push(`3. **Parallel tasks**: If tasks are independent (don't share files, no dependencies):`)
  parts.push(`   - Use the \`task\` tool to spawn sub-agents`)
  parts.push(`   - Maximum 3 parallel tasks at once`)
  parts.push(`   - Each runs in isolation, reports back when done`)
  parts.push("")
  parts.push(`4. **After each task completes**, report:`)
  parts.push("   ```")
  parts.push(`   TASK_DONE: <task number>`)
  parts.push(`   SUMMARY: <what was accomplished>`)
  parts.push(`   INSIGHT: <key> = <value>  (any decisions/learnings)`)
  parts.push("   ```")
  parts.push("")
  parts.push(`### Conflict Check (before parallelizing)`)
  parts.push(`- Do tasks touch the same files? → Sequential`)
  parts.push(`- Does one need output from another? → Sequential`)  
  parts.push(`- Completely independent? → Can parallelize`)
  parts.push("")
  parts.push(`### Begin`)
  parts.push("")
  parts.push(`Analyze the ${todoTasks.length} remaining tasks. State your execution plan, then start working.`)

  return parts.join("\n")
}

/**
 * Build execution context for a single TASK
 * Agent focuses on this task but understands its place in the goal
 */
export function buildContextForTask(taskId: string): string {
  const db = getDatabase()

  // 1. Get the task from DB
  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get()

  if (!task) {
    throw new Error(`Task not found: ${taskId}`)
  }

  // 2. Get the goal it belongs to
  if (!task.goalId) {
    throw new Error(`Task ${taskId} has no associated goal`)
  }

  const goal = db.select().from(goals).where(eq(goals.id, task.goalId)).get()

  if (!goal) {
    throw new Error(`Goal not found: ${task.goalId}`)
  }

  // 3. Get all tasks for that goal
  const goalTasks = db.select().from(tasks).where(eq(tasks.goalId, task.goalId)).all()

  // Separate completed tasks (with summaries) from others
  const completedTasks = goalTasks.filter((t) => t.status === "done" && t.summary)
  const totalTasks = goalTasks.length
  const completedCount = goalTasks.filter((t) => t.status === "done").length

  // 4. Get all memories for that goal from the memories table
  const goalMemories = db.select().from(memories).where(eq(memories.goalId, task.goalId)).all()

  // 5. Build formatted markdown string
  const parts: string[] = []

  // Goal section
  parts.push(`## Goal: ${goal.name}`)
  parts.push(goal.description)
  parts.push("")

  if (goal.context) {
    parts.push(`User notes: ${goal.context}`)
    parts.push("")
  }

  // Current task section
  parts.push(`## Your Current Task: ${task.title}`)
  parts.push(task.description)
  parts.push("")

  // Task-specific files
  const taskFiles = task.relevantFiles ? JSON.parse(task.relevantFiles) : []
  if (taskFiles.length > 0) {
    parts.push(`### Relevant Files for This Task`)
    taskFiles.forEach((f: string) => parts.push(`- ${f}`))
    parts.push("")
  }

  // Show ALL tasks so agent understands context
  const taskIndex = goalTasks.findIndex((t) => t.id === taskId)
  parts.push(`## All Tasks in This Goal (${completedCount}/${totalTasks} done)`)
  goalTasks.forEach((t, i) => {
    const isCurrent = t.id === taskId
    const statusIcon = t.status === "done" ? "✅" : t.status === "in_progress" ? "🔄" : "⬜"
    const marker = isCurrent ? "→ " : "  "
    parts.push(`${marker}${i + 1}. ${statusIcon} ${t.title}${isCurrent ? " ← YOU ARE HERE" : ""}`)
  })
  parts.push("")

  // Progress section
  parts.push(`## Progress: ${completedCount}/${totalTasks} tasks done`)
  parts.push("")

  // Completed work section
  parts.push("## Completed Work")
  if (completedTasks.length > 0) {
    for (const completedTask of completedTasks) {
      // Extract just the summary part (before any INSIGHT lines)
      const summaryText = completedTask.summary
        ?.replace(/INSIGHT:\s*\w+\s*=\s*.+/g, "")
        .replace(/SUMMARY:\s*/g, "")
        .trim()
      parts.push(`- ${completedTask.title}: ${summaryText || "Completed"}`)
    }
  } else {
    parts.push("No tasks completed yet.")
  }
  parts.push("")

  // Memories/insights section
  parts.push("## What We Know (Insights)")
  if (goalMemories.length > 0) {
    for (const memory of goalMemories) {
      parts.push(`- ${memory.key}: ${memory.value}`)
    }
  } else {
    parts.push("No insights recorded yet.")
  }
  parts.push("")

  // Task correlation context
  parts.push("## Understanding Your Task")
  parts.push("")
  parts.push("You are working on ONE task within a larger goal. Keep in mind:")
  parts.push("- Your work may be used by subsequent tasks")
  parts.push("- Previous tasks may have set up things you can use")
  parts.push("- Record any decisions that future tasks need to know")
  parts.push("")

  // Output instructions
  parts.push("## Output Instructions")
  parts.push("When you complete this task:")
  parts.push("")
  parts.push("1. Summarize what you did:")
  parts.push("SUMMARY: [2-5 sentences describing what was accomplished]")
  parts.push("")
  parts.push("2. Record any decisions or insights (IMPORTANT for future tasks):")
  parts.push("INSIGHT: key = value")
  parts.push("")
  parts.push("Examples:")
  parts.push("INSIGHT: auth_provider = Clerk")
  parts.push("INSIGHT: database = PostgreSQL with Drizzle")
  parts.push("INSIGHT: api_pattern = REST with /api/v1 prefix")
  parts.push("INSIGHT: test_framework = Vitest")

  return parts.join("\n")
}
