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
  addColumnIfMissing("firmware_releases", "md5", "TEXT");
  // Per-cell voltage history (explicit request) - a JSON-encoded array
  // (e.g. "[3.281,3.279,...]"), not one column per cell, since cell count
  // varies per device and isn't fixed - see telemetryLogger.js's own
  // comment on why this rides along in the same row/interval as the
  // existing pack-level columns instead of a separate table.
  addColumnIfMissing("telemetry_log", "cell_voltages_json", "TEXT");
}

// CREATE TABLE IF NOT EXISTS above only affects a brand-new database - a
// firmware_releases table that already existed before the md5 column was
// added (e.g. this exact local dev DB) never gets it just from re-running
// schema.sql, and ALTER TABLE ADD COLUMN itself isn't safe to blindly re-run
// (errors if the column's already there), hence the existence check first.
function addColumnIfMissing(table, column, type) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (cols.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}
