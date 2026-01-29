/**
 * CLI Tools
 *
 * Custom tools that can be registered with CLI adapters.
 * These tools give AI agents access to IMI-specific functionality.
 */

export { PLAN_MODE_TOOLS, imiCreateGoalTool, imiCreateTaskTool, askUserTool, setAskUserEmitter, resolveAskUserResponse } from "./plan-mode"
export type { CreateGoalInput, CreateTaskInput, AskUserInput } from "./plan-mode"
