import "dotenv/config";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.resolve(__dirname, process.env.DB_PATH || "./data/app.db");

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

// Node's built-in SQLite (stable since Node 22.5, no native module / node-gyp
// build step needed - avoids the Python/Visual Studio toolchain that
// better-sqlite3 would otherwise require on Windows).
export const db = new DatabaseSync(dbPath);
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

// Runs schema.sql on every boot - CREATE TABLE IF NOT EXISTS statements only,
// so this is always safe to re-run and never touches existing rows.
export function migrate() {
  const schemaPath = path.join(__dirname, "db", "schema.sql");
  const schema = fs.readFileSync(schemaPath, "utf8");
  db.exec(schema);
}
