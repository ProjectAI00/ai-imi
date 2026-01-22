/**
 * Integration Tools
 *
 * External integration tools (Composio, GitHub, Custom).
 * Based on AVAILABLE_TOOLS from src/main/lib/agents/types.ts
 * All integration tools are read-only in plan mode by default.
 */

import type { ToolDefinition } from "../types"

export const INTEGRATION_TOOLS: ToolDefinition[] = [
  // ============================================
  // COMPOSIO INTEGRATIONS
  // ============================================
  {
    id: "gmail",
    name: "Gmail",
    description: "Send and read emails via Gmail",
    category: "integration",
    mode: "agent",
    icon: "mail",
    slug: "GMAIL",
    provider: "composio",
    readonlyInPlan: true,
    operations: [
      {
        name: "send",
        description: "Send an email",
        parameters: {
          to: { type: "string", description: "Recipient email address", required: true },
          subject: { type: "string", description: "Email subject", required: true },
          body: { type: "string", description: "Email body content", required: true },
        },
      },
      {
        name: "read",
        description: "Read emails from inbox",
        parameters: {
          count: { type: "number", description: "Number of emails to fetch", default: 10 },
          unread: { type: "boolean", description: "Only fetch unread emails", default: false },
        },
      },
    ],
  },
  {
    id: "slack",
    name: "Slack",
    description: "Post messages to Slack channels",
    category: "integration",
    mode: "agent",
    icon: "message-square",
    slug: "SLACK",
    provider: "composio",
    readonlyInPlan: true,
    operations: [
      {
        name: "postMessage",
        description: "Post a message to a channel",
        parameters: {
          channel: { type: "string", description: "Channel name or ID", required: true },
          message: { type: "string", description: "Message content", required: true },
        },
      },
      {
        name: "readChannel",
        description: "Read messages from a channel",
        parameters: {
          channel: { type: "string", description: "Channel name or ID", required: true },
          count: { type: "number", description: "Number of messages", default: 20 },
        },
      },
    ],
  },
  {
    id: "notion",
    name: "Notion",
    description: "Create and edit Notion pages and databases",
    category: "integration",
    mode: "agent",
    icon: "file-text",
    slug: "NOTION",
    provider: "composio",
    readonlyInPlan: true,
    operations: [
      {
        name: "createPage",
        description: "Create a new Notion page",
        parameters: {
          title: { type: "string", description: "Page title", required: true },
          content: { type: "string", description: "Page content in markdown" },
          parentId: { type: "string", description: "Parent page or database ID" },
        },
      },
      {
        name: "updatePage",
        description: "Update an existing page",
        parameters: {
          pageId: { type: "string", description: "Page ID to update", required: true },
          content: { type: "string", description: "New content" },
        },
      },
      {
        name: "queryDatabase",
        description: "Query a Notion database",
        parameters: {
          databaseId: { type: "string", description: "Database ID", required: true },
          filter: { type: "object", description: "Filter criteria" },
        },
      },
    ],
  },
  {
    id: "linear",
    name: "Linear",
    description: "Manage Linear issues and projects",
    category: "integration",
    mode: "agent",
    icon: "layout",
    slug: "LINEAR",
    provider: "composio",
    readonlyInPlan: true,
    operations: [
      {
        name: "createIssue",
        description: "Create a new issue",
        parameters: {
          title: { type: "string", description: "Issue title", required: true },
          description: { type: "string", description: "Issue description" },
          teamId: { type: "string", description: "Team ID", required: true },
          priority: { type: "number", description: "Priority (1-4)" },
        },
      },
      {
        name: "updateIssue",
        description: "Update an existing issue",
        parameters: {
          issueId: { type: "string", description: "Issue ID", required: true },
          status: { type: "string", description: "New status" },
        },
      },
      {
        name: "listIssues",
        description: "List issues with filters",
        parameters: {
          teamId: { type: "string", description: "Team ID" },
          status: { type: "string", description: "Filter by status" },
        },
      },
    ],
  },
  {
    id: "calendar",
    name: "Google Calendar",
    description: "Manage calendar events and schedules",
    category: "integration",
    mode: "agent",
    icon: "calendar",
    slug: "GOOGLECALENDAR",
    provider: "composio",
    readonlyInPlan: true,
    operations: [
      {
        name: "createEvent",
        description: "Create a calendar event",
        parameters: {
          title: { type: "string", description: "Event title", required: true },
          start: { type: "string", description: "Start time (ISO 8601)", required: true },
          end: { type: "string", description: "End time (ISO 8601)", required: true },
          attendees: { type: "array", description: "List of attendee emails" },
        },
      },
      {
        name: "listEvents",
        description: "List upcoming events",
        parameters: {
          maxResults: { type: "number", description: "Max events to return", default: 10 },
          timeMin: { type: "string", description: "Start of time range" },
        },
      },
    ],
  },
  {
    id: "drive",
    name: "Google Drive",
    description: "Access and manage Google Drive files",
    category: "integration",
    mode: "agent",
    icon: "folder",
    slug: "GOOGLEDRIVE",
    provider: "composio",
    readonlyInPlan: true,
    operations: [
      {
        name: "listFiles",
        description: "List files in Drive",
        parameters: {
          folderId: { type: "string", description: "Folder ID to list" },
          query: { type: "string", description: "Search query" },
        },
      },
      {
        name: "readFile",
        description: "Read file contents",
        parameters: {
          fileId: { type: "string", description: "File ID", required: true },
        },
      },
      {
        name: "createFile",
        description: "Create a new file",
        parameters: {
          name: { type: "string", description: "File name", required: true },
          content: { type: "string", description: "File content", required: true },
          folderId: { type: "string", description: "Parent folder ID" },
        },
      },
    ],
  },

  // ============================================
  // GITHUB INTEGRATIONS
  // ============================================
  {
    id: "github-pr",
    name: "GitHub PRs",
    description: "Create and manage pull requests",
    category: "integration",
    mode: "agent",
    icon: "git-pull-request",
    slug: "create_pr",
    provider: "github",
    readonlyInPlan: true,
    operations: [
      {
        name: "create",
        description: "Create a pull request",
        parameters: {
          title: { type: "string", description: "PR title", required: true },
          body: { type: "string", description: "PR description" },
          base: { type: "string", description: "Base branch", default: "main" },
          head: { type: "string", description: "Head branch", required: true },
        },
      },
      {
        name: "list",
        description: "List pull requests",
        parameters: {
          state: { type: "string", description: "PR state", enum: ["open", "closed", "all"] },
        },
      },
      {
        name: "merge",
        description: "Merge a pull request",
        parameters: {
          prNumber: { type: "number", description: "PR number", required: true },
          method: { type: "string", description: "Merge method", enum: ["merge", "squash", "rebase"] },
        },
      },
    ],
  },
  {
    id: "github-issue",
    name: "GitHub Issues",
    description: "Create and manage repository issues",
    category: "integration",
    mode: "agent",
    icon: "circle-dot",
    slug: "create_issue",
    provider: "github",
    readonlyInPlan: true,
    operations: [
      {
        name: "create",
        description: "Create an issue",
        parameters: {
          title: { type: "string", description: "Issue title", required: true },
          body: { type: "string", description: "Issue body" },
          labels: { type: "array", description: "Labels to add" },
          assignees: { type: "array", description: "Users to assign" },
        },
      },
      {
        name: "list",
        description: "List issues",
        parameters: {
          state: { type: "string", description: "Issue state", enum: ["open", "closed", "all"] },
          labels: { type: "array", description: "Filter by labels" },
        },
      },
      {
        name: "update",
        description: "Update an issue",
        parameters: {
          issueNumber: { type: "number", description: "Issue number", required: true },
          state: { type: "string", description: "New state" },
        },
      },
    ],
  },
  {
    id: "github-repo",
    name: "GitHub Repos",
    description: "Access repository information and files",
    category: "integration",
    mode: "all",
    icon: "folder-git",
    slug: "get_repo",
    provider: "github",
    readonlyInPlan: true,
    operations: [
      {
        name: "getInfo",
        description: "Get repository information",
        parameters: {
          owner: { type: "string", description: "Repository owner", required: true },
          repo: { type: "string", description: "Repository name", required: true },
        },
      },
      {
        name: "listBranches",
        description: "List repository branches",
        parameters: {
          owner: { type: "string", description: "Repository owner", required: true },
          repo: { type: "string", description: "Repository name", required: true },
        },
      },
      {
        name: "getContent",
        description: "Get file or directory content",
        parameters: {
          owner: { type: "string", description: "Repository owner", required: true },
          repo: { type: "string", description: "Repository name", required: true },
          path: { type: "string", description: "Path to file/directory", required: true },
        },
      },
    ],
  },

  // ============================================
  // CUSTOM TOOLS
  // ============================================
  {
    id: "custom-web-search",
    name: "Web Search (Custom)",
    description: "Search the web using custom search provider",
    category: "integration",
    mode: "all",
    icon: "search",
    provider: "custom",
    readonlyInPlan: true,
    operations: [
      {
        name: "search",
        description: "Perform a web search",
        parameters: {
          query: { type: "string", description: "Search query", required: true },
          maxResults: { type: "number", description: "Max results", default: 10 },
        },
      },
    ],
  },
  {
    id: "custom-file-ops",
    name: "File Operations (Custom)",
    description: "Extended file operations for custom workflows",
    category: "integration",
    mode: "agent",
    icon: "file",
    provider: "custom",
    readonlyInPlan: true,
    operations: [
      {
        name: "copy",
        description: "Copy a file or directory",
        parameters: {
          source: { type: "string", description: "Source path", required: true },
          destination: { type: "string", description: "Destination path", required: true },
        },
      },
      {
        name: "move",
        description: "Move a file or directory",
        parameters: {
          source: { type: "string", description: "Source path", required: true },
          destination: { type: "string", description: "Destination path", required: true },
        },
      },
      {
        name: "delete",
        description: "Delete a file or directory",
        parameters: {
          path: { type: "string", description: "Path to delete", required: true },
          recursive: { type: "boolean", description: "Delete recursively", default: false },
        },
      },
    ],
  },
]
