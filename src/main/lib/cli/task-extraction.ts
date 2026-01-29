/**
 * Task Extraction Utility
 *
 * Parses assistant messages to extract structured task definitions
 * from the ```tasks code block format.
 */

import type { TaskSkeleton } from "../tasks/types"

/**
 * Extracted task from AI response
 */
export interface ExtractedTask {
  title: string
  description: string
  priority?: "low" | "medium" | "high"
  timeFrame?: "today" | "tomorrow" | "this_week" | "next_week" | "no_rush"
  context?: string
  tags?: string[]
}

/**
 * Result of task extraction
 */
export interface TaskExtractionResult {
  tasks: ExtractedTask[]
  rawJson: string | null
  error: string | null
}

/**
 * Extract tasks from assistant text
 *
 * Looks for ```tasks ... ``` code blocks containing JSON task arrays
 */
export function extractTasksFromText(text: string): TaskExtractionResult {
  // Match ```tasks ... ``` blocks (case insensitive)
  const tasksBlockRegex = /```tasks\s*([\s\S]*?)```/gi
  const matches = text.match(tasksBlockRegex)

  if (!matches || matches.length === 0) {
    return { tasks: [], rawJson: null, error: null }
  }

  // Take the last tasks block (in case there are multiple)
  const lastMatch = matches[matches.length - 1]
  const jsonContent = lastMatch.replace(/```tasks\s*/i, "").replace(/```$/, "").trim()

  if (!jsonContent) {
    return { tasks: [], rawJson: null, error: null }
  }

  try {
    const parsed = JSON.parse(jsonContent)

    // Validate it's an array
    if (!Array.isArray(parsed)) {
      return {
        tasks: [],
        rawJson: jsonContent,
        error: "Tasks must be an array",
      }
    }

    // Validate and clean each task
    const validTasks: ExtractedTask[] = []
    const errors: string[] = []

    for (let i = 0; i < parsed.length; i++) {
      const task = parsed[i]
      const taskNum = i + 1

      // Required fields
      if (!task.title || typeof task.title !== "string") {
        errors.push(`Task ${taskNum}: missing or invalid title`)
        continue
      }
      if (!task.description || typeof task.description !== "string") {
        errors.push(`Task ${taskNum}: missing or invalid description`)
        continue
      }

      // Validate optional fields
      const validPriorities = ["low", "medium", "high"]
      const validTimeFrames = ["today", "tomorrow", "this_week", "next_week", "no_rush"]

      const cleanTask: ExtractedTask = {
        title: task.title.trim(),
        description: task.description.trim(),
      }

      if (task.priority && validPriorities.includes(task.priority)) {
        cleanTask.priority = task.priority
      }

      if (task.timeFrame && validTimeFrames.includes(task.timeFrame)) {
        cleanTask.timeFrame = task.timeFrame
      }

      if (task.context && typeof task.context === "string") {
        cleanTask.context = task.context.trim()
      }

      if (Array.isArray(task.tags)) {
        cleanTask.tags = task.tags.filter((t: unknown) => typeof t === "string")
      }

      validTasks.push(cleanTask)
    }

    return {
      tasks: validTasks,
      rawJson: jsonContent,
      error: errors.length > 0 ? errors.join("; ") : null,
    }
  } catch (err) {
    return {
      tasks: [],
      rawJson: jsonContent,
      error: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

/**
 * Convert extracted tasks to TaskSkeleton format for database insertion
 */
export function toTaskSkeletons(
  extracted: ExtractedTask[],
  defaults?: {
    projectId?: string
    chatId?: string
  }
): Partial<TaskSkeleton>[] {
  return extracted.map((task) => ({
    title: task.title,
    description: task.description,
    priority: task.priority || "medium",
    timeFrame: task.timeFrame || "this_week",
    context: task.context,
    tags: task.tags,
    projectId: defaults?.projectId,
    assigneeType: "ai" as const,
  }))
}

/**
 * Check if text contains task definitions
 */
export function hasTaskDefinitions(text: string): boolean {
  return /```tasks\s*\[/i.test(text)
}
