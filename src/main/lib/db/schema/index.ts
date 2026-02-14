import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"
import { relations } from "drizzle-orm"
import { createId } from "../utils"

// ============ PROJECTS ============
export const projects = sqliteTable("projects", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  name: text("name").notNull(),
  path: text("path").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(
    () => new Date(),
  ),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(
    () => new Date(),
  ),
  // Git remote info (extracted from local .git)
  gitRemoteUrl: text("git_remote_url"),
  gitProvider: text("git_provider"), // "github" | "gitlab" | "bitbucket" | null
  gitOwner: text("git_owner"),
  gitRepo: text("git_repo"),
})

export const projectsRelations = relations(projects, ({ many }) => ({
  chats: many(chats),
}))

// ============ CHATS ============
export const chats = sqliteTable("chats", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  name: text("name"),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(
    () => new Date(),
  ),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(
    () => new Date(),
  ),
  archivedAt: integer("archived_at", { mode: "timestamp" }),
  // Worktree fields (for git isolation per chat)
  worktreePath: text("worktree_path"),
  branch: text("branch"),
  baseBranch: text("base_branch"),
  // PR tracking fields
  prUrl: text("pr_url"),
  prNumber: integer("pr_number"),
})

export const chatsRelations = relations(chats, ({ one, many }) => ({
  project: one(projects, {
    fields: [chats.projectId],
    references: [projects.id],
  }),
  subChats: many(subChats),
}))

// ============ SUB-CHATS ============
export const subChats = sqliteTable("sub_chats", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  name: text("name"),
  chatId: text("chat_id")
    .notNull()
    .references(() => chats.id, { onDelete: "cascade" }),
  sessionId: text("session_id"), // Claude SDK session ID for resume
  streamId: text("stream_id"), // Track in-progress streams
  mode: text("mode").notNull().default("agent"), // "plan" | "agent" | "ask"
  cli: text("cli").notNull().default("claude-code"), // "claude-code" | "opencode" | "cursor" | "amp" | "droid" | "copilot"
  model: text("model"), // Model ID (e.g., "opus", "sonnet", "gpt-4")
  messages: text("messages").notNull().default("[]"), // JSON array
  // State engine: link to goal/task for context injection
  goalId: text("goal_id"), // Goal being executed (orchestrator mode)
  taskId: text("task_id"), // Task being executed (focused mode)
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(
    () => new Date(),
  ),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(
    () => new Date(),
  ),
})

export const subChatsRelations = relations(subChats, ({ one }) => ({
  chat: one(chats, {
    fields: [subChats.chatId],
    references: [chats.id],
  }),
}))

// ============ CLAUDE CODE CREDENTIALS ============
// Stores encrypted OAuth token for Claude Code integration
export const claudeCodeCredentials = sqliteTable("claude_code_credentials", {
  id: text("id").primaryKey().default("default"), // Single row, always "default"
  oauthToken: text("oauth_token").notNull(), // Encrypted with safeStorage
  connectedAt: integer("connected_at", { mode: "timestamp" }).$defaultFn(
    () => new Date(),
  ),
  userId: text("user_id"), // Desktop auth user ID (for reference)
})

// ============ AGENTS ============
// Reusable AI agent definitions (Agent Builder feature)
export const agents = sqliteTable("agents", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  name: text("name").notNull(),
  description: text("description").notNull(),
  // Personality
  tone: text("tone").notNull().default("professional"), // professional | casual | technical | friendly
  verbosity: text("verbosity").notNull().default("balanced"), // concise | balanced | detailed
  style: text("style"), // Additional style notes
  // Configuration
  tools: text("tools").notNull().default("[]"), // JSON array of enabled tools
  defaultCli: text("default_cli").default("claude-code"),
  defaultModel: text("default_model"),
  maxIterations: integer("max_iterations").default(10),
  // Generated
  systemPrompt: text("system_prompt").notNull(),
  specialInstructions: text("special_instructions"),
  // Meta
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(
    () => new Date(),
  ),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(
    () => new Date(),
  ),
})

export const agentsRelations = relations(agents, ({ many }) => ({
  tasks: many(tasks),
}))

// ============ WORKSPACES ============
// Organizational containers for goals and tasks
export const workspaces = sqliteTable("workspaces", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  name: text("name").notNull(),
  description: text("description"),
  color: text("color"),
  icon: text("icon"),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(
    () => new Date(),
  ),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(
    () => new Date(),
  ),
})

export const workspacesRelations = relations(workspaces, ({ many }) => ({
  goals: many(goals),
  tasks: many(tasks),
  insights: many(insights),
}))

// ============ GOALS ============
// High-level objectives that group related plans and tasks
export const goals = sqliteTable("goals", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  name: text("name").notNull(),
  description: text("description").notNull(),
  workspaceId: text("workspace_id").references(() => workspaces.id, { onDelete: "set null" }),
  status: text("status").notNull().default("todo"), // todo | ongoing | review | done
  priority: text("priority").notNull().default("medium"),
  context: text("context"),
  tags: text("tags").default("[]"), // JSON array
  // Execution context for AI agents
  workspacePath: text("workspace_path"), // Absolute path to the project folder
  relevantFiles: text("relevant_files").default("[]"), // JSON array of file paths
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(
    () => new Date(),
  ),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(
    () => new Date(),
  ),
  completedAt: integer("completed_at", { mode: "timestamp" }),
})

export const goalsRelations = relations(goals, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [goals.workspaceId],
    references: [workspaces.id],
  }),
  plans: many(plans),
}))

// ============ PLANS ============
// Execution plans that break down goals into steps
export const plans = sqliteTable("plans", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  name: text("name").notNull(),
  description: text("description").notNull(),
  goalId: text("goal_id").references(() => goals.id, { onDelete: "set null" }),
  steps: text("steps").notNull().default("[]"), // JSON PlanStep[]
  approvalStatus: text("approval_status").notNull().default("draft"), // draft | awaiting_approval | approved | rejected
  status: text("status").notNull().default("todo"),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(
    () => new Date(),
  ),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(
    () => new Date(),
  ),
})

export const plansRelations = relations(plans, ({ one, many }) => ({
  goal: one(goals, {
    fields: [plans.goalId],
    references: [goals.id],
  }),
  tasks: many(tasks),
}))

// ============ TASKS ============
// Work items created via Task Builder
export const tasks = sqliteTable("tasks", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  title: text("title").notNull(),
  description: text("description").notNull(),
  // Context
  context: text("context"),
  linkedFiles: text("linked_files").default("[]"), // JSON array
  projectId: text("project_id").references(() => projects.id, { onDelete: "set null" }),
  workspaceId: text("workspace_id").references(() => workspaces.id, { onDelete: "set null" }),
  // Assignment
  assigneeType: text("assignee_type").notNull().default("ai"), // ai | human (later)
  agentId: text("agent_id").references(() => agents.id, { onDelete: "set null" }),
  // Organization
  teamId: text("team_id"),
  tags: text("tags").default("[]"), // JSON array
  // Timing
  timeFrame: text("time_frame").notNull().default("this_week"), // today | tomorrow | this_week | next_week | no_rush
  dueDate: integer("due_date", { mode: "timestamp" }),
  priority: text("priority").notNull().default("medium"), // low | medium | high
  // Status
  status: text("status").notNull().default("todo"), // todo | in_progress | review | done
  // Execution
  chatId: text("chat_id").references(() => chats.id, { onDelete: "set null" }), // Linked chat thread
  summary: text("summary"), // AI summary when done
  // Goal & Plan links
  goalId: text("goal_id").references(() => goals.id, { onDelete: "set null" }),
  planId: text("plan_id").references(() => plans.id, { onDelete: "set null" }),
  // Execution format for CLI export
  executionFormat: text("execution_format").default("json"), // yaml | json | toom | ralphy
  executionPayload: text("execution_payload"), // Serialized payload for CLI
  // Execution context for AI agents
  workspacePath: text("workspace_path"), // Absolute path to work in
  relevantFiles: text("relevant_files").default("[]"), // JSON array of file paths
  tools: text("tools").default("[]"), // JSON array of tool names: ["bash", "edit", "grep"]
  acceptanceCriteria: text("acceptance_criteria"), // How we know the task is done
  // Meta
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(
    () => new Date(),
  ),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(
    () => new Date(),
  ),
  completedAt: integer("completed_at", { mode: "timestamp" }),
  createdBy: text("created_by").notNull().default("user"), // user | ai
})

export const tasksRelations = relations(tasks, ({ one }) => ({
  project: one(projects, {
    fields: [tasks.projectId],
    references: [projects.id],
  }),
  workspace: one(workspaces, {
    fields: [tasks.workspaceId],
    references: [workspaces.id],
  }),
  agent: one(agents, {
    fields: [tasks.agentId],
    references: [agents.id],
  }),
  chat: one(chats, {
    fields: [tasks.chatId],
    references: [chats.id],
  }),
  goal: one(goals, {
    fields: [tasks.goalId],
    references: [goals.id],
  }),
  plan: one(plans, {
    fields: [tasks.planId],
    references: [plans.id],
  }),
}))

// ============ MEMORIES ============
// Key-value insights learned during task execution
export const memories = sqliteTable(
  "memories",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    goalId: text("goal_id").references(() => goals.id, { onDelete: "set null" }),
    taskId: text("task_id").references(() => tasks.id, { onDelete: "set null" }),
    key: text("key").notNull(), // e.g., "auth_provider", "database", "stack"
    value: text("value").notNull(), // the actual insight
    source: text("source").notNull().default("agent"), // "agent" | "user"
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(
      () => new Date(),
    ),
  },
  (table) => [index("memories_goal_id_idx").on(table.goalId)],
)

export const memoriesRelations = relations(memories, ({ one }) => ({
  goal: one(goals, {
    fields: [memories.goalId],
    references: [goals.id],
  }),
  task: one(tasks, {
    fields: [memories.taskId],
    references: [tasks.id],
  }),
}))

// ============ INSIGHTS ============
// Knowledge artifacts stored as MD files, indexed in DB
export const insights = sqliteTable("insights", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  summary: text("summary"), // One-liner for lists
  filePath: text("file_path").notNull(), // Relative path to MD file
  sourceType: text("source_type").notNull().default("manual"), // conversation | goal | task | manual
  sourceId: text("source_id"), // Optional link to origin (chatId, goalId, taskId)
  tags: text("tags").default("[]"), // JSON array
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(
    () => new Date(),
  ),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(
    () => new Date(),
  ),
  createdBy: text("created_by").notNull().default("user"), // user | ai
})

export const insightsRelations = relations(insights, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [insights.workspaceId],
    references: [workspaces.id],
  }),
}))

// ============ TYPE EXPORTS ============
export type Project = typeof projects.$inferSelect
export type NewProject = typeof projects.$inferInsert
export type Chat = typeof chats.$inferSelect
export type NewChat = typeof chats.$inferInsert
export type SubChat = typeof subChats.$inferSelect
export type NewSubChat = typeof subChats.$inferInsert
export type ClaudeCodeCredential = typeof claudeCodeCredentials.$inferSelect
export type NewClaudeCodeCredential = typeof claudeCodeCredentials.$inferInsert
export type Agent = typeof agents.$inferSelect
export type NewAgent = typeof agents.$inferInsert
export type Task = typeof tasks.$inferSelect
export type NewTask = typeof tasks.$inferInsert
export type Goal = typeof goals.$inferSelect
export type NewGoal = typeof goals.$inferInsert
export type Plan = typeof plans.$inferSelect
export type NewPlan = typeof plans.$inferInsert
export type Memory = typeof memories.$inferSelect
export type NewMemory = typeof memories.$inferInsert
export type Workspace = typeof workspaces.$inferSelect
export type NewWorkspace = typeof workspaces.$inferInsert
export type Insight = typeof insights.$inferSelect
export type NewInsight = typeof insights.$inferInsert
