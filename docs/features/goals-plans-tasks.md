# Goals / Plans / Tasks Flow

This is the product loop backbone.

## Plan Mode

1. User describes an objective in plan mode.
2. Model explores context and proposes structured plan output.
3. Router parses goal/task blocks (and checklist fallback).
4. Goal/tasks are created and surfaced in UI.

## Execute Mode

1. User starts a goal or task from board.
2. State engine injects goal/task context into prompt.
3. Adapter streams execution with tool events.
4. Completion parser extracts summary/insights and updates task status.

## Files

- `src/main/lib/prompts/plan-mode.ts`
- `src/main/lib/prompts/execute-mode.ts`
- `src/main/lib/cli/plan-agent.ts`
- `src/main/lib/state-engine/context.ts`
- `src/main/lib/state-engine/completion.ts`
- `src/main/lib/trpc/routers/claude.ts`

