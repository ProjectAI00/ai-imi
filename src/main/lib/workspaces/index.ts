import { app } from "electron"
import { join } from "path"
import { mkdir, writeFile, readFile, unlink, access, rm } from "fs/promises"
import matter from "gray-matter"

export function getWorkspacesDir(): string {
  return join(app.getPath("userData"), "workspaces")
}

export function getWorkspaceDir(workspaceId: string): string {
  return join(getWorkspacesDir(), workspaceId)
}

export function getInsightsDir(workspaceId: string): string {
  return join(getWorkspaceDir(workspaceId), "insights")
}

export async function ensureWorkspaceDirs(workspaceId: string): Promise<void> {
  const insightsDir = getInsightsDir(workspaceId)
  await mkdir(insightsDir, { recursive: true })
}

export async function deleteWorkspaceDir(workspaceId: string): Promise<boolean> {
  try {
    await rm(getWorkspaceDir(workspaceId), { recursive: true, force: true })
    return true
  } catch {
    return false
  }
}

export async function writeInsightFile(
  workspaceId: string,
  insightId: string,
  data: {
    title: string
    content: string
    tags?: string[]
    sourceType?: string
    sourceId?: string
  }
): Promise<string> {
  await ensureWorkspaceDirs(workspaceId)

  const filePath = join(getInsightsDir(workspaceId), `${insightId}.md`)
  const relativePath = `${workspaceId}/insights/${insightId}.md`

  const frontmatter = {
    id: insightId,
    title: data.title,
    tags: data.tags || [],
    sourceType: data.sourceType || "manual",
    sourceId: data.sourceId,
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
  }

  const content = matter.stringify(data.content || "", frontmatter)
  await writeFile(filePath, content, "utf-8")

  return relativePath
}

export async function readInsightFile(
  workspaceId: string,
  insightId: string
): Promise<{
  content: string
  frontmatter: Record<string, unknown>
} | null> {
  const filePath = join(getInsightsDir(workspaceId), `${insightId}.md`)

  try {
    await access(filePath)
    const raw = await readFile(filePath, "utf-8")
    const { content, data } = matter(raw)
    return { content, frontmatter: data }
  } catch {
    return null
  }
}

export async function deleteInsightFile(
  workspaceId: string,
  insightId: string
): Promise<boolean> {
  const filePath = join(getInsightsDir(workspaceId), `${insightId}.md`)

  try {
    await unlink(filePath)
    return true
  } catch {
    return false
  }
}

export async function updateInsightFile(
  workspaceId: string,
  insightId: string,
  data: {
    title?: string
    content?: string
    tags?: string[]
  }
): Promise<boolean> {
  const existing = await readInsightFile(workspaceId, insightId)
  if (!existing) return false

  const filePath = join(getInsightsDir(workspaceId), `${insightId}.md`)

  const frontmatter = {
    ...existing.frontmatter,
    title: data.title || existing.frontmatter.title,
    tags: data.tags || existing.frontmatter.tags,
    updated: new Date().toISOString(),
  }

  const content = matter.stringify(data.content ?? existing.content, frontmatter)
  await writeFile(filePath, content, "utf-8")

  return true
}
