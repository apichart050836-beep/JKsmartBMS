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

// Accepts either "owner/repo" (with or without a trailing .git) or a full
// GitHub URL (https or git@) and returns {owner, repo}.
function parseOwnerRepo(text) {
  const trimmed = text.trim();
  const urlMatch = trimmed.match(/github\.com[/:]([^/]+)\/(.+?)(?:\.git)?$/);
  if (urlMatch) return { owner: urlMatch[1], repo: urlMatch[2] };
  const slugMatch = trimmed.match(/^([^/\s]+)\/([^/\s]+?)(?:\.git)?$/);
  if (slugMatch) return { owner: slugMatch[1], repo: slugMatch[2] };
  throw new Error(`Can't parse "${text}" as a GitHub owner/repo`);
}

// Render's runtime checkout has been confirmed (2026-07-29, live error: `git
// push origin ...` -> "fatal: 'origin' does not appear to be a git
// repository") to NOT reliably have a working "origin" remote the way a
// normal developer clone does - Render builds from its own internal fetch,
// not a `git clone` of the GitHub repo with origin preserved. Trusting
// `git remote get-url origin` at runtime is therefore fragile on that host,
// even though it works fine locally. GITHUB_REPO (Render env var, e.g.
// "apichart050836-beep/JKsmartBMS") is the reliable override - falls back to
// reading the local remote only when that's not set (plain local dev, where
// origin genuinely is the real repo).
async function resolveOwnerRepo() {
  if (process.env.GITHUB_REPO) return parseOwnerRepo(process.env.GITHUB_REPO);
  const remoteUrl = (await run(["remote", "get-url", "origin"])).stdout;
  return parseOwnerRepo(remoteUrl);
}

// Same story as the remote above: `git rev-parse --abbrev-ref HEAD` returns
// the literal string "HEAD" when the checkout is in detached-HEAD state
// (also confirmed live on Render, from the same error - the failed push was
// literally "HEAD:HEAD", a nonsense refspec built from that). GITHUB_BRANCH
// is the override; a detached HEAD with no override throws a clear error
// instead of silently building a broken push.
async function resolveBranch() {
  if (process.env.GITHUB_BRANCH) return process.env.GITHUB_BRANCH;
  const branch = (await run(["rev-parse", "--abbrev-ref", "HEAD"])).stdout.trim();
  if (!branch || branch === "HEAD") {
    throw new Error(
      "Can't determine a real branch name - checkout is in detached-HEAD state (common on Render). Set GITHUB_BRANCH in the environment (e.g. \"main\")."
    );
  }
  return branch;
}

/**
 * Real raw.githubusercontent.com URL for a file already committed under
 * firmware/ on the target branch. Only meaningful to call after
 * commitFirmwareFile() has actually pushed the file (the URL is otherwise
 * valid-looking but 404s).
 */
export async function getRawFirmwareUrl(filename) {
  const { owner, repo } = await resolveOwnerRepo();
  const branch = await resolveBranch();
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/firmware/${filename}`;
}

/**
 * Writes `data` to firmware/<filename> and commits + pushes it to the
 * target repo/branch (see resolveOwnerRepo/resolveBranch above - GITHUB_REPO
 * and GITHUB_BRANCH env vars, not the checkout's ambient git state, are the
 * source of truth on a host like Render). Throws with a clear message if
 * GITHUB_TOKEN isn't set or this isn't actually a git checkout (e.g. a
 * stripped deploy artifact) - callers should treat that as "git storage
 * unavailable this time", not a reason to fail the whole upload (the DB
 * row/blob already saved by then).
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

  const { owner, repo } = await resolveOwnerRepo();
  const branch = await resolveBranch();
  const remoteUrl = `https://github.com/${owner}/${repo}.git`;

  // Explicitly (re)point "origin" at the real repo before every push -
  // regardless of whatever "origin" this checkout came with (or didn't),
  // this guarantees the push target is always correct instead of trusting
  // whatever the deploy happened to leave configured.
  try {
    await run(["remote", "set-url", "origin", remoteUrl]);
  } catch {
    await run(["remote", "add", "origin", remoteUrl]);
  }

  await run(["-c", `http.extraheader=${authHeader}`, "push", "origin", `HEAD:refs/heads/${branch}`]);
  return { pushed: true };
}
