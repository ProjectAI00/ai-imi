# Development Setup

## Core Commands

- `bun run dev` - run Electron in development mode.
- `bun run build` - production build verification.
- `bun run db:generate` - generate migrations.
- `bun run db:push` - apply schema in dev.

## Suggested Validation Loop

1. Make change.
2. Run targeted checks.
3. Run `bun run build`.
4. Verify behavior in app.

