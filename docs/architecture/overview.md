# Architecture Overview

1Code is a local-first Electron app with three process layers:

1. **Main process** (`src/main`) for orchestration, database, CLI adapters, and tRPC routers.
2. **Preload process** (`src/preload`) for secure bridge APIs.
3. **Renderer process** (`src/renderer`) for React UI and user interactions.

## High-Level Runtime Flow

1. User sends message in renderer chat UI.
2. Renderer transport subscribes to `trpc.claude.chat`.
3. Main router resolves mode (`plan`/`agent`/`ask`) and CLI adapter.
4. Prompt is enriched with mode instructions and goal/task context.
5. Adapter streams tool and text chunks.
6. Stream chunks update UI and persist to `sub_chats.messages`.
7. Plan mode may create goals/tasks; execute mode may complete tasks and write memories.

## Key Backend Paths

- `src/main/lib/trpc/routers/claude.ts` - central runtime chat orchestration
- `src/main/lib/cli/adapters/*` - per-CLI execution adapters
- `src/main/lib/state-engine/*` - context building and task completion parsing
- `src/main/lib/db/schema/index.ts` - source-of-truth schema
