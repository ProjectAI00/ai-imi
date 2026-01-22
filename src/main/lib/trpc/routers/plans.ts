import { z } from "zod"
import { router, publicProcedure } from "../index"
import { getDatabase, goals, plans, tasks } from "../../db"
import { eq, desc, and } from "drizzle-orm"

// Step schema for plan steps
const stepSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  complexity: z.enum(["simple", "medium", "complex"]).default("medium"),
  estimatedDuration: z.string().optional(),
  dependencies: z.array(z.string()).optional(),
  files: z.array(z.string()).optional(),
  status: z.enum(["pending", "in_progress", "completed", "skipped"]).default("pending"),
})

export const plansRouter = router({
  /**
   * List plans, optionally filter by goalId, status
   */
  list: publicProcedure
    .input(
      z
        .object({
          goalId: z.string().optional(),
          status: z.string().optional(),
          limit: z.number().optional().default(50),
        })
        .optional()
    )
    .query(({ input }) => {
      const db = getDatabase()
      let query = db.select().from(plans)

      const conditions = []
      if (input?.goalId) {
        conditions.push(eq(plans.goalId, input.goalId))
      }
      if (input?.status) {
        conditions.push(eq(plans.approvalStatus, input.status))
      }

      if (conditions.length > 0) {
        query = query.where(and(...conditions)) as typeof query
      }

      const results = query.orderBy(desc(plans.createdAt)).all()

      if (input?.limit) {
        return results.slice(0, input.limit)
      }

      return results.map((plan) => ({
        ...plan,
        steps: JSON.parse(plan.steps || "[]"),
      }))
    }),

  /**
   * Get single plan
   */
  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(({ input }) => {
      const db = getDatabase()
      const plan = db.select().from(plans).where(eq(plans.id, input.id)).get()

      if (!plan) {
        return null
      }

      return {
        ...plan,
        steps: JSON.parse(plan.steps || "[]"),
      }
    }),

  /**
   * Create plan
   */
  create: publicProcedure
    .input(
      z.object({
        name: z.string().min(2),
        description: z.string().min(5),
        goalId: z.string().optional(),
        steps: z.array(stepSchema).optional().default([]),
      })
    )
    .mutation(({ input }) => {
      const db = getDatabase()

      const result = db
        .insert(plans)
        .values({
          name: input.name,
          description: input.description,
          goalId: input.goalId,
          steps: JSON.stringify(input.steps),
          approvalStatus: "pending",
        })
        .returning()
        .get()

      return {
        ...result,
        steps: JSON.parse(result.steps || "[]"),
      }
    }),

  /**
   * Update plan
   */
  update: publicProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().optional(),
        description: z.string().optional(),
        steps: z.array(z.any()).optional(),
      })
    )
    .mutation(({ input }) => {
      const db = getDatabase()
      const { id, steps, ...rest } = input

      const updates: Record<string, unknown> = {
        ...rest,
        updatedAt: new Date(),
      }

      if (steps !== undefined) {
        updates.steps = JSON.stringify(steps)
      }

      const result = db
        .update(plans)
        .set(updates)
        .where(eq(plans.id, id))
        .returning()
        .get()

      return {
        ...result,
        steps: JSON.parse(result.steps || "[]"),
      }
    }),

  /**
   * Approve plan (changes approvalStatus, optionally generates tasks)
   */
  approve: publicProcedure
    .input(
      z.object({
        id: z.string(),
        generateTasks: z.boolean().default(true),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDatabase()

      // Update approval status
      const plan = db
        .update(plans)
        .set({
          approvalStatus: "approved",
          updatedAt: new Date(),
        })
        .where(eq(plans.id, input.id))
        .returning()
        .get()

      if (!plan) {
        throw new Error("Plan not found")
      }

      let taskIds: string[] = []

      // Generate tasks if requested
      if (input.generateTasks) {
        const steps = JSON.parse(plan.steps || "[]")

        for (const step of steps) {
          const task = db
            .insert(tasks)
            .values({
              title: step.title,
              description: step.description,
              planId: plan.id,
              status: "todo",
              priority: step.complexity === "complex" ? "high" : step.complexity === "simple" ? "low" : "medium",
              createdBy: "plan",
            })
            .returning()
            .get()

          taskIds.push(task.id)
        }
      }

      return {
        ...plan,
        steps: JSON.parse(plan.steps || "[]"),
        taskIds,
      }
    }),

  /**
   * Generate tasks from plan steps
   */
  generateTasksFromPlan: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => {
      const db = getDatabase()

      const plan = db.select().from(plans).where(eq(plans.id, input.id)).get()

      if (!plan) {
        throw new Error("Plan not found")
      }

      const steps = JSON.parse(plan.steps || "[]")
      const createdTasks: unknown[] = []

      for (const step of steps) {
        const task = db
          .insert(tasks)
          .values({
            title: step.title,
            description: step.description,
            planId: plan.id,
            status: "todo",
            priority: step.complexity === "complex" ? "high" : step.complexity === "simple" ? "low" : "medium",
            linkedFiles: JSON.stringify(step.files || []),
            createdBy: "plan",
          })
          .returning()
          .get()

        createdTasks.push(task)
      }

      return createdTasks
    }),

  /**
   * Delete plan
   */
  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => {
      const db = getDatabase()
      return db.delete(plans).where(eq(plans.id, input.id)).returning().get()
    }),

  /**
   * Get plan with associated goal
   */
  getWithGoal: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(({ input }) => {
      const db = getDatabase()

      const plan = db.select().from(plans).where(eq(plans.id, input.id)).get()

      if (!plan) {
        return null
      }

      let goal = null
      if (plan.goalId) {
        goal = db.select().from(goals).where(eq(goals.id, plan.goalId)).get()
      }

      return {
        ...plan,
        steps: JSON.parse(plan.steps || "[]"),
        goal: goal
          ? {
              ...goal,
              tags: JSON.parse(goal.tags || "[]"),
            }
          : null,
      }
    }),
})

// Re-export types from schema
export type { Plan, NewPlan } from "../../db/schema"
