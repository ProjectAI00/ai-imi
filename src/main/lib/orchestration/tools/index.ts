/**
 * Tools Module
 *
 * Exports tool types, registry, and providers.
 */

// Types
export type {
  ToolCategory,
  ToolMode,
  SkillOperation,
  ParameterDefinition,
  Skill,
  SkillProvider,
  ToolDefinition,
  ToolInvocation,
  ToolResult,
} from "./types"

// Registry
export {
  TOOL_REGISTRY,
  getToolsForMode,
  registerProvider,
  unregisterProvider,
  getAllProviders,
  getProvider,
  getToolById,
  getToolsByCategory,
  getExecutionTools,
  getIntegrationTools,
  hasTool,
  getToolCounts,
} from "./registry"

// Providers
export { BUILTIN_TOOLS } from "./providers/builtin"
export { INTEGRATION_TOOLS } from "./providers/integrations"
export { CliSkillProvider, cliSkillProvider } from "./providers/cli-adapter"
