# Module: main-db

<!-- location: src/main/lib/db -->
<!-- last-verified: 2026-02-14 -->

## Purpose

Provides SQLite persistence, schema definitions, and migration lifecycle.

## Key Files

- `src/main/lib/db/index.ts` - DB initialization and migration execution
- `src/main/lib/db/schema/index.ts` - table schema and relations

## Dependencies

- depends on `better-sqlite3` and `drizzle-orm`
- used by routers and state engine modules

## Boundaries

- Owns persistence contracts and table structure
- Should not own higher-level business orchestration decisions

