/**
 * Tool Registry
 *
 * Central registry for all available tools.
 * Manages tool discovery, registration, and retrieval.
 */

import type { ToolDefinition, ToolMode, ToolCategory, SkillProvider } from "./types"
import { BUILTIN_TOOLS } from "./providers/builtin"
import { INTEGRATION_TOOLS } from "./providers/integrations"

// Combined tool registry
export const TOOL_REGISTRY: ToolDefinition[] = [...BUILTIN_TOOLS, ...INTEGRATION_TOOLS]

// Registered providers
const providers: Map<string, SkillProvider> = new Map()

/**
 * Get tools available for a specific mode
 */
export function getToolsForMode(mode: ToolMode, agentTools?: string[]): ToolDefinition[] {
  return TOOL_REGISTRY.filter((tool) => {
    // Check mode compatibility
    const modeMatch = tool.mode === "all" || tool.mode === mode

    // In plan mode, check readonlyInPlan flag
    if (mode === "plan" && tool.readonlyInPlan === false) {
      return false
    }

    // If agentTools specified, filter by those
    if (agentTools && agentTools.length > 0) {
      return modeMatch && agentTools.includes(tool.id)
    }

    return modeMatch
  })
}

/**
 * Register a skill provider
 */
export function registerProvider(provider: SkillProvider): void {
  providers.set(provider.id, provider)
}

/**
 * Unregister a skill provider
 */
export function unregisterProvider(providerId: string): boolean {
  return providers.delete(providerId)
}

/**
 * Get all registered providers
 */
export function getAllProviders(): SkillProvider[] {
  return Array.from(providers.values())
}

/**
 * Get a specific provider by ID
 */
export function getProvider(providerId: string): SkillProvider | undefined {
  return providers.get(providerId)
}

/**
 * Get a tool by its ID
 */
export function getToolById(toolId: string): ToolDefinition | undefined {
  return TOOL_REGISTRY.find((tool) => tool.id === toolId)
}

/**
 * Get tools by category
 */
export function getToolsByCategory(category: ToolCategory): ToolDefinition[] {
  return TOOL_REGISTRY.filter((tool) => tool.category === category)
}

/**
 * Get all execution tools
 */
export function getExecutionTools(): ToolDefinition[] {
  return getToolsByCategory("execution")
}

/**
 * Get all integration tools
 */
export function getIntegrationTools(): ToolDefinition[] {
  return getToolsByCategory("integration")
}

/**
 * Check if a tool exists
 */
export function hasTool(toolId: string): boolean {
  return TOOL_REGISTRY.some((tool) => tool.id === toolId)
}

/**
 * Get tools count by category
 */
export function getToolCounts(): Record<ToolCategory, number> {
  return {
    execution: getExecutionTools().length,
    integration: getIntegrationTools().length,
  }
}
