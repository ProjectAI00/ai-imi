import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { eq } from "drizzle-orm"
import { app } from "electron"
import { join } from "path"
import { existsSync, mkdirSync, writeFileSync } from "fs"
import { homedir } from "os"
import * as schema from "./schema"

let db: ReturnType<typeof drizzle<typeof schema>> | null = null
let sqlite: Database.Database | null = null

/**
 * Get the database path in the app's user data directory
 */
function getDatabasePath(): string {
  const userDataPath = app.getPath("userData")
  const dataDir = join(userDataPath, "data")

  // Ensure data directory exists
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true })
  }

  return join(dataDir, "agents.db")
}

/**
 * Get the migrations folder path
 * Handles both development and production (packaged) environments
 */
function getMigrationsPath(): string {
  if (app.isPackaged) {
    // Production: migrations bundled in resources
    return join(process.resourcesPath, "migrations")
  }
  // Development: from out/main -> apps/desktop/drizzle
  return join(__dirname, "../../drizzle")
}

/**
 * Initialize the database with Drizzle ORM
 */
export function initDatabase() {
  if (db) {
    return db
  }

  const dbPath = getDatabasePath()
  console.log(`[DB] Initializing database at: ${dbPath}`)

  // Create SQLite connection
  sqlite = new Database(dbPath)
  sqlite.pragma("journal_mode = WAL")
  sqlite.pragma("foreign_keys = ON")

  // Create Drizzle instance
  db = drizzle(sqlite, { schema })

  // Run migrations
  const migrationsPath = getMigrationsPath()
  console.log(`[DB] Running migrations from: ${migrationsPath}`)

  try {
    migrate(db, { migrationsFolder: migrationsPath })
    console.log("[DB] Migrations completed")
  } catch (error) {
    console.error("[DB] Migration error:", error)
    throw error
  }

  return db
}

/**
 * Get the database instance
 */
export function getDatabase() {
  if (!db) {
    return initDatabase()
  }
  return db
}

/**
 * Close the database connection
 */
export function closeDatabase(): void {
  if (sqlite) {
    sqlite.close()
    sqlite = null
    db = null
    console.log("[DB] Database connection closed")
  }
}

/**
 * Default workspace folder path
 */
const DEFAULT_WORKSPACE_NAME = "Personal"
const DEFAULT_WORKSPACE_FOLDER = "imi-workspace"

export function getDefaultWorkspacePath(): string {
  return join(homedir(), DEFAULT_WORKSPACE_FOLDER)
}

/**
 * Ensure default workspace folder exists and is registered as a project
 * Returns the default project if created/exists, null if user has other projects
 */
export function ensureDefaultWorkspace(): schema.Project | null {
  const database = getDatabase()
  const workspacePath = getDefaultWorkspacePath()
  
  // Check if workspace folder exists, create if not
  if (!existsSync(workspacePath)) {
    console.log(`[DB] Creating default workspace at: ${workspacePath}`)
    mkdirSync(workspacePath, { recursive: true })
    
    // Create a README to explain the folder
    const readmePath = join(workspacePath, "README.md")
    writeFileSync(readmePath, `# imi Workspace

This is your default imi workspace folder.

You can:
- Create new projects here
- Add existing projects from anywhere on your machine
- Delete this folder and select a different default location in the app

Happy coding! 🚀
`)
  }
  
  // Check if project already exists in database
  const existing = database
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.path, workspacePath))
    .get()
  
  if (existing) {
    console.log(`[DB] Default workspace already registered: ${existing.id}`)
    return existing
  }
  
  // Create project entry
  const newProject = database
    .insert(schema.projects)
    .values({
      name: DEFAULT_WORKSPACE_NAME,
      path: workspacePath,
    })
    .returning()
    .get()
  
  console.log(`[DB] Default workspace created: ${newProject?.id}`)
  return newProject ?? null
}

/**
 * Ensure default "Personal" workspace exists in workspaces table
 * Returns the default workspace
 */
export function ensureDefaultWorkspaceEntry(): schema.Workspace | null {
  const database = getDatabase()
  
  // Check if any workspace exists
  const existingWorkspaces = database
    .select()
    .from(schema.workspaces)
    .all()
  
  if (existingWorkspaces.length > 0) {
    console.log(`[DB] Workspaces already exist: ${existingWorkspaces.length}`)
    return existingWorkspaces[0] ?? null
  }
  
  // Create default "Personal" workspace
  const newWorkspace = database
    .insert(schema.workspaces)
    .values({
      name: DEFAULT_WORKSPACE_NAME,
      description: "Your personal workspace",
      color: "#6B7280", // gray
    })
    .returning()
    .get()
  
  console.log(`[DB] Default workspace entry created: ${newWorkspace?.id}`)
  return newWorkspace ?? null
}

// Re-export schema for convenience
export * from "./schema"
