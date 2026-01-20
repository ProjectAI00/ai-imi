/**
 * Task Prompt Generator
 *
 * Generates execution prompts for tasks.
 * When a task starts, this creates the prompt sent to the CLI agent.
 */

import { Task, TaskSkeleton, PRIORITY_OPTIONS, TIME_FRAME_OPTIONS } from "./types"

/**
 * Generate an execution prompt for a task
 * This is what gets sent to the CLI agent when the task starts
 */
export function generateTaskPrompt(task: Task | TaskSkeleton, agentContext?: string): string {
  const sections: string[] = []

  // Task header
  sections.push(`# Task: ${task.title}`)

  // Description
  if (task.description) {
    sections.push(`## What Needs To Be Done\n\n${task.description}`)
  }

  // Context
  if (task.context) {
    sections.push(`## Context\n\n${task.context}`)
  }

  // Linked files
  if (task.linkedFiles && task.linkedFiles.length > 0) {
    const filesList = task.linkedFiles.map((f) => `- ${f}`).join("\n")
    sections.push(`## Relevant Files\n\n${filesList}`)
  }

  // Priority and timing
  const priorityOption = PRIORITY_OPTIONS.find((p) => p.value === task.priority)
  const timeFrameOption = TIME_FRAME_OPTIONS.find((t) => t.value === task.timeFrame)

  const timingLines = []
  if (priorityOption) {
    timingLines.push(`Priority: ${priorityOption.label} - ${priorityOption.description}`)
  }
  if (timeFrameOption) {
    timingLines.push(`Time frame: ${timeFrameOption.label}`)
  }
  if (task.dueDate) {
    timingLines.push(`Due: ${task.dueDate.toLocaleDateString()}`)
  }

  if (timingLines.length > 0) {
    sections.push(`## Timing\n\n${timingLines.join("\n")}`)
  }

  // Agent context (if provided)
  if (agentContext) {
    sections.push(`## Agent Instructions\n\n${agentContext}`)
  }

  // Execution guidelines
  sections.push(`## Guidelines

1. Focus on completing this specific task
2. Report progress as you work
3. Ask for clarification if requirements are unclear
4. Test your changes before marking complete
5. Provide a summary when done`)

  return sections.join("\n\n---\n\n")
}

/**
 * Validate that task skeleton has minimum required fields
 */
export function validateTaskSkeleton(
  skeleton: Partial<TaskSkeleton>
): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (!skeleton.title || skeleton.title.trim().length < 2) {
    errors.push("Title must be at least 2 characters")
  }

  if (!skeleton.description || skeleton.description.trim().length < 5) {
    errors.push("Description must be at least 5 characters")
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

/**
 * Create a default task skeleton with empty values
 */
export function createEmptyTaskSkeleton(): Partial<TaskSkeleton> {
  return {
    title: "",
    description: "",
    context: "",
    linkedFiles: [],
    assigneeType: "ai",
    priority: "medium",
    timeFrame: "this_week",
  }
}

/**
 * Create a task from a quick input (minimal info)
 */
export function createQuickTaskSkeleton(title: string): Partial<TaskSkeleton> {
  return {
    title,
    description: title, // Use title as description for quick tasks
    assigneeType: "ai",
    priority: "medium",
    timeFrame: "today",
  }
}

/**
 * Calculate due date from time frame
 */
export function calculateDueDate(timeFrame: TaskSkeleton["timeFrame"]): Date | undefined {
  const now = new Date()

  switch (timeFrame) {
    case "today":
      return new Date(now.setHours(23, 59, 59, 999))
    case "tomorrow":
      return new Date(now.setDate(now.getDate() + 1))
    case "this_week": {
      const daysUntilFriday = 5 - now.getDay()
      return new Date(now.setDate(now.getDate() + (daysUntilFriday > 0 ? daysUntilFriday : 7)))
    }
    case "next_week":
      return new Date(now.setDate(now.getDate() + 7))
    case "no_rush":
    default:
      return undefined
  }
}
