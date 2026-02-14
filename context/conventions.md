# Conventions

<!-- last-verified: 2026-02-14 -->

## Backend

- Add process-boundary APIs through tRPC routers.
- Keep execution/state logic in `src/main/lib`.
- Prefer explicit status transitions and surfaced errors.

## Frontend

- Jotai for UI atoms, Zustand for sub-chat/store state.
- React Query/tRPC for server data flows.
- Keep transport logic in `ipc-chat-transport.ts`.

## Docs

- `docs/` for human docs.
- `context/` for AI context cards.

