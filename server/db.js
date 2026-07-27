import "dotenv/config";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fallbackPath = path.resolve(__dirname, "./data/app.db");
let dbPath = path.resolve(__dirname, process.env.DB_PATH || fallbackPath);

// A configured DB_PATH (e.g. Render's persistent disk at /data) might not
// actually be writable - the disk wasn't attached (Free plan doesn't support
// them), a mount hasn't finished attaching yet, or a permissions mismatch.
// Falling back to the app's own local folder means the server still starts
// and works instead of crashing outright; it just means that data won't
// survive a restart until the real persistent path is fixed - a clear
// warning either way, never a silent switch.
try {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
} catch (err) {
  console.warn(
    `\nCould not create/access DB_PATH directory (${path.dirname(dbPath)}): ${err.message}\n` +
      `Falling back to ${fallbackPath} - this will NOT persist across restarts/redeploys ` +
      "until DB_PATH points somewhere actually writable (e.g. a real attached persistent disk).\n"
  );
  dbPath = fallbackPath;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
}

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
