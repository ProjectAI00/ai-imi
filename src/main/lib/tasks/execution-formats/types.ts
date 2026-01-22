/**
 * Execution Format Types
 *
 * Defines formats for serializing task payloads for CLI consumption.
 */

export type ExecutionFormat = "yaml" | "json" | "toom" | "ralphy"

export interface ExecutionPayload {
  task_id: string
  title: string
  description: string
  context?: string
  files?: string[]
  goal_context?: string
  agent_instructions?: string
  priority?: string
  metadata?: Record<string, unknown>
}
