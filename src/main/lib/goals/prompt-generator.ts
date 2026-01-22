/**
 * Goal Prompt Generator
 *
 * Generates markdown prompts for AI to understand goals.
 */

import { GoalSkeleton, PRIORITY_OPTIONS, GOAL_STATUS_OPTIONS } from "./types"

/**
 * Generate a markdown prompt from the goal skeleton
 */
export function generateGoalPrompt(
  goal: Partial<GoalSkeleton>,
  context?: { workspace?: string; relatedFiles?: string[] }
): string {
  const sections: string[] = []

  // Goal header
  if (goal.name) {
    sections.push(`# Goal: ${goal.name}`)
  }

  // Description
  if (goal.description) {
    sections.push(`## Description\n\n${goal.description}`)
  }

  // Priority and status
  const metaLines: string[] = []
  
  if (goal.priority) {
    const priorityOption = PRIORITY_OPTIONS.find((p) => p.value === goal.priority)
    if (priorityOption) {
      metaLines.push(`**Priority:** ${priorityOption.label} - ${priorityOption.description}`)
    }
  }

  if (goal.status) {
    const statusOption = GOAL_STATUS_OPTIONS.find((s) => s.value === goal.status)
    if (statusOption) {
      metaLines.push(`**Status:** ${statusOption.label}`)
    }
  }

  if (goal.dueDate) {
    metaLines.push(`**Due Date:** ${goal.dueDate.toLocaleDateString()}`)
  }

  if (metaLines.length > 0) {
    sections.push(`## Meta\n\n${metaLines.join("\n")}`)
  }

  // Context section
  const contextLines: string[] = []
  
  if (goal.context) {
    contextLines.push(goal.context)
  }

  if (context?.workspace) {
    contextLines.push(`\n**Workspace:** ${context.workspace}`)
  }

  if (context?.relatedFiles && context.relatedFiles.length > 0) {
    contextLines.push(`\n**Related Files:**\n${context.relatedFiles.map((f) => `- ${f}`).join("\n")}`)
  }

  if (contextLines.length > 0) {
    sections.push(`## Context\n\n${contextLines.join("\n")}`)
  }

  // Tags
  if (goal.tags && goal.tags.length > 0) {
    sections.push(`## Tags\n\n${goal.tags.map((t) => `\`${t}\``).join(" ")}`)
  }

  // Plans (if any)
  if (goal.plans && goal.plans.length > 0) {
    sections.push(`## Linked Plans\n\n${goal.plans.map((p) => `- Plan ID: ${p}`).join("\n")}`)
  }

  // Instructions for AI
  sections.push(`## Instructions

When working on this goal:
1. Break it down into actionable plans
2. Identify dependencies and blockers
3. Estimate effort for each plan
4. Report progress regularly
5. Flag any scope changes or concerns`)

  return sections.join("\n\n---\n\n")
}
