import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const FIRMWARE_DIR = path.join(REPO_ROOT, "firmware");

// Committing the uploaded .bin into the repo itself (firmware/<filename>)
// instead of only a DB blob solves the exact persistence gap that blob
// storage has on Render's Free tier: a redeploy re-clones the repo fresh,
// so a file that's actually IN the git tree comes back automatically, where
// an ephemeral-disk-only SQLite blob would not (see db.js's matching
// comment). Auth uses a short-lived `http.extraheader` for this one push
// only - never persists a token into .git/config.
function run(args, options = {}) {
  return execFileAsync("git", args, { cwd: REPO_ROOT, ...options });
}

export function isGitStorageConfigured() {
  return !!process.env.GITHUB_TOKEN && fs.existsSync(path.join(REPO_ROOT, ".git"));
}

/**
 * Writes `data` to firmware/<filename> and commits + pushes it to the repo's
 * current branch. Throws with a clear message if GITHUB_TOKEN isn't set or
 * this isn't actually a git checkout (e.g. a stripped deploy artifact) -
 * callers should treat that as "git storage unavailable this time", not a
 * reason to fail the whole upload (the DB row/blob already saved by then).
 */
export async function commitFirmwareFile(filename, data) {
  if (!process.env.GITHUB_TOKEN) {
    throw new Error("GITHUB_TOKEN is not set - add it in Render's Environment settings to enable git-backed storage");
  }
  if (!fs.existsSync(path.join(REPO_ROOT, ".git"))) {
    throw new Error("No .git checkout found at runtime - this deploy doesn't have repo history available to commit into");
  }

  fs.mkdirSync(FIRMWARE_DIR, { recursive: true });
  const filePath = path.join(FIRMWARE_DIR, filename);
  fs.writeFileSync(filePath, data);

  const relPath = `firmware/${filename}`;
  const authHeader = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${process.env.GITHUB_TOKEN}`).toString("base64")}`;

  await run(["add", relPath]);
  // Nothing to commit (identical bytes re-uploaded) isn't an error - the
  // file's already there and already pushed from the prior upload.
  try {
    await run(["-c", "user.name=BMS Dashboard", "-c", "user.email=bms-dashboard@render", "commit", "-m", `Add firmware ${filename}`]);
  } catch (err) {
    if (!/nothing to commit/i.test(err.stdout ?? err.message ?? "")) throw err;
    return { pushed: false, reason: "unchanged" };
  }

  const branch = (await run(["rev-parse", "--abbrev-ref", "HEAD"])).stdout.trim();
  await run(["-c", `http.extraheader=${authHeader}`, "push", "origin", `HEAD:${branch}`]);
  return { pushed: true };
}
