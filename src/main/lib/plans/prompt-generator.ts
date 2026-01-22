/**
 * Plan Prompt Generator
 *
 * Generates markdown prompts for AI to understand plans.
 */

import {
  PlanSkeleton,
  PlanStep,
  COMPLEXITY_OPTIONS,
  STEP_STATUS_OPTIONS,
  APPROVAL_STATUS_OPTIONS,
} from "./types"

/**
 * Generate a markdown prompt from the plan skeleton
 */
export function generatePlanPrompt(
  plan: Partial<PlanSkeleton>,
  goalContext?: { name?: string; description?: string }
): string {
  const sections: string[] = []

  // Plan header
  if (plan.name) {
    sections.push(`# Plan: ${plan.name}`)
  }

  // Description
  if (plan.description) {
    sections.push(`## Description\n\n${plan.description}`)
  }

  // Goal context if linked
  if (goalContext?.name || plan.goalId) {
    const goalLines: string[] = []
    if (goalContext?.name) {
      goalLines.push(`**Goal:** ${goalContext.name}`)
    } else if (plan.goalId) {
      goalLines.push(`**Goal ID:** ${plan.goalId}`)
    }
    if (goalContext?.description) {
      goalLines.push(`\n${goalContext.description}`)
    }
    sections.push(`## Parent Goal\n\n${goalLines.join("\n")}`)
  }

  // Approval status
  if (plan.approvalStatus) {
    const statusOption = APPROVAL_STATUS_OPTIONS.find((s) => s.value === plan.approvalStatus)
    if (statusOption) {
      sections.push(`## Status\n\n**Approval:** ${statusOption.label} - ${statusOption.description}`)
    }
  }

  // Steps section
  if (plan.steps && plan.steps.length > 0) {
    const stepsMarkdown = plan.steps
      .sort((a, b) => a.order - b.order)
      .map((step, index) => formatStepMarkdown(step, index, plan.steps || []))
      .join("\n\n")

    sections.push(`## Steps\n\n${stepsMarkdown}`)
  }

  // Context
  if (plan.context) {
    sections.push(`## Additional Context\n\n${plan.context}`)
  }

  // Tags
  if (plan.tags && plan.tags.length > 0) {
    sections.push(`## Tags\n\n${plan.tags.map((t) => `\`${t}\``).join(" ")}`)
  }

  // Generated tasks
  if (plan.tasks && plan.tasks.length > 0) {
    sections.push(`## Generated Tasks\n\n${plan.tasks.map((t) => `- Task ID: ${t}`).join("\n")}`)
  }

  // Instructions for AI
  sections.push(`## Instructions

When executing this plan:
1. Follow steps in order, respecting dependencies
2. Complete each step fully before moving on
3. Update step status as you progress
4. Report blockers immediately
5. Verify completion criteria for each step`)

  return sections.join("\n\n---\n\n")
}

/**
 * Format a single step as markdown
 */
function formatStepMarkdown(
  step: PlanStep,
  index: number,
  allSteps: PlanStep[]
): string {
  const lines: string[] = []

  // Step header with status indicator
  const statusEmoji = getStatusEmoji(step.status)
  lines.push(`### ${statusEmoji} Step ${index + 1}: ${step.title}`)

  // Description
  lines.push(`\n${step.description}`)

  // Metadata
  const metaLines: string[] = []

  const complexityOption = COMPLEXITY_OPTIONS.find((c) => c.value === step.complexity)
  if (complexityOption) {
    metaLines.push(`**Complexity:** ${complexityOption.label}`)
  }

  if (step.estimatedDuration) {
    metaLines.push(`**Duration:** ${step.estimatedDuration}`)
  }

  const statusOption = STEP_STATUS_OPTIONS.find((s) => s.value === step.status)
  if (statusOption) {
    metaLines.push(`**Status:** ${statusOption.label}`)
  }

  if (metaLines.length > 0) {
    lines.push(`\n${metaLines.join(" | ")}`)
  }

  // Dependencies
  if (step.dependencies && step.dependencies.length > 0) {
    const depSteps = step.dependencies
      .map((depId) => allSteps.find((s) => s.id === depId))
      .filter(Boolean)
      .map((s) => s!.title)

    if (depSteps.length > 0) {
      lines.push(`\n**Depends on:** ${depSteps.join(", ")}`)
    }
  }

  // Files
  if (step.files && step.files.length > 0) {
    const filesPreview =
      step.files.length <= 3
        ? step.files.join(", ")
        : `${step.files.slice(0, 3).join(", ")} (+${step.files.length - 3} more)`
    lines.push(`\n**Files:** ${filesPreview}`)
  }

  return lines.join("")
}

/**
 * Get emoji indicator for step status
 */
function getStatusEmoji(status: PlanStep["status"]): string {
  switch (status) {
    case "pending":
      return "⬜"
    case "in_progress":
      return "🔄"
    case "completed":
      return "✅"
    case "skipped":
      return "⏭️"
    default:
      return "⬜"
  }
}

/**
 * Generate a summary prompt for plan review
 */
export function generatePlanSummary(plan: Partial<PlanSkeleton>): string {
  const lines: string[] = []

  lines.push(`**Plan:** ${plan.name || "Unnamed"}`)
  lines.push(`**Steps:** ${plan.steps?.length || 0}`)

  if (plan.steps && plan.steps.length > 0) {
    const complexityCounts = {
      simple: plan.steps.filter((s) => s.complexity === "simple").length,
      medium: plan.steps.filter((s) => s.complexity === "medium").length,
      complex: plan.steps.filter((s) => s.complexity === "complex").length,
    }

    const complexityStr = Object.entries(complexityCounts)
      .filter(([, count]) => count > 0)
      .map(([level, count]) => `${count} ${level}`)
      .join(", ")

    lines.push(`**Complexity:** ${complexityStr}`)

    const withDeps = plan.steps.filter(
      (s) => s.dependencies && s.dependencies.length > 0
    ).length
    if (withDeps > 0) {
      lines.push(`**Steps with dependencies:** ${withDeps}`)
    }
  }

  if (plan.goalId) {
    lines.push(`**Linked to goal:** ${plan.goalId}`)
  }

  return lines.join("\n")
}
