"use client"

import { memo } from "react"
import { TextShimmer } from "../../../components/ui/text-shimmer"
import { QuestionIcon } from "../../../components/ui/icons"
import { QUESTIONS_SKIPPED_MESSAGE, QUESTIONS_TIMED_OUT_MESSAGE } from "../atoms"

interface AgentAskUserQuestionToolProps {
  input: {
    questions?: Array<{
      question: string
      header: string
      options: Array<{ label: string; description: string }>
      multiSelect: boolean
    }>
  }
  result?:
    | {
        questions?: unknown
        answers?: Record<string, string>
      }
    | string
  errorText?: string
  state: "call" | "result"
  isError?: boolean
}

export const AgentAskUserQuestionTool = memo(function AgentAskUserQuestionTool({
  input,
  result,
  errorText,
  state,
  isError,
}: AgentAskUserQuestionToolProps) {
  const questions = input?.questions ?? []
  const questionCount = questions.length

  // For errors, SDK stores errorText separately - use it to detect skip/timeout
  const effectiveErrorText =
    errorText || (typeof result === "string" ? result : undefined)

  // Extract answers for display
  const answers =
    result && typeof result === "object" && "answers" in result
      ? result.answers
      : null

  // Determine status
  const isSkipped = effectiveErrorText === QUESTIONS_SKIPPED_MESSAGE
  const isTimedOut = effectiveErrorText === QUESTIONS_TIMED_OUT_MESSAGE
  const isCompleted =
    state === "result" && answers && !isSkipped && !isTimedOut && !isError

  // Show loading state if no questions yet
  if (questionCount === 0 && state === "call") {
    return (
      <div className="flex items-center gap-2 py-1 px-2 text-xs text-muted-foreground">
        <TextShimmer className="text-xs" duration={1.5}>
          Generating questions...
        </TextShimmer>
      </div>
    )
  }

  // Show skipped/timed out state
  if (state === "result" && (isSkipped || isTimedOut)) {
    const firstQuestion = questions[0]?.header || questions[0]?.question
    return (
      <div className="flex items-center gap-2 py-1 px-2 text-xs text-muted-foreground">
        <span>{firstQuestion || "Question"}</span>
        <span className="text-muted-foreground/50">•</span>
        <span>{isTimedOut ? "Timed out" : "Skipped"}</span>
      </div>
    )
  }

  // Show error state
  if (state === "result" && isError) {
    return (
      <div className="flex items-center gap-2 py-1 px-2 text-xs text-muted-foreground">
        <span>Question</span>
        <span className="text-muted-foreground/50">•</span>
        <span className="text-red-500">{effectiveErrorText || "Error"}</span>
      </div>
    )
  }

  // Show completed state with card layout
  if (isCompleted && answers) {
    const entries = Object.entries(answers)
    if (entries.length === 0) {
      return (
        <div className="flex items-center gap-2 py-1 px-2 text-xs text-muted-foreground">
          <span>Question answered</span>
        </div>
      )
    }

    return (
      <div className="rounded-lg border border-border bg-muted/30 overflow-hidden mx-2">
        {/* Header */}
        <div className="flex items-center gap-1.5 pl-2.5 pr-2 h-7 border-b border-border">
          <QuestionIcon className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Answers</span>
        </div>
        {/* Content */}
        <div className="flex flex-col gap-2 p-2.5 text-xs">
          {entries.map(([question, answer], idx) => (
            <div key={idx} className="flex flex-col gap-0.5">
              <span className="font-medium text-foreground">{question}</span>
              <span className="text-muted-foreground">{answer}</span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // Show pending state
  const firstQuestion = questions[0]?.header || questions[0]?.question
  return (
    <div className="flex items-center gap-2 py-1 px-2 text-xs text-muted-foreground">
      <span>{firstQuestion || "Question"}</span>
      <span className="text-muted-foreground/50">•</span>
      <span>Waiting for response...</span>
    </div>
  )
})
