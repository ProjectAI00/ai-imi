import { z } from "zod"
import { router, publicProcedure } from "../index"
import { getDatabase, insights } from "../../db"
import { eq, desc, and, like } from "drizzle-orm"
import {
  writeInsightFile,
  readInsightFile,
  deleteInsightFile,
  updateInsightFile,
} from "../../workspaces"

export const insightsRouter = router({
  list: publicProcedure
    .input(
      z
        .object({
          workspaceId: z.string().optional(),
          limit: z.number().optional().default(50),
        })
        .optional()
    )
    .query(({ input }) => {
      const db = getDatabase()
      let query = db.select().from(insights)

      if (input?.workspaceId) {
        query = query.where(
          eq(insights.workspaceId, input.workspaceId)
        ) as typeof query
      }

      return query
        .orderBy(desc(insights.createdAt))
        .limit(input?.limit || 50)
        .all()
    }),

  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      const db = getDatabase()
      const insight = db
        .select()
        .from(insights)
        .where(eq(insights.id, input.id))
        .get()
      if (!insight) return null

      const file = await readInsightFile(insight.workspaceId, insight.id)
      return {
        ...insight,
        tags: JSON.parse(insight.tags || "[]"),
        content: file?.content || "",
      }
    }),

  create: publicProcedure
    .input(
      z.object({
        workspaceId: z.string(),
        title: z.string().min(1),
        summary: z.string().optional(),
        content: z.string().optional(),
        tags: z.array(z.string()).optional(),
        sourceType: z
          .enum(["conversation", "goal", "task", "manual"])
          .optional(),
        sourceId: z.string().optional(),
        createdBy: z.enum(["user", "ai"]).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDatabase()

      const record = db
        .insert(insights)
        .values({
          workspaceId: input.workspaceId,
          title: input.title,
          summary: input.summary,
          filePath: "",
          sourceType: input.sourceType || "manual",
          sourceId: input.sourceId,
          tags: JSON.stringify(input.tags || []),
          createdBy: input.createdBy || "user",
        })
        .returning()
        .get()

      try {
        const filePath = await writeInsightFile(input.workspaceId, record.id, {
          title: input.title,
          content: input.content || "",
          tags: input.tags,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
        })

        return db
          .update(insights)
          .set({ filePath })
          .where(eq(insights.id, record.id))
          .returning()
          .get()
      } catch (err) {
        // Rollback: delete the DB record if file write failed
        db.delete(insights).where(eq(insights.id, record.id)).run()
        throw err
      }
    }),

  update: publicProcedure
    .input(
      z.object({
        id: z.string(),
        title: z.string().optional(),
        summary: z.string().optional(),
        content: z.string().optional(),
        tags: z.array(z.string()).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDatabase()
      const existing = db
        .select()
        .from(insights)
        .where(eq(insights.id, input.id))
        .get()
      if (!existing) return null

      await updateInsightFile(existing.workspaceId, existing.id, {
        title: input.title,
        content: input.content,
        tags: input.tags,
      })

      const updates: Record<string, unknown> = { updatedAt: new Date() }
      if (input.title) updates.title = input.title
      if (input.summary) updates.summary = input.summary
      if (input.tags) updates.tags = JSON.stringify(input.tags)

      return db
        .update(insights)
        .set(updates)
        .where(eq(insights.id, input.id))
        .returning()
        .get()
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const db = getDatabase()
      const existing = db
        .select()
        .from(insights)
        .where(eq(insights.id, input.id))
        .get()
      if (!existing) return null

      await deleteInsightFile(existing.workspaceId, existing.id)
      return db
        .delete(insights)
        .where(eq(insights.id, input.id))
        .returning()
        .get()
    }),

  search: publicProcedure
    .input(
      z.object({
        query: z.string(),
        workspaceId: z.string().optional(),
      })
    )
    .query(({ input }) => {
      const db = getDatabase()
      const searchPattern = `%${input.query}%`

      const conditions = [like(insights.title, searchPattern)]
      if (input.workspaceId) {
        conditions.push(eq(insights.workspaceId, input.workspaceId))
      }

      return db
        .select()
        .from(insights)
        .where(and(...conditions))
        .orderBy(desc(insights.updatedAt))
        .all()
    }),
})

export type { Insight, NewInsight } from "../../db/schema"
