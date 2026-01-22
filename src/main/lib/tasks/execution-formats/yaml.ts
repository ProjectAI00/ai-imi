/**
 * YAML Execution Format
 *
 * Serializes execution payloads to YAML format.
 */

import type { ExecutionPayload } from "./types"

/**
 * Escape special YAML characters in a string value
 */
function escapeYamlString(value: string): string {
  if (
    value.includes(":") ||
    value.includes("#") ||
    value.includes("\n") ||
    value.includes('"') ||
    value.includes("'") ||
    value.startsWith(" ") ||
    value.endsWith(" ")
  ) {
    // Use double quotes and escape internal quotes
    return `"${value.replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`
  }
  return value
}

/**
 * Convert an array to YAML list format
 */
function arrayToYaml(arr: string[], indent: string): string {
  if (arr.length === 0) return "[]"
  return arr.map((item) => `${indent}- ${escapeYamlString(item)}`).join("\n")
}

/**
 * Convert a record to YAML map format
 */
function recordToYaml(
  obj: Record<string, unknown>,
  indent: string,
): string {
  const entries = Object.entries(obj)
  if (entries.length === 0) return "{}"
  return entries
    .map(([key, value]) => {
      if (typeof value === "string") {
        return `${indent}${key}: ${escapeYamlString(value)}`
      }
      if (typeof value === "number" || typeof value === "boolean") {
        return `${indent}${key}: ${value}`
      }
      if (Array.isArray(value)) {
        return `${indent}${key}:\n${arrayToYaml(value as string[], indent + "  ")}`
      }
      if (value && typeof value === "object") {
        return `${indent}${key}:\n${recordToYaml(value as Record<string, unknown>, indent + "  ")}`
      }
      return `${indent}${key}: null`
    })
    .join("\n")
}

/**
 * Serialize an ExecutionPayload to YAML format
 */
export function toYaml(payload: ExecutionPayload): string {
  const lines: string[] = []

  lines.push(`task_id: ${escapeYamlString(payload.task_id)}`)
  lines.push(`title: ${escapeYamlString(payload.title)}`)
  lines.push(`description: ${escapeYamlString(payload.description)}`)

  if (payload.context) {
    lines.push(`context: ${escapeYamlString(payload.context)}`)
  }

  if (payload.files && payload.files.length > 0) {
    lines.push("files:")
    lines.push(arrayToYaml(payload.files, "  "))
  }

  if (payload.goal_context) {
    lines.push(`goal_context: ${escapeYamlString(payload.goal_context)}`)
  }

  if (payload.agent_instructions) {
    lines.push(`agent_instructions: ${escapeYamlString(payload.agent_instructions)}`)
  }

  if (payload.priority) {
    lines.push(`priority: ${escapeYamlString(payload.priority)}`)
  }

  if (payload.metadata && Object.keys(payload.metadata).length > 0) {
    lines.push("metadata:")
    lines.push(recordToYaml(payload.metadata, "  "))
  }

  return lines.join("\n")
}
