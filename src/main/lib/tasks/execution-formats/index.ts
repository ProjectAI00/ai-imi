/**
 * Execution Formats
 *
 * Utilities for serializing task payloads in various formats for CLI consumption.
 */

import type { ExecutionFormat, ExecutionPayload } from "./types"
import { toJson } from "./json"
import { toYaml } from "./yaml"

export * from "./types"
export { toJson } from "./json"
export { toYaml } from "./yaml"

/**
 * Toom format - a compact, shell-friendly format
 * Format: KEY=value pairs, one per line
 */
function toToom(payload: ExecutionPayload): string {
  const lines: string[] = []

  lines.push(`TASK_ID=${payload.task_id}`)
  lines.push(`TITLE=${payload.title}`)
  lines.push(`DESCRIPTION=${payload.description}`)

  if (payload.context) {
    lines.push(`CONTEXT=${payload.context}`)
  }

  if (payload.files && payload.files.length > 0) {
    lines.push(`FILES=${payload.files.join(",")}`)
  }

  if (payload.goal_context) {
    lines.push(`GOAL_CONTEXT=${payload.goal_context}`)
  }

  if (payload.agent_instructions) {
    lines.push(`AGENT_INSTRUCTIONS=${payload.agent_instructions}`)
  }

  if (payload.priority) {
    lines.push(`PRIORITY=${payload.priority}`)
  }

  if (payload.metadata) {
    lines.push(`METADATA=${JSON.stringify(payload.metadata)}`)
  }

  return lines.join("\n")
}

/**
 * Ralphy format - structured markdown-like format for AI consumption
 */
function toRalphy(payload: ExecutionPayload): string {
  const sections: string[] = []

  sections.push(`# Task: ${payload.title}`)
  sections.push(`ID: ${payload.task_id}`)
  sections.push("")
  sections.push("## Description")
  sections.push(payload.description)

  if (payload.context) {
    sections.push("")
    sections.push("## Context")
    sections.push(payload.context)
  }

  if (payload.files && payload.files.length > 0) {
    sections.push("")
    sections.push("## Files")
    payload.files.forEach((file) => sections.push(`- ${file}`))
  }

  if (payload.goal_context) {
    sections.push("")
    sections.push("## Goal Context")
    sections.push(payload.goal_context)
  }

  if (payload.agent_instructions) {
    sections.push("")
    sections.push("## Agent Instructions")
    sections.push(payload.agent_instructions)
  }

  if (payload.priority) {
    sections.push("")
    sections.push(`Priority: ${payload.priority}`)
  }

  if (payload.metadata && Object.keys(payload.metadata).length > 0) {
    sections.push("")
    sections.push("## Metadata")
    sections.push("```json")
    sections.push(JSON.stringify(payload.metadata, null, 2))
    sections.push("```")
  }

  return sections.join("\n")
}

/**
 * Generate an execution payload string in the specified format
 */
export function generateExecutionPayload(
  payload: ExecutionPayload,
  format: ExecutionFormat,
): string {
  switch (format) {
    case "yaml":
      return toYaml(payload)
    case "json":
      return toJson(payload)
    case "toom":
      return toToom(payload)
    case "ralphy":
      return toRalphy(payload)
    default:
      return toJson(payload)
  }
}
