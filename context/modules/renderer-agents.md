# Module: renderer-agents

<!-- location: src/renderer/features/agents -->
<!-- last-verified: 2026-02-14 -->

## Purpose

Implements chat UI, input controls, tool rendering, and stream consumption.

## Key Files

- `src/renderer/features/agents/main/active-chat.tsx` - main chat surface
- `src/renderer/features/agents/main/new-chat-form.tsx` - chat creation flow
- `src/renderer/features/agents/lib/ipc-chat-transport.ts` - stream transport
- `src/renderer/features/agents/stores/sub-chat-store.ts` - sub-chat state

## Dependencies

- depends on `trpcClient`, Jotai atoms, Zustand store
- consumes chunk stream from main process

## Boundaries

- Owns presentation and interaction behavior
- Should not implement backend persistence logic

