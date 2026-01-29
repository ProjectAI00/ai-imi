// AI SDK UIMessageChunk format
export type UIMessageChunk =
  // Message lifecycle
  | { type: "start"; messageId?: string }
  | { type: "finish"; messageMetadata?: MessageMetadata }
  | { type: "start-step" }
  | { type: "finish-step" }
  // Session management
  | { type: "session-id"; sessionId: string }
  // Text streaming
  | { type: "text-start"; id: string }
  | { type: "text-delta"; id: string; delta: string }
  | { type: "text-end"; id: string }
  // Reasoning (Extended Thinking)
  | { type: "reasoning"; id: string; text: string }
  | { type: "reasoning-delta"; id: string; delta: string }
  // Tool calls
  | { type: "tool-input-start"; toolCallId: string; toolName: string }
  | { type: "tool-input-delta"; toolCallId: string; inputTextDelta: string }
  | {
      type: "tool-input-available"
      toolCallId: string
      toolName: string
      input: unknown
    }
  | { type: "tool-output-available"; toolCallId: string; output: unknown }
  | { type: "tool-output-error"; toolCallId: string; errorText: string }
  // Error & metadata
  | { type: "error"; errorText: string }
  | { type: "auth-error"; errorText: string; cli?: "claude-code" | "opencode" | "cursor" | "amp" | "droid" | "copilot" }
  | {
      type: "ask-user-question"
      toolUseId: string
      questions: Array<{
        question: string
        header: string
        options: Array<{ label: string; description: string }>
        multiSelect: boolean
      }>
    }
  | { type: "ask-user-question-timeout"; toolUseId: string }
  | { type: "message-metadata"; messageMetadata: MessageMetadata }
  // System tools (rendered like regular tools)
  | {
      type: "system-Compact"
      toolCallId: string
      state: "input-streaming" | "output-available"
    }
  // Task creation (Plan Mode)
  | {
      type: "tasks-created"
      tasks: Array<{ id: string; title: string }>
    }
  // Goal creation (Plan Mode - from plan builder blocks)
  | {
      type: "goal-created"
      goalId: string
      goalName: string
      taskCount: number
    }

export type MessageMetadata = {
  sessionId?: string
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  totalCostUsd?: number
  durationMs?: number
  resultSubtype?: string
  finalTextId?: string
}
