/**
 * Tool Registry Types
 *
 * Type definitions for the tool registry and skill provider system.
 */

// Tool categories
export type ToolCategory = "execution" | "integration"

// Tool mode - when the tool can be used
export type ToolMode = "plan" | "agent" | "all"

// Skill operation definition
export interface SkillOperation {
  name: string
  description: string
  parameters?: Record<string, ParameterDefinition>
  returns?: string
}

// Parameter definition for operations
export interface ParameterDefinition {
  type: "string" | "number" | "boolean" | "object" | "array"
  description: string
  required?: boolean
  default?: unknown
  enum?: string[]
}

// Skill interface - a capability provided by a provider
export interface Skill {
  id: string
  name: string
  description: string
  operations: SkillOperation[]
  category: ToolCategory
  mode: ToolMode
  provider: string
}

// Skill provider interface - something that provides skills
export interface SkillProvider {
  id: string
  name: string
  description: string
  version: string

  // Discovery
  discover(): Promise<Skill[]>
  isInstalled(): Promise<boolean>

  // Execution
  invoke(skill: Skill, operation: string, input: Record<string, unknown>): Promise<unknown>

  // Lifecycle
  initialize?(): Promise<void>
  shutdown?(): Promise<void>
}

// Tool definition for registry
export interface ToolDefinition {
  id: string
  name: string
  description: string
  category: ToolCategory
  mode: ToolMode
  icon?: string
  readonlyInPlan?: boolean // If true, tool is read-only in plan mode
  provider?: string
  slug?: string // For integration tools
  operations?: SkillOperation[]
}

// Tool invocation request
export interface ToolInvocation {
  toolId: string
  operation?: string
  parameters: Record<string, unknown>
  context?: {
    workingDirectory?: string
    timeout?: number
  }
}

// Tool invocation result
export interface ToolResult {
  success: boolean
  data?: unknown
  error?: string
  duration: number
}
