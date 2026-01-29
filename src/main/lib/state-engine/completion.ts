import { eq, and } from "drizzle-orm"
import { getDatabase, tasks, goals, memories } from "../db"
import { parseAgentOutput } from "./parser"

/**
 * Handle task completion: parse output, update task, store insights, check goal completion.
 */
export async function onTaskComplete(
  taskId: string,
  agentOutput: string
): Promise<void> {
  const db = getDatabase()

  // 1. Parse output
  const { summary, insights } = parseAgentOutput(agentOutput)

  // 2. Get task from DB
  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get()
  if (!task) {
    throw new Error(`Task not found: ${taskId}`)
  }

  const now = new Date()

  // 3. Update task: status = 'done', summary, completedAt
  db.update(tasks)
    .set({
      status: "done",
      summary,
      completedAt: now,
      updatedAt: now,
    })
    .where(eq(tasks.id, taskId))
    .run()

  // 4. For each insight: upsert into memories table
  if (task.goalId) {
    for (const [key, value] of Object.entries(insights)) {
      const existing = db
        .select()
        .from(memories)
        .where(and(eq(memories.goalId, task.goalId), eq(memories.key, key)))
        .get()

      if (existing) {
        // Update existing memory (no updatedAt in this schema, so just update value)
        db.update(memories)
          .set({ value })
          .where(eq(memories.id, existing.id))
          .run()
      } else {
        db.insert(memories)
          .values({
            goalId: task.goalId,
            taskId,
            key,
            value,
            source: "agent",
          })
          .run()
      }
    }

    // 5. Check if all tasks for goal are done → update goal status
    const pendingTasks = db
      .select()
      .from(tasks)
      .where(and(eq(tasks.goalId, task.goalId), eq(tasks.status, "todo")))
      .all()

    const inProgressTasks = db
      .select()
      .from(tasks)
      .where(and(eq(tasks.goalId, task.goalId), eq(tasks.status, "in_progress")))
      .all()

    if (pendingTasks.length === 0 && inProgressTasks.length === 0) {
      db.update(goals)
        .set({
          status: "done",
          completedAt: now,
          updatedAt: now,
        })
        .where(eq(goals.id, task.goalId))
        .run()
    }
  }
}
