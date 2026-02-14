/**
 * Prompts Index
 *
 * Combines all prompt modules and exports the main getRootSystemPrompt function.
 */

import { IDENTITY_PROMPT } from "./identity"
import { PLAN_MODE_PROMPT } from "./plan-mode"
import { EXECUTE_MODE_PROMPT } from "./execute-mode"
import { ASK_MODE_PROMPT } from "./ask-mode"

// Re-export individual prompts for direct access if needed
export { IDENTITY_PROMPT } from "./identity"
export { PLAN_MODE_PROMPT } from "./plan-mode"
export { EXECUTE_MODE_PROMPT } from "./execute-mode"
export { ASK_MODE_PROMPT } from "./ask-mode"

// Legacy export for backwards compatibility
export const ROOT_SYSTEM_PROMPT = IDENTITY_PROMPT

/**
 * Get the root system prompt, optionally with additional context
 */
export function getRootSystemPrompt(context?: {
  workspaceName?: string
  workspacePath?: string
  projectType?: string
  additionalContext?: string
  mode?: "plan" | "agent" | "ask"
  isExecutingGoal?: boolean // true when goalId or taskId provided
  mentionedFiles?: string[]
}): string {
  let prompt = IDENTITY_PROMPT

  // Add mode-specific instructions
  if (context?.mode === "plan") {
    prompt += `\n\n${PLAN_MODE_PROMPT}`

    // Add pre-filled context for plan mode
    if (context.workspacePath || context.mentionedFiles?.length) {
      const prefilledLines: string[] = []
      prefilledLines.push(`\n### Pre-filled Context (use these values)`)

      if (context.workspacePath) {
        prefilledLines.push(
          `- **workspacePath**: \`${context.workspacePath}\` (already known - use this exact path)`,
        )
      }

      if (context.mentionedFiles?.length) {
        prefilledLines.push(
          `- **relevantFiles**: ${JSON.stringify(context.mentionedFiles)} (files mentioned in conversation)`,
        )
      }

      prefilledLines.push(
        `\nDon't ask about these - they're already provided. Just use them in the JSON output.`,
      )

      prompt += `\n${prefilledLines.join("\n")}`
    }
  }

  // Add ask mode instructions
  if (context?.mode === "ask") {
    prompt += `\n\n${ASK_MODE_PROMPT}`
  }

  // Add execute mode instructions when working on goals/tasks
  if (context?.isExecutingGoal) {
    prompt += `\n\n${EXECUTE_MODE_PROMPT}`
  }

  if (
    context?.workspaceName ||
    context?.workspacePath ||
    context?.projectType ||
    context?.additionalContext
  ) {
    const contextLines: string[] = []

    if (context.workspaceName) {
      contextLines.push(`Current workspace: ${context.workspaceName}`)
    }

    if (context.workspacePath) {
      contextLines.push(`Workspace path: ${context.workspacePath}`)
    }

    if (context.projectType) {
      contextLines.push(`Project type: ${context.projectType}`)
    }

    if (context.additionalContext) {
      contextLines.push(context.additionalContext)
    }

    prompt += `\n\n---\n\n## Current Context\n\n${contextLines.join("\n")}`
  }

  return prompt
}
