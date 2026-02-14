# IPC Boundary (tRPC)

1Code uses a typed tRPC bridge between renderer and main instead of ad-hoc raw IPC calls.

## Flow

1. Renderer calls `trpcClient.<router>.<procedure>`.
2. Preload bridge exposes safe APIs and tRPC transport.
3. Main router executes logic and returns data or stream chunks.
4. Renderer updates UI state from streamed chunks.

## Why This Matters

- Type-safe contracts across process boundary.
- Single backend surface (`src/main/lib/trpc/routers/*`).
- Easier evolution and observability of chat/task flows.

