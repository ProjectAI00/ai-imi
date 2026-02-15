import { z } from "zod"
import { router, publicProcedure } from "../index"
import { getDatabase, goals, plans, tasks } from "../../db"
import { eq, desc, and, sql } from "drizzle-orm"

// Input schemas
const statusSchema = z.enum(["todo", "ongoing", "review", "done"])
const prioritySchema = z.enum(["low", "medium", "high", "urgent"])

export const goalsRouter = router({
  /**
   * List all goals, optionally filter by workspaceId, status
   */
  list: publicProcedure
    .input(
      z
        .object({
          workspaceId: z.string().optional(),
          status: statusSchema.optional(),
          limit: z.number().optional().default(50),
        })
        .optional()
    )
    .query(({ input }) => {
      const db = getDatabase()
      let query = db.select().from(goals)

      const conditions = []
      if (input?.workspaceId) {
        conditions.push(eq(goals.workspaceId, input.workspaceId))
      }
      if (input?.status) {
        conditions.push(eq(goals.status, input.status))
      }

      if (conditions.length > 0) {
        query = query.where(and(...conditions)) as typeof query
      }

      const results = query.orderBy(desc(goals.createdAt)).all()

      if (input?.limit) {
        return results.slice(0, input.limit)
      }

      return results
    }),

  /**
   * Get single goal by ID
   */
  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(({ input }) => {
      const db = getDatabase()
      return db.select().from(goals).where(eq(goals.id, input.id)).get()
    }),

  /**
   * Create new goal from skeleton
   */
  create: publicProcedure
    .input(
      z.object({
        name: z.string().min(2),
        description: z.string().min(5),
        workspaceId: z.string().optional(),
        workspacePath: z.string().optional(),
        priority: prioritySchema.default("medium"),
        context: z.string().optional(),
        tags: z.array(z.string()).optional(),
        relevantFiles: z.array(z.string()).optional(),
      })
    )
    .mutation(({ input }) => {
      const db = getDatabase()

      return db
        .insert(goals)
        .values({
          name: input.name,
          description: input.description,
          workspaceId: input.workspaceId,
          workspacePath: input.workspacePath,
          priority: input.priority,
          context: input.context,
          tags: JSON.stringify(input.tags || []),
          relevantFiles: JSON.stringify(input.relevantFiles || []),
          status: "todo",
        })
        .returning()
        .get()
    }),

  /**
   * Update goal status
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

      if (input.status === "done") {
        updates.completedAt = new Date()
      }

      return db.update(goals).set(updates).where(eq(goals.id, input.id)).returning().get()
    }),

  /**
   * Update goal fields
   */
  update: publicProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().optional(),
        description: z.string().optional(),
        priority: prioritySchema.optional(),
        context: z.string().optional(),
        tags: z.array(z.string()).optional(),
        workspacePath: z.string().optional(),
        relevantFiles: z.array(z.string()).optional(),
      })
    )
    .mutation(({ input }) => {
      const db = getDatabase()
      const { id, tags, relevantFiles, ...rest } = input

      const updates: Record<string, unknown> = {
        ...rest,
        updatedAt: new Date(),
      }

      if (tags !== undefined) {
        updates.tags = JSON.stringify(tags)
      }

      if (relevantFiles !== undefined) {
        updates.relevantFiles = JSON.stringify(relevantFiles)
      }

      return db.update(goals).set(updates).where(eq(goals.id, id)).returning().get()
    }),

  /**
   * Get goal with all plans and tasks (for board view)
   */
  getWithPlansAndTasks: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(({ input }) => {
      const db = getDatabase()

      const goal = db.select().from(goals).where(eq(goals.id, input.id)).get()
      if (!goal) {
        return null
      }

      const goalPlans = db.select().from(plans).where(eq(plans.goalId, input.id)).all()

      // Get tasks linked to this goal's plans
      const planIds = goalPlans.map((p) => p.id)
      let goalTasks: typeof tasks.$inferSelect[] = []
      if (planIds.length > 0) {
        goalTasks = db
          .select()
          .from(tasks)
          .where(sql`${tasks.planId} IN (${planIds.map((id) => `'${id}'`).join(",")})`)
          .all()
      }

      return {
        ...goal,
        tags: JSON.parse(goal.tags || "[]") as string[],
        plans: goalPlans.map((plan) => ({
          ...plan,
          steps: JSON.parse(plan.steps || "[]"),
          tasks: goalTasks.filter((t) => t.planId === plan.id),
        })),
      }
    }),

  /**
   * Delete goal
   */
  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => {
      const db = getDatabase()
      return db.delete(goals).where(eq(goals.id, input.id)).returning().get()
    }),

  /**
   * Get counts by status
   */
  counts: publicProcedure
    .input(z.object({ workspaceId: z.string().optional() }).optional())
    .query(({ input }) => {
      const db = getDatabase()

      let query = db.select().from(goals)
      if (input?.workspaceId) {
        query = query.where(eq(goals.workspaceId, input.workspaceId)) as typeof query
      }

      const allGoals = query.all()

      return {
        todo: allGoals.filter((g) => g.status === "todo").length,
        ongoing: allGoals.filter((g) => g.status === "ongoing").length,
        review: allGoals.filter((g) => g.status === "review").length,
        done: allGoals.filter((g) => g.status === "done").length,
        total: allGoals.length,
      }
    }),

  /**
   * Create goal from Plan Mode builder output
   */
  createFromBuilder: publicProcedure
    .input(
      z.object({
        name: z.string().min(2),
        description: z.string().min(5),
        priority: prioritySchema.default("medium"),
        context: z.string().optional(),
        workspaceId: z.string().optional(),
        workspacePath: z.string().optional(),
        relevantFiles: z.array(z.string()).optional(),
      })
    )
    .mutation(({ input }) => {
      const db = getDatabase()

      const goal = db
        .insert(goals)
        .values({
          name: input.name,
          description: input.description,
          workspaceId: input.workspaceId,
          workspacePath: input.workspacePath,
          priority: input.priority,
          context: input.context,
          tags: "[]",
          relevantFiles: JSON.stringify(input.relevantFiles || []),
          status: "todo",
        })
        .returning()
        .get()

      return { id: goal.id }
    }),
})

// Re-export types from schema
export type { Goal, NewGoal } from "../../db/schema"
