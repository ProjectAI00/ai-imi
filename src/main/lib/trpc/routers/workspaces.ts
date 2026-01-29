import { z } from "zod"
import { router, publicProcedure } from "../index"
import { getDatabase, workspaces, goals, tasks, insights } from "../../db"
import { eq, desc } from "drizzle-orm"
import { deleteWorkspaceDir } from "../../workspaces"

export const workspacesRouter = router({
  list: publicProcedure.query(() => {
    const db = getDatabase()
    return db.select().from(workspaces).orderBy(desc(workspaces.createdAt)).all()
  }),

  getDefault: publicProcedure.query(() => {
    const db = getDatabase()
    // Return first workspace (created on app init)
    return db.select().from(workspaces).limit(1).get() ?? null
  }),

  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(({ input }) => {
      const db = getDatabase()
      return db.select().from(workspaces).where(eq(workspaces.id, input.id)).get()
    }),

  create: publicProcedure
    .input(z.object({
      name: z.string().min(1),
      description: z.string().optional(),
      color: z.string().optional(),
      icon: z.string().optional(),
    }))
    .mutation(({ input }) => {
      const db = getDatabase()
      return db.insert(workspaces).values(input).returning().get()
    }),

  update: publicProcedure
    .input(z.object({
      id: z.string(),
      name: z.string().optional(),
      description: z.string().optional(),
      color: z.string().optional(),
      icon: z.string().optional(),
    }))
    .mutation(({ input }) => {
      const db = getDatabase()
      const { id, ...updates } = input
      return db.update(workspaces)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(workspaces.id, id))
        .returning()
        .get()
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const db = getDatabase()
      const result = db.delete(workspaces).where(eq(workspaces.id, input.id)).returning().get()
      await deleteWorkspaceDir(input.id)
      return result
    }),

  getWithStats: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(({ input }) => {
      const db = getDatabase()
      const workspace = db.select().from(workspaces).where(eq(workspaces.id, input.id)).get()
      if (!workspace) return null

      const goalCount = db.select().from(goals).where(eq(goals.workspaceId, input.id)).all().length
      const taskCount = db.select().from(tasks).where(eq(tasks.workspaceId, input.id)).all().length
      const insightCount = db.select().from(insights).where(eq(insights.workspaceId, input.id)).all().length

      return {
        ...workspace,
        stats: { goals: goalCount, tasks: taskCount, insights: insightCount }
      }
    }),
})

export type { Workspace, NewWorkspace } from "../../db/schema"
