# Data Model

SQLite + Drizzle schema lives in `src/main/lib/db/schema/index.ts`.

## Core Tables

- `projects`, `chats`, `sub_chats` - session/workspace/chat runtime records
- `goals`, `plans`, `tasks` - planning and execution hierarchy
- `memories`, `insights` - learned context and knowledge artifacts
- `agents` - reusable agent configurations

## Key Relations

- A `chat` has many `sub_chats`.
- A `goal` has many `tasks` (and optional plans).
- A `task` can link to a `chat` and feeds execution context.
- `memories` attach learned key/value context to goals/tasks.

## Migration Notes

- Run `bun run db:generate` after schema changes.
- In development, migrations run automatically at app startup.

