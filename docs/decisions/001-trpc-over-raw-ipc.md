# ADR-001: Use tRPC as primary process boundary

- Status: accepted
- Date: 2026-02-14

## Context

The app requires a reliable and typed boundary between renderer and main process for streaming chat, task state updates, and file/system operations.

## Decision

Use tRPC routers as the single primary API boundary for renderer↔main communication.

## Consequences

- Strong type contracts across process boundary.
- Centralized backend procedures under `src/main/lib/trpc/routers`.
- Reduced ad-hoc IPC drift and easier onboarding.

