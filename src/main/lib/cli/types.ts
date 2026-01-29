import type { Observable } from "@trpc/server/observable"

// Re-export UIMessageChunk from claude/types for consistency
export type { UIMessageChunk } from "../claude/types"
import type { UIMessageChunk } from "../claude/types"

/**
 * Configuration for a CLI adapter
 */
export interface CliConfig {
  cli: "claude-code" | "opencode" | "cursor" | "amp" | "droid" | "copilot"
  cwd: string
  model?: string
  sessionId?: string
  mode?: "plan" | "agent"
}

/**
 * Chat input for CLI execution
 */
export interface ChatInput {
  subChatId: string
  chatId: string
  prompt: string
  cwd: string
  cli: "claude-code" | "opencode" | "cursor" | "amp" | "droid" | "copilot"
  mode?: "plan" | "agent"
  sessionId?: string
  model?: string
  images?: Array<{
    base64Data: string
    mediaType: string
    filename?: string
  }>
  files?: Array<{
    path: string
    filename?: string
    size?: number
    mediaType?: string
  }>
  /** Context from previous messages (for non-Claude CLIs) */
  contextHistory?: string
  /** Root system prompt for consistent behavior across all CLIs */
  rootSystemPrompt?: string
  /** API keys for third-party services */
  ampApiKey?: string
}

/**
 * CLI Adapter interface - all CLI implementations must implement this
 */
export interface CliAdapter {
  /**
   * Unique identifier for this CLI
   */
  readonly id: string

  /**
   * Display name
   */
  readonly name: string

  /**
   * Check if this CLI is available/installed
   */
  isAvailable(): Promise<boolean>

  /**
   * Execute a chat request and stream responses
   */
  chat(input: ChatInput): Observable<UIMessageChunk, unknown>

  /**
   * Cancel an ongoing chat
   */
  cancel(subChatId: string): void
}

/**
 * Registry of available CLI adapters
 */
export type CliAdapterRegistry = Map<string, CliAdapter>
