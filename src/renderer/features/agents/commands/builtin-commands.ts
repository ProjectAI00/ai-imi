import type { BuiltinCommandAction, SlashCommandOption } from "./types"

/**
 * Prompt texts for prompt-based slash commands
 */
export const COMMAND_PROMPTS: Partial<
  Record<BuiltinCommandAction["type"], string>
> = {
  goals: "Show me my current goals and their status.",
  tasks: "Show me the tasks for the current goal.",
}

/**
 * Check if a command is a prompt-based command
 */
export function isPromptCommand(
  type: BuiltinCommandAction["type"],
): type is "goals" | "tasks" {
  return type in COMMAND_PROMPTS
}

/**
 * Built-in slash commands that are handled client-side
 */
export const BUILTIN_SLASH_COMMANDS: SlashCommandOption[] = [
  {
    id: "builtin:clear",
    name: "clear",
    command: "/clear",
    description: "Start a new conversation (creates new sub-chat)",
    category: "builtin",
  },
  {
    id: "builtin:plan",
    name: "plan",
    command: "/plan",
    description: "Switch to Plan mode (create goals and tasks)",
    category: "builtin",
  },
  {
    id: "builtin:agent",
    name: "agent",
    command: "/agent",
    description: "Switch to Agent mode (execute work)",
    category: "builtin",
  },
  {
    id: "builtin:ask",
    name: "ask",
    command: "/ask",
    description: "Switch to Ask mode (conversation about anything)",
    category: "builtin",
  },
  // Goal/task commands
  {
    id: "builtin:goal",
    name: "goal",
    command: "/goal",
    description: "Work on a goal (loads context from task board)",
    category: "builtin",
    requiresPicker: "goal",
  },
  {
    id: "builtin:task",
    name: "task",
    command: "/task",
    description: "Work on a specific task (loads context from task board)",
    category: "builtin",
    requiresPicker: "task",
  },
  {
    id: "builtin:goals",
    name: "goals",
    command: "/goals",
    description: "List all goals and their status",
    category: "builtin",
  },
  {
    id: "builtin:tasks",
    name: "tasks",
    command: "/tasks",
    description: "List tasks for the current goal",
    category: "builtin",
  },
]

/**
 * Filter builtin commands by search text
 */
export function filterBuiltinCommands(
  searchText: string,
): SlashCommandOption[] {
  if (!searchText) return BUILTIN_SLASH_COMMANDS

  const query = searchText.toLowerCase()
  return BUILTIN_SLASH_COMMANDS.filter(
    (cmd) =>
      cmd.name.toLowerCase().includes(query) ||
      cmd.description.toLowerCase().includes(query),
  )
}
