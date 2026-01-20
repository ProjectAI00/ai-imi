/**
 * Context management for CLI adapters
 *
 * Builds conversation context from message history for CLIs
 * that don't have native session management (OpenCode, Cursor)
 */

export interface Message {
  id: string
  role: "user" | "assistant"
  parts: Array<{
    type: "text" | "tool_use" | "tool_result"
    text?: string
    toolName?: string
    toolInput?: Record<string, unknown>
    toolResult?: string
  }>
}

export interface ContextOptions {
  maxTokens?: number // Default: 8000
  maxMessages?: number // Default: 20 (sliding window)
  truncateToolOutput?: number // Default: 500 chars per tool output
  includeSystemContext?: boolean
}

const DEFAULT_OPTIONS: Required<ContextOptions> = {
  maxTokens: 8000,
  maxMessages: 20,
  truncateToolOutput: 500,
  includeSystemContext: true,
}

/**
 * Rough token estimation (4 chars ≈ 1 token)
 *
 * This is a simple heuristic that works reasonably well for English text.
 * For more accurate estimation, consider using a proper tokenizer.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/**
 * Truncate text with ellipsis indicator
 *
 * @param text - The text to truncate
 * @param maxLength - Maximum length including ellipsis
 * @returns Truncated text with "..." suffix if truncated
 */
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength - 3) + "..."
}

/**
 * Format a single message for context inclusion
 *
 * Handles different part types:
 * - text: Plain text content
 * - tool_use: Tool invocation with name and input
 * - tool_result: Tool execution result
 *
 * @param msg - The message to format
 * @param truncateToolOutput - Max length for tool inputs/outputs
 * @returns Formatted string representation of the message
 */
function formatMessage(msg: Message, truncateToolOutput: number): string {
  const role = msg.role === "user" ? "User" : "Assistant"
  const parts: string[] = []

  for (const part of msg.parts) {
    if (part.type === "text" && part.text) {
      parts.push(part.text)
    } else if (part.type === "tool_use" && part.toolName) {
      const input = JSON.stringify(part.toolInput || {}, null, 2)
      parts.push(`[Tool: ${part.toolName}]\n${truncate(input, truncateToolOutput)}`)
    } else if (part.type === "tool_result" && part.toolResult) {
      parts.push(`[Result]\n${truncate(part.toolResult, truncateToolOutput)}`)
    }
  }

  return `${role}:\n${parts.join("\n")}`
}

/**
 * Build context string from message history
 *
 * Uses a sliding window approach combined with token-based truncation
 * to fit conversation history within specified limits.
 *
 * Algorithm:
 * 1. Take the last N messages (sliding window)
 * 2. Process messages from most recent to oldest
 * 3. Add messages until token limit would be exceeded
 * 4. Return formatted context string
 *
 * @param messages - Array of messages from conversation history
 * @param options - Configuration options for context building
 * @returns Formatted context string ready for CLI prompt
 *
 * @example
 * ```typescript
 * const context = buildContext(messages, {
 *   maxTokens: 4000,
 *   maxMessages: 10,
 *   truncateToolOutput: 300
 * })
 * ```
 */
export function buildContext(messages: Message[], options: ContextOptions = {}): string {
  const opts = { ...DEFAULT_OPTIONS, ...options }

  // Take last N messages (sliding window)
  const recentMessages = messages.slice(-opts.maxMessages)

  // Format messages
  const formatted: string[] = []
  let totalTokens = 0

  // Process in reverse (most recent first) to prioritize recent context
  for (let i = recentMessages.length - 1; i >= 0; i--) {
    const msg = recentMessages[i]
    const text = formatMessage(msg, opts.truncateToolOutput)
    const tokens = estimateTokens(text)

    if (totalTokens + tokens > opts.maxTokens) {
      // Would exceed limit, stop adding older messages
      break
    }

    formatted.unshift(text) // Add to front to maintain chronological order
    totalTokens += tokens
  }

  // Build final context with optional header
  const header = opts.includeSystemContext ? "# Conversation History\n\n" : ""

  return header + formatted.join("\n\n---\n\n")
}

/**
 * Build context with summary for older messages
 *
 * This is an enhanced version that can prepend a summary of older
 * messages that were truncated from the sliding window.
 *
 * Currently uses the basic sliding window approach.
 * Future enhancement: Generate and prepend summaries of older context.
 *
 * @param messages - Array of messages from conversation history
 * @param _summary - Optional summary of older messages (not yet implemented)
 * @param options - Configuration options for context building
 * @returns Formatted context string with optional summary prefix
 */
export function buildContextWithSummary(
  messages: Message[],
  _summary: string | null,
  options: ContextOptions = {}
): string {
  // For MVP, just use sliding window
  // TODO: Prepend summary of older messages when summary is provided
  return buildContext(messages, options)
}

/**
 * Get statistics about the built context
 *
 * Useful for debugging and monitoring context usage.
 *
 * @param messages - Array of messages from conversation history
 * @param options - Configuration options for context building
 * @returns Object with context statistics
 */
export function getContextStats(
  messages: Message[],
  options: ContextOptions = {}
): {
  totalMessages: number
  includedMessages: number
  estimatedTokens: number
  truncated: boolean
} {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  const context = buildContext(messages, options)

  const recentMessages = messages.slice(-opts.maxMessages)
  const contextLines = context.split("\n\n---\n\n")
  const includedMessages = opts.includeSystemContext
    ? contextLines.length - 1 // Subtract header
    : contextLines.length

  return {
    totalMessages: messages.length,
    includedMessages: Math.min(includedMessages, recentMessages.length),
    estimatedTokens: estimateTokens(context),
    truncated: messages.length > includedMessages,
  }
}
