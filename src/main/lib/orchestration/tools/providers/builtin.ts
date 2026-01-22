/**
 * Built-in Execution Tools
 *
 * Core execution tools available to all agents.
 * These are the 24 fundamental tools for code execution and system interaction.
 */

import type { ToolDefinition } from "../types"

export const BUILTIN_TOOLS: ToolDefinition[] = [
  // ============================================
  // FILESYSTEM TOOLS
  // ============================================
  {
    id: "read",
    name: "Read",
    description: "Read the contents of a file at the specified path",
    category: "execution",
    mode: "all",
    icon: "file-text",
  },
  {
    id: "write",
    name: "Write",
    description: "Write content to a file, creating it if it doesn't exist",
    category: "execution",
    mode: "agent",
    icon: "file-plus",
    readonlyInPlan: false,
  },
  {
    id: "edit",
    name: "Edit",
    description: "Make targeted edits to a file using search and replace",
    category: "execution",
    mode: "agent",
    icon: "file-edit",
    readonlyInPlan: false,
  },
  {
    id: "grep",
    name: "Grep",
    description: "Search for patterns in file contents using regex",
    category: "execution",
    mode: "all",
    icon: "search",
  },
  {
    id: "glob",
    name: "Glob",
    description: "Find files matching a glob pattern",
    category: "execution",
    mode: "all",
    icon: "folder-search",
  },

  // ============================================
  // SHELL TOOLS
  // ============================================
  {
    id: "bash",
    name: "Bash",
    description: "Execute shell commands in a bash environment",
    category: "execution",
    mode: "agent",
    icon: "terminal",
    readonlyInPlan: false,
  },
  {
    id: "bash-output",
    name: "BashOutput",
    description: "Read output from a running bash session",
    category: "execution",
    mode: "agent",
    icon: "terminal-square",
  },
  {
    id: "kill-shell",
    name: "KillShell",
    description: "Terminate a running shell process",
    category: "execution",
    mode: "agent",
    icon: "x-circle",
    readonlyInPlan: false,
  },

  // ============================================
  // WEB TOOLS
  // ============================================
  {
    id: "web-fetch",
    name: "WebFetch",
    description: "Fetch content from a URL and return it as text or markdown",
    category: "execution",
    mode: "all",
    icon: "globe",
  },
  {
    id: "web-search",
    name: "WebSearch",
    description: "Search the web and return relevant results",
    category: "execution",
    mode: "all",
    icon: "search-code",
  },

  // ============================================
  // PLANNING TOOLS
  // ============================================
  {
    id: "todo-write",
    name: "TodoWrite",
    description: "Create or update a todo list for task tracking",
    category: "execution",
    mode: "all",
    icon: "list-checks",
  },
  {
    id: "plan-write",
    name: "PlanWrite",
    description: "Create or update an execution plan",
    category: "execution",
    mode: "all",
    icon: "clipboard-list",
  },
  {
    id: "task",
    name: "Task",
    description: "Create a subtask for another agent to execute",
    category: "execution",
    mode: "agent",
    icon: "git-branch",
    readonlyInPlan: false,
  },
  {
    id: "exit-plan-mode",
    name: "ExitPlanMode",
    description: "Exit plan mode and switch to execution mode",
    category: "execution",
    mode: "plan",
    icon: "play",
  },

  // ============================================
  // MCP TOOLS
  // ============================================
  {
    id: "list-mcp-resources",
    name: "ListMcpResources",
    description: "List available MCP resources from connected servers",
    category: "execution",
    mode: "all",
    icon: "list",
  },
  {
    id: "read-mcp-resource",
    name: "ReadMcpResource",
    description: "Read a specific MCP resource by URI",
    category: "execution",
    mode: "all",
    icon: "file-input",
  },
  {
    id: "call-mcp-tool",
    name: "CallMcpTool",
    description: "Invoke an MCP tool from a connected server",
    category: "execution",
    mode: "agent",
    icon: "wrench",
    readonlyInPlan: false,
  },
  {
    id: "list-mcp-servers",
    name: "ListMcpServers",
    description: "List all connected MCP servers",
    category: "execution",
    mode: "all",
    icon: "server",
  },
  {
    id: "connect-mcp-server",
    name: "ConnectMcpServer",
    description: "Connect to a new MCP server",
    category: "execution",
    mode: "agent",
    icon: "plug",
    readonlyInPlan: false,
  },
  {
    id: "disconnect-mcp-server",
    name: "DisconnectMcpServer",
    description: "Disconnect from an MCP server",
    category: "execution",
    mode: "agent",
    icon: "unplug",
    readonlyInPlan: false,
  },

  // ============================================
  // MEMORY TOOLS
  // ============================================
  {
    id: "memory-read",
    name: "MemoryRead",
    description: "Read from agent memory/context store",
    category: "execution",
    mode: "all",
    icon: "brain",
  },
  {
    id: "memory-write",
    name: "MemoryWrite",
    description: "Write to agent memory/context store",
    category: "execution",
    mode: "agent",
    icon: "brain-circuit",
    readonlyInPlan: false,
  },

  // ============================================
  // UTILITY TOOLS
  // ============================================
  {
    id: "think",
    name: "Think",
    description: "Extended thinking/reasoning step without taking action",
    category: "execution",
    mode: "all",
    icon: "lightbulb",
  },
  {
    id: "ask-user",
    name: "AskUser",
    description: "Ask the user a question and wait for response",
    category: "execution",
    mode: "all",
    icon: "message-circle-question",
  },
]
