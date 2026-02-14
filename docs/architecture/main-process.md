# Main Process

The main process owns execution and persistence.

## Primary Responsibilities

- Initialize Electron app lifecycle and windows.
- Initialize SQLite/Drizzle and run migrations.
- Expose typed tRPC routers to renderer.
- Spawn and stream AI CLI sessions through adapters.
- Handle auth, git/worktree ops, and task/goal state transitions.

## Key Files

- `src/main/index.ts` - app bootstrap and startup wiring
- `src/main/windows/main.ts` - main window setup and IPC handlers
- `src/main/lib/trpc/routers/claude.ts` - chat orchestration and mode-specific behavior
- `src/main/lib/db/index.ts` - DB init and migration
- `src/main/lib/cli/adapter.ts` - adapter registry
- `src/main/lib/cli/adapters/*.ts` - concrete CLI implementations

## Contributor Notes

- Business/runtime logic should live in `src/main/lib/*`, not renderer.
- Add new backend capabilities through a tRPC router.
- Keep stream and state updates explicit; do not silently swallow failures.

