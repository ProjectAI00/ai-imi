/**
 * Agent Types
 *
 * TypeScript definitions for agent building and configuration.
 * Used by the Agent Builder feature to create custom AI co-workers.
 */

// Personality options
export const TONE_OPTIONS = [
  { value: "professional", label: "Professional", description: "Formal and business-like" },
  { value: "casual", label: "Casual", description: "Friendly and approachable" },
  { value: "technical", label: "Technical", description: "Precise and detailed" },
  { value: "friendly", label: "Friendly", description: "Warm and encouraging" },
] as const

export const VERBOSITY_OPTIONS = [
  { value: "concise", label: "Concise", description: "Brief and to the point" },
  { value: "balanced", label: "Balanced", description: "Moderate detail level" },
  { value: "detailed", label: "Detailed", description: "Thorough explanations" },
] as const

// CLI options
export const CLI_OPTIONS = [
  { value: "claude-code", label: "Claude Code", description: "Anthropic's CLI agent" },
  { value: "opencode", label: "OpenCode", description: "Open source CLI" },
  { value: "cursor", label: "Cursor", description: "Cursor AI CLI" },
  { value: "amp", label: "Amp", description: "Sourcegraph Amp CLI" },
  { value: "droid", label: "Droid", description: "Droid CLI" },
] as const

// Available tools
export const AVAILABLE_TOOLS = [
  // Composio tools
  { id: "gmail", name: "Gmail", type: "composio", slug: "GMAIL", icon: "mail", description: "Send and read emails" },
  { id: "slack", name: "Slack", type: "composio", slug: "SLACK", icon: "message-square", description: "Post messages to Slack" },
  { id: "notion", name: "Notion", type: "composio", slug: "NOTION", icon: "file-text", description: "Create and edit Notion pages" },
  { id: "linear", name: "Linear", type: "composio", slug: "LINEAR", icon: "layout", description: "Manage Linear issues" },
  { id: "calendar", name: "Google Calendar", type: "composio", slug: "GOOGLECALENDAR", icon: "calendar", description: "Manage calendar events" },
  { id: "drive", name: "Google Drive", type: "composio", slug: "GOOGLEDRIVE", icon: "folder", description: "Access Google Drive files" },

  // GitHub tools
  { id: "github-pr", name: "GitHub PRs", type: "github", slug: "create_pr", icon: "git-pull-request", description: "Create pull requests" },
  { id: "github-issue", name: "GitHub Issues", type: "github", slug: "create_issue", icon: "circle-dot", description: "Create and manage issues" },
  { id: "github-repo", name: "GitHub Repos", type: "github", slug: "get_repo", icon: "folder-git", description: "Access repository info" },

  // Custom tools
  { id: "web-search", name: "Web Search", type: "custom", icon: "search", description: "Search the web" },
  { id: "file-ops", name: "File Operations", type: "custom", icon: "file", description: "Read and write files" },
] as const

export type ToneValue = (typeof TONE_OPTIONS)[number]["value"]
export type VerbosityValue = (typeof VERBOSITY_OPTIONS)[number]["value"]
export type CliValue = (typeof CLI_OPTIONS)[number]["value"]
export type ToolId = (typeof AVAILABLE_TOOLS)[number]["id"]

// Agent skeleton - what gets filled during Q&A
export interface AgentSkeleton {
  // Step 1: Identity
  name: string
  description: string

  // Step 2: Personality
  personality: {
    tone: ToneValue
    verbosity: VerbosityValue
    style?: string
  }

  // Step 3: Tools
  tools: {
    id: string
    name: string
    type: string
    slug?: string
    config?: Record<string, unknown>
    enabled: boolean
  }[]

  // Step 4: Preferences
  preferences: {
    defaultModel?: string
    defaultCli?: CliValue
    maxIterations?: number
  }

  // Step 5: Generated
  systemPrompt: string
  specialInstructions?: string
}

// Builder wizard state
export interface AgentBuilderState {
  step: number
  skeleton: Partial<AgentSkeleton>
  isGenerating: boolean
  generatedPrompt?: string
}

// Builder step config
export interface AgentBuilderStep {
  id: number
  title: string
  description: string
  question: string
  isComplete: (skeleton: Partial<AgentSkeleton>) => boolean
}

export const AGENT_BUILDER_STEPS: AgentBuilderStep[] = [
  {
    id: 1,
    title: "Identity",
    description: "Name and describe your agent",
    question: "What should this agent do? Give it a name and describe its purpose.",
    isComplete: (s) => Boolean(s.name && s.description),
  },
  {
    id: 2,
    title: "Personality",
    description: "Set communication style",
    question: "How should it communicate? Professional, casual, or technical? Concise or detailed?",
    isComplete: (s) => Boolean(s.personality?.tone && s.personality?.verbosity),
  },
  {
    id: 3,
    title: "Tools",
    description: "Select available tools",
    question: "What tools does it need? Gmail, Slack, GitHub, etc.",
    isComplete: () => true, // Tools are optional
  },
  {
    id: 4,
    title: "Preferences",
    description: "Configure execution",
    question: "Any specific preferences? Which CLI should it use by default?",
    isComplete: () => true, // Preferences are optional
  },
  {
    id: 5,
    title: "Review",
    description: "Generate and confirm",
    question: "Review the generated system prompt. Make any edits needed.",
    isComplete: (s) => Boolean(s.systemPrompt),
  },
]
