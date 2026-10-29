import Database from "better-sqlite3";
import path from "node:path";

// Server-only: opens the SQLite file the Python pipeline builds (data/app.db).
// Set APP_DB_PATH to point somewhere else (for example in deployment).

const globalForDb = globalThis as unknown as {
  __appDb?: Database.Database;
};

export function getDb(): Database.Database {
  if (!globalForDb.__appDb) {
    const file =
      process.env.APP_DB_PATH ??
      path.join(process.cwd(), "..", "data", "app.db");
    globalForDb.__appDb = new Database(file, {
      readonly: true,
      fileMustExist: true,
    });
  }
  return globalForDb.__appDb;
}
