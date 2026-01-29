import { z } from "zod"
import { router, publicProcedure } from "../index"
import { getDatabase, tasks, agents, chats } from "../../db"
import { eq, desc, and, isNull } from "drizzle-orm"
import {
  generateTaskPrompt,
  validateTaskSkeleton,
  createEmptyTaskSkeleton,
  createQuickTaskSkeleton,
  calculateDueDate,
} from "../../tasks"
import type { TaskSkeleton } from "../../tasks"

// Input schemas
const taskSkeletonSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  context: z.string().optional(),
  linkedFiles: z.array(z.string()).optional(),
  projectId: z.string().optional(),
  assigneeType: z.enum(["ai"]).default("ai"),
  agentId: z.string().optional(),
  teamId: z.string().optional(),
  tags: z.array(z.string()).optional(),
  timeFrame: z.enum(["today", "tomorrow", "this_week", "next_week", "no_rush"]).default("this_week"),
  dueDate: z.date().optional(),
  priority: z.enum(["low", "medium", "high"]).default("medium"),
})

const statusSchema = z.enum(["todo", "in_progress", "review", "done"])

export const tasksRouter = router({
  /**
   * List all tasks
   */
  list: publicProcedure
    .input(
      z
        .object({
          status: statusSchema.optional(),
          projectId: z.string().optional(),
          agentId: z.string().optional(),
          goalId: z.string().optional(),
          limit: z.number().optional(),
        })
        .optional()
    )
    .query(({ input }) => {
      const db = getDatabase()
      let query = db.select().from(tasks)

      // Build conditions
      const conditions = []
      if (input?.status) {
        conditions.push(eq(tasks.status, input.status))
      }
      if (input?.projectId) {
        conditions.push(eq(tasks.projectId, input.projectId))
      }
      if (input?.agentId) {
        conditions.push(eq(tasks.agentId, input.agentId))
      }
      if (input?.goalId) {
        conditions.push(eq(tasks.goalId, input.goalId))
      }

      if (conditions.length > 0) {
        query = query.where(and(...conditions)) as typeof query
      }

      const results = query.orderBy(desc(tasks.createdAt)).all()

      if (input?.limit) {
        return results.slice(0, input.limit)
      }

      return results
    }),

  /**
   * Get a single task by ID
   */
  get: publicProcedure.input(z.object({ id: z.string() })).query(({ input }) => {
    const db = getDatabase()
    return db.select().from(tasks).where(eq(tasks.id, input.id)).get()
  }),

  /**
   * Create a task from skeleton (Q&A flow result)
   */
  create: publicProcedure.input(taskSkeletonSchema).mutation(({ input }) => {
    const db = getDatabase()

    // Validate skeleton
    const validation = validateTaskSkeleton(input as Partial<TaskSkeleton>)
    if (!validation.valid) {
      throw new Error(`Invalid task: ${validation.errors.join(", ")}`)
    }

    // Calculate due date from time frame if not provided
    const dueDate = input.dueDate || calculateDueDate(input.timeFrame)

    return db
      .insert(tasks)
      .values({
        title: input.title,
        description: input.description,
        context: input.context,
        linkedFiles: JSON.stringify(input.linkedFiles || []),
        projectId: input.projectId,
        assigneeType: input.assigneeType,
        agentId: input.agentId,
        teamId: input.teamId,
        tags: JSON.stringify(input.tags || []),
        timeFrame: input.timeFrame,
        dueDate,
        priority: input.priority,
        status: "todo",
        createdBy: "user",
      })
      .returning()
      .get()
  }),

  /**
   * Quick create a task (minimal input)
   */
  quickCreate: publicProcedure
    .input(
      z.object({
        title: z.string().min(1),
        projectId: z.string().optional(),
        priority: z.enum(["low", "medium", "high"]).optional(),
        timeFrame: z.enum(["today", "tomorrow", "this_week", "next_week", "no_rush"]).optional(),
      })
    )
    .mutation(({ input }) => {
      const db = getDatabase()

      const skeleton = createQuickTaskSkeleton(input.title)
      const timeFrame = input.timeFrame || skeleton.timeFrame || "today"
      const dueDate = calculateDueDate(timeFrame)

      return db
        .insert(tasks)
        .values({
          title: input.title,
          description: input.title,
          projectId: input.projectId,
          assigneeType: "ai",
          timeFrame,
          dueDate,
          priority: input.priority || "medium",
          status: "todo",
          createdBy: "user",
        })
        .returning()
        .get()
    }),

  /**
   * Update task status
   */
  updateStatus: publicProcedure
    .input(
      z.object({
        id: z.string(),
        status: statusSchema,
      })
    )
    .mutation(({ input }) => {
      const db = getDatabase()

      const updates: Record<string, unknown> = {
        status: input.status,
        updatedAt: new Date(),
      }

      // Set completedAt when marking as done
      if (input.status === "done") {
        updates.completedAt = new Date()
      }

      return db.update(tasks).set(updates).where(eq(tasks.id, input.id)).returning().get()
    }),

  /**
   * Update task details
   */
  update: publicProcedure
    .input(
      z.object({
        id: z.string(),
        title: z.string().optional(),
        description: z.string().optional(),
        context: z.string().optional(),
        priority: z.enum(["low", "medium", "high"]).optional(),
        timeFrame: z.enum(["today", "tomorrow", "this_week", "next_week", "no_rush"]).optional(),
        dueDate: z.date().optional(),
        agentId: z.string().nullable().optional(),
        projectId: z.string().nullable().optional(),
        summary: z.string().optional(),
      })
    )
    .mutation(({ input }) => {
      const db = getDatabase()
      const { id, ...updates } = input

      // Calculate due date if time frame changed
      if (updates.timeFrame && !updates.dueDate) {
        updates.dueDate = calculateDueDate(updates.timeFrame) as Date | undefined
      }

      return db
        .update(tasks)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(tasks.id, id))
        .returning()
        .get()
    }),

  /**
   * Link a chat to a task (for execution)
   */
  linkChat: publicProcedure
    .input(
      z.object({
        taskId: z.string(),
        chatId: z.string(),
      })
    )
    .mutation(({ input }) => {
      const db = getDatabase()
      return db
        .update(tasks)
        .set({
          chatId: input.chatId,
          status: "in_progress",
          updatedAt: new Date(),
        })
        .where(eq(tasks.id, input.taskId))
        .returning()
        .get()
    }),

  /**
   * Complete a task with summary
   */
  complete: publicProcedure
    .input(
      z.object({
        id: z.string(),
        summary: z.string(),
      })
    )
    .mutation(({ input }) => {
      const db = getDatabase()
      return db
        .update(tasks)
        .set({
          status: "done",
          summary: input.summary,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(tasks.id, input.id))
        .returning()
        .get()
    }),

  /**
   * Delete a task
   */
  delete: publicProcedure.input(z.object({ id: z.string() })).mutation(({ input }) => {
    const db = getDatabase()
    return db.delete(tasks).where(eq(tasks.id, input.id)).returning().get()
  }),

  /**
   * Get task counts by status
   */
  counts: publicProcedure.query(() => {
    const db = getDatabase()
    const allTasks = db.select().from(tasks).all()

    return {
      todo: allTasks.filter((t) => t.status === "todo").length,
      in_progress: allTasks.filter((t) => t.status === "in_progress").length,
      review: allTasks.filter((t) => t.status === "review").length,
      done: allTasks.filter((t) => t.status === "done").length,
      total: allTasks.length,
    }
  }),

  /**
   * Generate execution prompt for a task
   */
  getExecutionPrompt: publicProcedure.input(z.object({ id: z.string() })).query(({ input }) => {
    const db = getDatabase()
    const task = db.select().from(tasks).where(eq(tasks.id, input.id)).get()

    if (!task) {
      throw new Error("Task not found")
    }

    // Get agent context if assigned
    let agentContext: string | undefined
    if (task.agentId) {
      const agent = db.select().from(agents).where(eq(agents.id, task.agentId)).get()
      if (agent) {
        agentContext = agent.systemPrompt
      }
    }

    // Parse JSON fields
    const taskWithParsedFields = {
      ...task,
      linkedFiles: JSON.parse(task.linkedFiles || "[]") as string[],
      tags: JSON.parse(task.tags || "[]") as string[],
    }

    return generateTaskPrompt(taskWithParsedFields as unknown as TaskSkeleton, agentContext)
  }),

  /**
   * Get empty skeleton (for UI initialization)
   */
  getEmptySkeleton: publicProcedure.query(() => {
    return createEmptyTaskSkeleton()
  }),

  /**
   * Delegate task to agent for execution
   */
  delegate: publicProcedure
    .input(
      z.object({
        taskId: z.string(),
        agentId: z.string().optional(),
        format: z.enum(["yaml", "json", "toom", "ralphy"]).default("json"),
      })
    )
    .mutation(({ input }) => {
      const db = getDatabase()

      const task = db.select().from(tasks).where(eq(tasks.id, input.taskId)).get()

      if (!task) {
        throw new Error("Task not found")
      }

      // Get agent context if provided
      let agentContext: string | undefined
      if (input.agentId) {
        const agent = db.select().from(agents).where(eq(agents.id, input.agentId)).get()
        if (agent) {
          agentContext = agent.systemPrompt
        }
      }

      // Parse JSON fields
      const taskWithParsedFields = {
        ...task,
        linkedFiles: JSON.parse(task.linkedFiles || "[]") as string[],
        tags: JSON.parse(task.tags || "[]") as string[],
      }

      // Generate execution payload based on format
      let executionPayload: string
      const basePayload = {
        taskId: task.id,
        title: task.title,
        description: task.description,
        context: task.context,
        linkedFiles: taskWithParsedFields.linkedFiles,
        priority: task.priority,
        agentContext,
      }

      switch (input.format) {
        case "yaml":
          executionPayload = Object.entries(basePayload)
            .filter(([_, v]) => v !== undefined && v !== null)
            .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`)
            .join("\n")
          break
        case "toom":
        case "ralphy":
          executionPayload = `# Task: ${task.title}\n\n${task.description}\n\n${task.context ? `## Context\n${task.context}\n\n` : ""}${taskWithParsedFields.linkedFiles.length > 0 ? `## Files\n${taskWithParsedFields.linkedFiles.join("\n")}` : ""}`
          break
        case "json":
        default:
          executionPayload = JSON.stringify(basePayload, null, 2)
      }

      // Update task with delegation info
      return db
        .update(tasks)
        .set({
          agentId: input.agentId || task.agentId,
          status: "in_progress",
          updatedAt: new Date(),
        })
        .where(eq(tasks.id, input.taskId))
        .returning()
        .get()
    }),

  /**
   * Create tasks from Plan Mode builder output
   */
  createFromBuilder: publicProcedure
    .input(
      z.object({
        goalId: z.string(),
        tasks: z.array(
          z.object({
            title: z.string().min(1),
            description: z.string().min(1),
            priority: z.enum(["low", "medium", "high"]).default("medium"),
            timeFrame: z.enum(["today", "tomorrow", "this_week", "next_week", "no_rush"]).default("this_week"),
            context: z.string().optional(),
            tags: z.array(z.string()).optional(),
          })
        ),
        projectId: z.string().optional(),
      })
    )
    .mutation(({ input }) => {
      const db = getDatabase()

      const createdIds: string[] = []

      for (const taskInput of input.tasks) {
        const dueDate = calculateDueDate(taskInput.timeFrame)

        const task = db
          .insert(tasks)
          .values({
            title: taskInput.title,
            description: taskInput.description,
            context: taskInput.context,
            linkedFiles: "[]",
            projectId: input.projectId,
            goalId: input.goalId,
            assigneeType: "ai",
            tags: JSON.stringify(taskInput.tags || []),
            timeFrame: taskInput.timeFrame,
            dueDate,
            priority: taskInput.priority,
            status: "todo",
            createdBy: "ai",
          })
          .returning()
          .get()

        createdIds.push(task.id)
      }

      return { ids: createdIds }
    }),

  /**
   * Get execution payload for CLI injection
   */
  getExecutionPayload: publicProcedure
    .input(
      z.object({
        taskId: z.string(),
        format: z.enum(["yaml", "json", "toom", "ralphy"]).optional(),
      })
    )
    .query(({ input }) => {
      const db = getDatabase()

      const task = db.select().from(tasks).where(eq(tasks.id, input.taskId)).get()

      if (!task) {
        throw new Error("Task not found")
      }

      // Get agent context if assigned
      let agentContext: string | undefined
      if (task.agentId) {
        const agent = db.select().from(agents).where(eq(agents.id, task.agentId)).get()
        if (agent) {
          agentContext = agent.systemPrompt
        }
      }

      // Parse JSON fields
      const taskWithParsedFields = {
        ...task,
        linkedFiles: JSON.parse(task.linkedFiles || "[]") as string[],
        tags: JSON.parse(task.tags || "[]") as string[],
      }

      const format = input.format || "json"
      const basePayload = {
        taskId: task.id,
        title: task.title,
        description: task.description,
        context: task.context,
        linkedFiles: taskWithParsedFields.linkedFiles,
        priority: task.priority,
        agentContext,
      }

      switch (format) {
        case "yaml":
          return {
            format: "yaml",
            payload: Object.entries(basePayload)
              .filter(([_, v]) => v !== undefined && v !== null)
              .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`)
              .join("\n"),
          }
        case "toom":
        case "ralphy":
          return {
            format,
            payload: `# Task: ${task.title}\n\n${task.description}\n\n${task.context ? `## Context\n${task.context}\n\n` : ""}${taskWithParsedFields.linkedFiles.length > 0 ? `## Files\n${taskWithParsedFields.linkedFiles.join("\n")}` : ""}`,
          }
        case "json":
        default:
          return {
            format: "json",
            payload: JSON.stringify(basePayload, null, 2),
          }
      }
    }),
})
