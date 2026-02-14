# System Architecture (Context)

<!-- last-verified: 2026-02-14 -->

## Processes

- `src/main` - backend/runtime orchestration
- `src/preload` - secure bridge
- `src/renderer` - React UI

## Critical Runtime Path

`renderer input -> IPCChatTransport -> trpc.claude.chat -> adapter -> stream chunks -> DB writeback -> UI state update`

## Core Runtime Files

- `src/main/lib/trpc/routers/claude.ts`
- `src/renderer/features/agents/lib/ipc-chat-transport.ts`
- `src/main/lib/cli/adapters/*.ts`
- `src/main/lib/state-engine/*.ts`
- `src/main/lib/db/schema/index.ts`

