# Module: main-trpc

<!-- location: src/main/lib/trpc -->
<!-- last-verified: 2026-02-14 -->

## Purpose

Defines typed backend APIs and streaming subscriptions between renderer and main process.

## Key Files

- `src/main/lib/trpc/routers/claude.ts` - chat runtime orchestration
- `src/main/lib/trpc/routers/tasks.ts` - task CRUD + execution linking
- `src/main/lib/trpc/routers/goals.ts` - goal CRUD and builder creation
- `src/main/lib/trpc/routers/index.ts` - router aggregation

## Dependencies

- depends on `db`, `cli/adapters`, `state-engine`, prompt modules
- used by renderer via `trpcClient`

## Boundaries

- Owns process-boundary API contracts
- Should not contain renderer UI concerns

