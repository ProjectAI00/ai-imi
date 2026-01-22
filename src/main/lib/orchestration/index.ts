/**
 * Orchestration Module
 *
 * Provides base types, status management, and tool registry for orchestration.
 */

// Types
export type {
  Status,
  Priority,
  ExecutionMode,
  BaseMetadata,
  BaseSkeleton,
  TaskSkeleton,
  ProjectSkeleton,
  MilestoneSkeleton,
  ExecutionContext,
  ExecutionResult,
  ProgressInfo,
} from "./types"

// Status utilities
export {
  isValidTransition,
  getNextStatuses,
  isTerminalStatus,
  isActiveStatus,
  getStatusInfo,
  isValidStatus,
  transitionStatus,
  getAllStatuses,
  getStatusProgress,
} from "./status"

// Tool registry
export type {
  SkillProvider,
  Skill,
  SkillOperation,
  ToolCategory,
  ToolMode,
  ToolDefinition,
} from "./tools"

export {
  TOOL_REGISTRY,
  getToolsForMode,
  registerProvider,
  getAllProviders,
  getToolById,
  getToolsByCategory,
} from "./tools"
