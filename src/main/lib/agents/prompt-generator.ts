/**
 * System Prompt Generator
 *
 * Generates a system prompt from the agent skeleton.
 */

import { AgentSkeleton, TONE_OPTIONS, VERBOSITY_OPTIONS } from "./types"

/**
 * Generate a system prompt from the agent skeleton
 */
export function generateAgentSystemPrompt(skeleton: Partial<AgentSkeleton>): string {
  const sections: string[] = []

  // Role section
  if (skeleton.name && skeleton.description) {
    sections.push(`# Role: ${skeleton.name}\n\n${skeleton.description}`)
  }

  // Personality section
  if (skeleton.personality) {
    const toneOption = TONE_OPTIONS.find((t) => t.value === skeleton.personality?.tone)
    const verbosityOption = VERBOSITY_OPTIONS.find((v) => v.value === skeleton.personality?.verbosity)

    const personalityLines = []

    if (toneOption) {
      personalityLines.push(`Communication style: ${toneOption.label} - ${toneOption.description}`)
    }

    if (verbosityOption) {
      personalityLines.push(`Response length: ${verbosityOption.label} - ${verbosityOption.description}`)
    }

    if (skeleton.personality.style) {
      personalityLines.push(`Additional style notes: ${skeleton.personality.style}`)
    }

    if (personalityLines.length > 0) {
      sections.push(`## Communication\n\n${personalityLines.join("\n")}`)
    }
  }

  // Tools section
  if (skeleton.tools && skeleton.tools.length > 0) {
    const enabledTools = skeleton.tools.filter((t) => t.enabled)

    if (enabledTools.length > 0) {
      const toolsList = enabledTools.map((t) => `- **${t.name}** (${t.type})`).join("\n")
      sections.push(
        `## Available Tools\n\nYou have access to the following tools:\n\n${toolsList}\n\nUse these tools via the platform's HTTP API when needed.`
      )
    }
  }

  // Special instructions
  if (skeleton.specialInstructions) {
    sections.push(`## Special Instructions\n\n${skeleton.specialInstructions}`)
  }

  // Execution preferences
  if (skeleton.preferences) {
    const prefLines = []

    if (skeleton.preferences.defaultCli) {
      prefLines.push(`Preferred CLI: ${skeleton.preferences.defaultCli}`)
    }

    if (skeleton.preferences.maxIterations) {
      prefLines.push(`Maximum iterations per step: ${skeleton.preferences.maxIterations}`)
    }

    if (prefLines.length > 0) {
      sections.push(`## Execution Preferences\n\n${prefLines.join("\n")}`)
    }
  }

  // Core principles
  sections.push(`## Core Principles

1. Always communicate progress clearly
2. Ask for clarification when requirements are ambiguous
3. Break complex tasks into manageable steps
4. Test your work before marking complete
5. Report any blockers immediately`)

  return sections.join("\n\n---\n\n")
}

/**
 * Validate that skeleton has minimum required fields
 */
export function validateAgentSkeleton(
  skeleton: Partial<AgentSkeleton>
): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (!skeleton.name || skeleton.name.trim().length < 2) {
    errors.push("Name must be at least 2 characters")
  }

  if (!skeleton.description || skeleton.description.trim().length < 10) {
    errors.push("Description must be at least 10 characters")
  }

  if (!skeleton.personality?.tone) {
    errors.push("Please select a communication tone")
  }

  if (!skeleton.personality?.verbosity) {
    errors.push("Please select a verbosity level")
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

/**
 * Create a default skeleton with empty values
 */
export function createEmptyAgentSkeleton(): Partial<AgentSkeleton> {
  return {
    name: "",
    description: "",
    personality: {
      tone: "professional",
      verbosity: "balanced",
      style: "",
    },
    tools: [],
    preferences: {
      defaultCli: "claude-code",
      maxIterations: 10,
    },
    systemPrompt: "",
    specialInstructions: "",
  }
}
