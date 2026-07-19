import express from "express";
import type { Response } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { readFile, writeFile, rename, readdir, access } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  uniqueId,
  parseBranchLine,
  parseWorktrees,
  bumpVersionInPackageJson,
  authMessage,
  selectTestRunners,
  pickDefaultBranch,
} from "./pure.ts";
import type {
  BrowseEntry,
  BrowseResult,
  BumpDecision,
  Commit,
  CommitDetail,
  CommitFile,
  DiffFile,
  DiffLine,
  FileChange,
  GitStatusDetail,
  PipelineEvent,
  PipelineStep,
  StepStatus,
  Repo,
  RepoConfigEntry,
  RepoConfigFile,
  RepoStatus,
  TestRunner,
  Worktree,
} from "../shared/types.ts";

const execFileAsync = promisify(execFile);

// Load .env (if present) so ANTHROPIC_API_KEY etc. reach this process. No dependency needed.
try {
  process.loadEnvFile();
} catch {
  // No .env file — fall back to the ambient environment.
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CONFIG_PATH = process.env.REPOS_CONFIG ?? path.join(ROOT, "repos.config.json");
const PORT = Number(process.env.API_PORT ?? 3001);
// Bind to loopback by default: the API runs arbitrary repo commands (pipeline), reads the
// filesystem (/browse), and pushes to git, all unauthenticated — it must not be LAN-reachable.
// Override only if you understand the exposure (e.g. behind your own auth proxy).
const HOST = process.env.API_HOST ?? "127.0.0.1";

async function loadConfig(): Promise<Required<RepoConfigFile>> {
  const raw = await readFile(CONFIG_PATH, "utf8");
  const parsed = JSON.parse(raw) as Partial<RepoConfigFile>;
  if (!Array.isArray(parsed.repos)) {
    throw new Error(`${CONFIG_PATH}: expected a top-level "repos" array`);
  }
  return {
    repos: parsed.repos,
    selectedId: parsed.selectedId ?? null,
    selectedWorktree: parsed.selectedWorktree ?? null,
  };
}

async function saveConfig(config: Required<RepoConfigFile>): Promise<void> {
  // Write-then-rename so concurrent readers never observe a truncated file.
  const tmp = `${CONFIG_PATH}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(config, null, 2) + "\n", "utf8");
  await rename(tmp, CONFIG_PATH);
}

/** True when `dir` is the root of a git repo (.git exists as a dir or worktree file). */
async function isGitRepo(dir: string): Promise<boolean> {
  try {
    await access(path.join(dir, ".git"));
    return true;
  } catch {
    return false;
  }
}

/** Turn a directory name into a slug, kept unique against `taken`. */
/** Run a git command in `cwd`, returning trimmed stdout or null on any failure. */
async function git(cwd: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd, maxBuffer: 8 * 1024 * 1024 });
    return stdout.trim();
  } catch {
    return null;
  }
}

/** Run an arbitrary binary in `cwd`, returning raw stdout (ANSI preserved) or null. */
async function run(cmd: string, args: string[], cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(cmd, args, { cwd, maxBuffer: 8 * 1024 * 1024 });
    return stdout;
  } catch {
    return null;
  }
}

/** Run git and report success/output — for write commands where we need the exit status. */
async function gitExec(
  cwd: string,
  args: string[],
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync("git", args, { cwd, maxBuffer: 8 * 1024 * 1024 });
    return { ok: true, stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return {
      ok: false,
      stdout: (e.stdout ?? "").trim(),
      stderr: (e.stderr ?? e.message ?? "").trim(),
    };
  }
}

const COMMIT_SYSTEM =
  "You write git commit messages. Output ONLY the commit message text — no preamble, no " +
  "explanation, no markdown code fences. First line: an imperative-mood summary under 72 " +
  "characters, optionally prefixed with a Conventional Commits type (feat, fix, chore, docs, " +
  "refactor, test, style, perf). If the change is non-trivial, add a blank line then a short " +
  "body of '- ' bullet points. Describe only what the diff shows; do not invent details.";

/** Ask Claude (via the Anthropic SDK) for a commit message describing the staged changes. */
async function generateCommitMessage(
  statusText: string,
  stat: string,
  patch: string,
): Promise<string> {
  // Zero-arg client resolves ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN / an `ant auth login` profile.
  const client = new Anthropic();
  const MAX_DIFF = 12000;
  const diff =
    patch.length > MAX_DIFF ? `${patch.slice(0, MAX_DIFF)}\n… (diff truncated)` : patch;

  const response = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 1024,
    system: COMMIT_SYSTEM,
    messages: [
      {
        role: "user",
        content:
          `Write a commit message for these changes.\n\n` +
          `git status --porcelain:\n${statusText}\n\n` +
          `Files changed (git diff HEAD --stat):\n${stat || "(no tracked-file changes)"}\n\n` +
          `Diff (git diff HEAD):\n${diff || "(no tracked-file diff — new/untracked files only)"}`,
      },
    ],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  // Strip accidental code fences if the model wrapped the message.
  return text
    .replace(/^```[a-z]*\n?/i, "")
    .replace(/\n?```$/i, "")
    .trim();
}

/** A commit-message generation failure carrying the HTTP status the route should return. */
class CommitMsgError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * Compute the working-tree diff and ask Claude for a commit message.
 * `statusText` is the already-fetched `git status --porcelain`. Throws a
 * CommitMsgError (with the right HTTP status) on auth/model failures.
 */
async function generateOrThrow(dir: string, statusText: string): Promise<string> {
  const stat = (await git(dir, ["diff", "HEAD", "--stat"])) ?? "";
  const patch = (await git(dir, ["diff", "HEAD"])) ?? "";
  let message: string;
  try {
    message = await generateCommitMessage(statusText, stat, patch);
  } catch (err) {
    const raw = (err as Error).message ?? "";
    const isAuth =
      err instanceof Anthropic.AuthenticationError ||
      (err as { status?: number }).status === 401 ||
      /authentication method|api[ _]?key|ANTHROPIC_API_KEY|credential/i.test(raw);
    throw new CommitMsgError(
      isAuth
        ? "No Anthropic credentials found. Set ANTHROPIC_API_KEY (or run `ant auth login`) for the API server, then retry."
        : `Could not generate a commit message: ${raw}`,
      isAuth ? 401 : 502,
    );
  }
  if (!message) throw new CommitMsgError("The model returned an empty commit message", 502);
  return message;
}

/** First installed git-forest-style viewer on PATH (git-foresta preferred), or null. */
async function findForestBin(): Promise<string | null> {
  for (const bin of ["git-foresta", "git-forest"]) {
    try {
      await execFileAsync("which", [bin]);
      return bin;
    } catch {
      /* not on PATH */
    }
  }
  return null;
}

async function readStatus(entry: RepoConfigEntry): Promise<RepoStatus> {
  const empty: RepoStatus = {
    branch: null,
    dirtyCount: 0,
    lastCommit: null,
    worktrees: [],
    available: false,
  };
  if (!entry.path) return empty;

  const branch = await git(entry.path, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch === null) return empty; // path missing or not a git repo

  const porcelain = await git(entry.path, ["status", "--porcelain"]);
  const dirtyCount = porcelain ? porcelain.split("\n").filter(Boolean).length : 0;

  const lastCommit = await git(entry.path, ["log", "-1", "--pretty=%h %s"]);

  const worktreeList = await git(entry.path, ["worktree", "list", "--porcelain"]);
  const worktrees = (worktreeList ?? "")
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length));

  return { branch, dirtyCount, lastCommit, worktrees, available: true };
}

/** Parse the `## ...` branch header line from `git status --porcelain -b`. */
async function readStatusDetail(entry: RepoConfigEntry, cwd?: string): Promise<GitStatusDetail> {
  const base: GitStatusDetail = {
    id: entry.id,
    name: entry.name,
    available: false,
    branch: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    files: [],
    clean: true,
  };
  const dir = cwd ?? entry.path;
  if (!dir) return base;

  const raw = await git(dir, ["status", "--porcelain=v1", "-b"]);
  if (raw === null) return base; // path missing or not a git repo

  const lines = raw.split("\n");
  const header = lines[0]?.startsWith("## ") ? parseBranchLine(lines[0]) : {};

  const files: FileChange[] = lines
    .slice(1)
    .filter((line) => line.length >= 3)
    .map((line) => {
      let filePath = line.slice(3);
      const arrow = filePath.indexOf(" -> "); // rename/copy: "old -> new"
      if (arrow >= 0) filePath = filePath.slice(arrow + 4);
      return { path: filePath, x: line[0], y: line[1] };
    });

  return { ...base, ...header, available: true, files, clean: files.length === 0 };
}

const LOG_SEP = "\x1f"; // unit separator: safe field delimiter within a commit line

// Record separator between commits — lets a commit's (multi-line) %b body be one field.
const LOG_REC = "\x1e";

async function readLog(
  entry: RepoConfigEntry,
  limit: number,
  cwd?: string,
  all = false,
): Promise<Commit[]> {
  const dir = cwd ?? entry.path;
  if (!dir) return [];

  const format = ["%H", "%h", "%s", "%an", "%ae", "%ad", "%ar", "%b"].join(LOG_SEP) + LOG_REC;
  const args = ["log", `-n${limit}`, "--date=iso-strict"];
  if (all) args.push("--all");
  args.push(`--pretty=format:${format}`);
  const raw = await git(dir, args);
  if (!raw) return []; // not a repo, or no commits yet

  return raw
    .split(LOG_REC)
    .map((rec) => rec.replace(/^\n/, "")) // git separates entries with a newline
    .filter((rec) => rec.length > 0)
    .map((rec) => {
      const [hash, shortHash, subject, author, authorEmail, date, relativeDate, body = ""] =
        rec.split(LOG_SEP);
      return { hash, shortHash, subject, author, authorEmail, date, relativeDate, body: body.trim() };
    });
}

/**
 * Full detail for one commit: metadata + per-file stats + parsed diff.
 * `git show --numstat` and `--name-status` list files in the same order, so we pair them by index.
 */
async function readCommitDetail(dir: string, hash: string): Promise<CommitDetail | null> {
  const SEP = "\x1f";
  const metaFmt = ["%H", "%h", "%s", "%b", "%an", "%ae", "%ad", "%ar"].join(SEP);
  const meta = await git(dir, ["show", "-s", "--date=iso-strict", `--format=${metaFmt}`, hash]);
  if (meta === null) return null;
  const parts = meta.split(SEP);
  const [fullHash = hash, shortHash = "", subject = "", body = "", author = "", authorEmail = "", date = "", relativeDate = ""] =
    parts;

  const numstat = (await git(dir, ["show", hash, "--numstat", "--format="])) ?? "";
  const namestat = (await git(dir, ["show", hash, "--name-status", "--format="])) ?? "";
  const combined = (await git(dir, ["show", hash, "--format="])) ?? "";
  const diffByFile = parseUnifiedDiff(combined);

  const numLines = numstat.split("\n").filter(Boolean);
  const nameLines = namestat.split("\n").filter(Boolean);
  const files: CommitFile[] = nameLines.map((nameLine, i) => {
    const nameCols = nameLine.split("\t");
    const code = nameCols[0] ?? "M";
    const filePath = nameCols[nameCols.length - 1]; // for R/C, the new path is last
    const numCols = (numLines[i] ?? "").split("\t");
    const additions = numCols[0] && numCols[0] !== "-" ? Number(numCols[0]) || 0 : 0;
    const deletions = numCols[1] && numCols[1] !== "-" ? Number(numCols[1]) || 0 : 0;
    const status: CommitFile["status"] = code[0] === "A" ? "A" : code[0] === "D" ? "D" : "M";
    return {
      path: filePath,
      name: path.basename(filePath),
      status,
      additions,
      deletions,
      diff: diffByFile.get(filePath) ?? [],
    };
  });

  return { hash: fullHash, shortHash, subject, body, author, authorEmail, date, relativeDate, files };
}

/** Parse `git worktree list --porcelain` into structured entries (first = main). */
async function readWorktrees(entry: RepoConfigEntry): Promise<Worktree[]> {
  if (!entry.path) return [];
  const out = await git(entry.path, ["worktree", "list", "--porcelain"]);
  if (out === null) return []; // path missing or not a git repo
  return parseWorktrees(out);
}

/**
 * Resolve a requested worktree path to a directory to run git in.
 * SECURITY: only paths that are actually worktrees of `entry` are honored;
 * anything else falls back to the repo's main path (never runs git in an arbitrary dir).
 */
async function resolveWorktreePath(
  entry: RepoConfigEntry,
  requested: unknown,
): Promise<string | undefined> {
  if (typeof requested !== "string" || requested === "") return entry.path;
  const target = path.resolve(requested);
  if (entry.path && path.resolve(entry.path) === target) return entry.path;
  const wts = await readWorktrees(entry);
  const match = wts.find((w) => path.resolve(w.path) === target);
  return match ? match.path : entry.path;
}

// ── Test-runner detection ─────────────────────────────────────────────────────
async function detectTestRunners(entry: RepoConfigEntry): Promise<TestRunner[]> {
  const dir = entry.path;
  if (!dir) return [];

  // Docker test shell scripts (preference order).
  const dockerScriptFiles = [
    "scripts/docker-test.sh",
    "docker-test.sh",
    "test-docker.sh",
    "scripts/test-docker.sh",
  ].filter((rel) => existsSync(path.join(dir, rel)));

  // package.json scripts.
  let scripts: Record<string, string> = {};
  try {
    const pkg = JSON.parse(await readFile(path.join(dir, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    scripts = pkg.scripts ?? {};
  } catch {
    /* no package.json */
  }

  // Ecosystem marker files.
  const ecoFiles = ["go.mod", "Cargo.toml", "pytest.ini", "pyproject.toml"].filter((f) =>
    existsSync(path.join(dir, f)),
  );

  // Makefile with a `test:` target.
  let makefileHasTest = false;
  const makefile = path.join(dir, "Makefile");
  if (existsSync(makefile)) {
    try {
      makefileHasTest = /^test\s*:/m.test(await readFile(makefile, "utf8"));
    } catch {
      /* unreadable */
    }
  }

  return selectTestRunners({ dockerScriptFiles, scripts, ecoFiles, makefileHasTest });
}

// ── Version bump (Claude decides, applied to package.json) ─────────────────────
const BUMP_SYSTEM =
  "You are a release assistant. Given a git diff, decide the Semantic Versioning bump: " +
  "'major' for backward-incompatible/breaking changes, 'minor' for new backward-compatible " +
  "features, 'patch' for fixes, docs, chores, refactors, tests, or data updates. Prefer 'patch' " +
  "unless there is clear evidence of a new feature (minor) or a breaking change (major). Reply with " +
  "the keyword (major, minor, or patch) on the first line, then one short sentence explaining why.";

async function decideBump(from: string, stat: string, patch: string): Promise<Omit<BumpDecision, "from" | "to">> {
  const client = new Anthropic();
  const MAX = 12000;
  const diff = patch.length > MAX ? `${patch.slice(0, MAX)}\n… (diff truncated)` : patch;
  const res = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 256,
    system: BUMP_SYSTEM,
    messages: [
      {
        role: "user",
        content: `Current version: ${from}\n\nFiles changed:\n${stat || "(none)"}\n\nDiff:\n${diff || "(no tracked diff)"}`,
      },
    ],
  });
  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  const m = /\b(major|minor|patch)\b/i.exec(text);
  const bump = (m ? m[1].toLowerCase() : "patch") as BumpDecision["bump"];
  const reasoning = text.replace(/^\s*(major|minor|patch)\b[:.\-\s]*/i, "").trim();
  return { bump, reasoning };
}

/** Increment the core semver of `v` per `bump` (prerelease/build suffixes are dropped). */
/** Bump the `version` field in package.json with a targeted replace (preserves formatting). */
async function applyBump(pkgPath: string, bump: BumpDecision["bump"]): Promise<{ from: string; to: string }> {
  const raw = await readFile(pkgPath, "utf8");
  const { from, to, text } = bumpVersionInPackageJson(raw, bump);
  await writeFile(pkgPath, text, "utf8");
  return { from, to };
}

// ── Streaming release pipeline (tests → bump → commit → push) ──────────────────
interface Job {
  id: string;
  repoId: string;
  status: "running" | "done" | "error";
  events: PipelineEvent[]; // buffered for replay to late subscribers
  subscribers: Set<Response>;
  child: ChildProcess | null;
  cancelled: boolean;
}
const jobs = new Map<string, Job>();

function emit(job: Job, ev: PipelineEvent): void {
  job.events.push(ev);
  const data = `data: ${JSON.stringify(ev)}\n\n`;
  for (const res of job.subscribers) res.write(data);
}

function finishJob(job: Job, status: "done" | "error"): void {
  job.status = status;
  for (const res of job.subscribers) {
    try {
      res.write("event: end\ndata: {}\n\n");
      res.end();
    } catch {
      /* already closed */
    }
  }
  job.subscribers.clear();
  setTimeout(() => jobs.delete(job.id), 120_000).unref();
}

/**
 * The environment handed to a spawned test command. The command is arbitrary repo code, so
 * strip the API server's own Anthropic credentials — otherwise a test script (e.g. `env`) could
 * exfiltrate the key we loaded from `.env`.
 */
function childEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  return env;
}

/**
 * Run a shell command in `dir` with a sanitized env, a 20s timeout, and a 1MB
 * output cap. Combines stdout+stderr and always resolves (non-zero exit is data,
 * not an exception). Used by the Terminal drawer's exec endpoint.
 */
async function runShell(dir: string, command: string): Promise<{ code: number; output: string }> {
  try {
    const { stdout, stderr } = await execFileAsync("bash", ["-c", command], {
      cwd: dir,
      env: childEnv(),
      timeout: 20_000,
      maxBuffer: 1024 * 1024,
    });
    return { code: 0, output: stdout + stderr };
  } catch (err) {
    const e = err as {
      code?: number | string;
      stdout?: string;
      stderr?: string;
      killed?: boolean;
      signal?: string;
      message?: string;
    };
    const body = (e.stdout ?? "") + (e.stderr ?? "");
    if (e.killed && e.signal === "SIGTERM") {
      return { code: 124, output: `${body}\n[command timed out after 20s]` };
    }
    return { code: typeof e.code === "number" ? e.code : 1, output: body || e.message || "" };
  }
}

/** Run a shell command in `cwd`, streaming stdout+stderr as log events. Resolves the exit code. */
function runStreamed(job: Job, command: string, cwd: string): Promise<number> {
  return new Promise((resolve) => {
    // detached so we can kill the whole process group (e.g. docker) on cancel.
    const child = spawn("bash", ["-c", command], { cwd, env: childEnv(), detached: true });
    job.child = child;
    child.stdout?.on("data", (d: Buffer) => emit(job, { type: "log", text: d.toString() }));
    child.stderr?.on("data", (d: Buffer) => emit(job, { type: "log", text: d.toString() }));
    child.on("error", (e) => {
      emit(job, { type: "log", text: `spawn error: ${e.message}\n` });
      resolve(127);
    });
    child.on("close", (code) => {
      job.child = null;
      resolve(code ?? 0);
    });
  });
}

const PIPELINE_ORDER: PipelineStep[] = ["tests", "commit", "merge", "bump", "push"];

/**
 * Release flow: tests + commit in the SELECTED worktree, then merge that branch into main,
 * bump the version in main, and push from main. Bump/push never run in the worktree.
 */
/**
 * Commits on `branch` not yet on `origin/<branch>`.
 * Returns null when there's no `origin/<branch>` ref to compare against (never pushed),
 * which callers treat as "there's something to publish".
 */
async function commitsAheadOfOrigin(dir: string, branch: string): Promise<number | null> {
  const hasUpstream = await git(dir, [
    "rev-parse",
    "--verify",
    "--quiet",
    `refs/remotes/origin/${branch}`,
  ]);
  if (hasUpstream === null) return null;
  const out = await git(dir, ["rev-list", "--count", `origin/${branch}..${branch}`]);
  return out === null ? 0 : Number(out) || 0;
}

/**
 * The repository's canonical default branch (what feature branches merge into),
 * independent of whichever branch happens to be checked out in the main worktree.
 * Prefers the remote HEAD (origin/HEAD → e.g. "main"), then a local main/master,
 * else falls back to `fallback` (preserving prior single-branch behavior).
 */
async function resolveDefaultBranch(dir: string, fallback: string): Promise<string> {
  const originHead = await git(dir, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
  const localBranches = new Set<string>();
  for (const candidate of ["main", "master"]) {
    if ((await git(dir, ["rev-parse", "--verify", "--quiet", `refs/heads/${candidate}`])) !== null) {
      localBranches.add(candidate);
    }
  }
  return pickDefaultBranch(originHead, localBranches, fallback);
}

async function runPipeline(
  job: Job,
  entry: RepoConfigEntry,
  requestedWorktree: unknown,
  command: string,
  push: boolean,
): Promise<void> {
  const step = (s: PipelineStep, status: StepStatus, detail?: string) =>
    emit(job, { type: "step", step: s, status, detail });
  const stop = (ok: boolean) => {
    emit(job, { type: "done", ok });
    finishJob(job, "done");
  };
  const skipFrom = (s: PipelineStep) => {
    for (const rest of PIPELINE_ORDER.slice(PIPELINE_ORDER.indexOf(s))) step(rest, "skipped");
  };
  // Run a git write command and stream its actual stdout/stderr into the console log.
  const runGit = async (dir: string, args: string[]) => {
    const res = await gitExec(dir, args);
    const out = [res.stdout, res.stderr].filter(Boolean).join("\n").trim();
    emit(job, { type: "log", text: `$ git ${args.join(" ")}\n${out ? `${out}\n` : ""}` });
    return res;
  };

  try {
    const wts = await readWorktrees(entry);
    const main = wts.find((w) => w.isMain);
    if (!main?.path || !main.branch) {
      emit(job, { type: "error", message: "No main working tree with a checked-out branch" });
      return stop(false);
    }
    const mainDir = main.path;
    const mainBranch = main.branch;
    const worktreeDir = (await resolveWorktreePath(entry, requestedWorktree)) ?? mainDir;
    const worktree = wts.find((w) => path.resolve(w.path) === path.resolve(worktreeDir)) ?? main;
    const onMain = path.resolve(worktreeDir) === path.resolve(mainDir);
    // The branch feature work lands on — not necessarily the branch currently
    // checked out in the main worktree (the user may have a feature branch
    // checked out there directly).
    const defaultBranch = await resolveDefaultBranch(mainDir, mainBranch);
    const onDefaultBranch = worktree.branch === defaultBranch;

    // Push main to origin — used by the normal flow AND the clean-tree fast path.
    const pushMain = async (): Promise<boolean> => {
      step("push", "running");
      const remotes = await git(mainDir, ["remote"]);
      if (!remotes || !remotes.split("\n").includes("origin")) {
        step("push", "failed", "no 'origin' remote");
        return false;
      }
      const pushed = await runGit(mainDir, ["push", "origin", defaultBranch]);
      if (!pushed.ok) {
        step("push", "failed", pushed.stderr || pushed.stdout);
        return false;
      }
      step("push", "ok", `origin/${defaultBranch}`);
      return true;
    };

    // Diff feeding the bump decision (captured during the commit step).
    let bumpStat = "";
    let bumpPatch = "";

    // 1) TESTS — in the worktree
    step("tests", "running");
    emit(job, { type: "log", text: `[worktree ${worktree.branch ?? "detached"}] $ ${command}\n` });
    const code = await runStreamed(job, command, worktreeDir);
    if (job.cancelled) {
      step("tests", "failed", "cancelled");
      return stop(false);
    }
    if (code !== 0) {
      step("tests", "failed", `exit ${code}`);
      skipFrom("commit");
      return stop(false);
    }
    step("tests", "ok");

    // 2) COMMIT — in the worktree (AI message); capture diff for the bump
    step("commit", "running");
    const statusText = (await git(worktreeDir, ["status", "--porcelain"])) ?? "";
    if (statusText.trim() === "") {
      step("commit", "skipped", "nothing to commit");
      if (onMain && onDefaultBranch) {
        step("merge", "skipped");
        step("bump", "skipped");
        // On the default branch with a clean tree, but it may hold commits that were
        // never pushed. If a push was requested, publish that snapshot instead of skipping.
        const ahead = push ? await commitsAheadOfOrigin(mainDir, defaultBranch) : 0;
        if (push && ahead !== 0) {
          emit(job, {
            type: "log",
            text: `Working tree clean; ${
              ahead === null
                ? `'${defaultBranch}' not on origin yet`
                : `${ahead} commit(s) ahead of origin/${defaultBranch}`
            } — pushing.\n`,
          });
          return stop(await pushMain());
        }
        emit(job, {
          type: "log",
          text: push
            ? `Working tree clean and up to date with origin/${defaultBranch} — nothing to release.\n`
            : `Working tree clean on ${defaultBranch}; push disabled — nothing to release.\n`,
        });
        step("push", "skipped");
        return stop(true);
      }
      // A feature branch (checked out in the main worktree or a separate one) with
      // nothing new to commit — release its delta against the default branch.
      const range = `${defaultBranch}...${worktree.branch}`;
      bumpStat = (await git(worktreeDir, ["diff", range, "--stat"])) ?? "";
      bumpPatch = (await git(worktreeDir, ["diff", range])) ?? "";
    } else {
      try {
        bumpStat = (await git(worktreeDir, ["diff", "HEAD", "--stat"])) ?? "";
        bumpPatch = (await git(worktreeDir, ["diff", "HEAD"])) ?? "";
        const message = await generateCommitMessage(statusText, bumpStat, bumpPatch);
        const added = await runGit(worktreeDir, ["add", "-A"]);
        if (!added.ok) {
          step("commit", "failed", added.stderr || added.stdout);
          skipFrom("merge");
          return stop(false);
        }
        const committed = await runGit(worktreeDir, ["commit", "-m", message]);
        if (!committed.ok) {
          step("commit", "failed", committed.stderr || committed.stdout);
          skipFrom("merge");
          return stop(false);
        }
        const hash = (await git(worktreeDir, ["rev-parse", "--short", "HEAD"])) ?? "";
        step("commit", "ok", hash);
      } catch (err) {
        const msg = authMessage(err);
        emit(job, { type: "log", text: `${msg}\n` });
        step("commit", "failed", msg);
        skipFrom("merge");
        return stop(false);
      }
    }

    // 3) MERGE — the release branch into the default branch (in the main worktree)
    if (onDefaultBranch) {
      step("merge", "skipped", `already on ${defaultBranch}`);
    } else {
      step("merge", "running");
      if (!worktree.branch) {
        step("merge", "failed", "worktree is detached (no branch to merge)");
        skipFrom("bump");
        return stop(false);
      }
      // The main worktree must be clean before we switch/merge in it.
      const dirty = await git(mainDir, ["status", "--porcelain"]);
      if (dirty && dirty.length > 0) {
        emit(job, {
          type: "log",
          text: `main worktree ('${mainBranch}') has uncommitted changes — refusing to merge:\n${dirty}\n`,
        });
        step("merge", "failed", `main worktree ('${mainBranch}') is dirty`);
        skipFrom("bump");
        return stop(false);
      }
      // The release branch may be checked out directly in the main worktree; switch
      // it to the default branch before merging into it.
      if (mainBranch !== defaultBranch) {
        const co = await runGit(mainDir, ["checkout", defaultBranch]);
        if (!co.ok) {
          step("merge", "failed", `could not checkout '${defaultBranch}' — ${co.stderr || co.stdout}`);
          skipFrom("bump");
          return stop(false);
        }
      }
      const merged = await runGit(mainDir, ["merge", "--no-edit", worktree.branch]);
      if (!merged.ok) {
        // Log the abort's output too, then leave the default branch untouched.
        await runGit(mainDir, ["merge", "--abort"]);
        step("merge", "failed", "merge failed (see log) — aborted, default branch unchanged");
        skipFrom("bump");
        return stop(false);
      }
      step("merge", "ok", `${worktree.branch} → ${defaultBranch}`);
    }

    // 4) BUMP — in main (Claude decides), committed as "chore: bump version to X"
    step("bump", "running");
    const mainPkg = path.join(mainDir, "package.json");
    if (!existsSync(mainPkg)) {
      step("bump", "failed", "main has no package.json");
      skipFrom("push");
      return stop(false);
    }
    let decision: BumpDecision;
    try {
      const from = /"version"\s*:\s*"([^"]+)"/.exec(await readFile(mainPkg, "utf8"))?.[1] ?? "0.0.0";
      const d = await decideBump(from, bumpStat, bumpPatch);
      const applied = await applyBump(mainPkg, d.bump);
      decision = { ...d, ...applied };
    } catch (err) {
      const msg = authMessage(err);
      emit(job, { type: "log", text: `${msg}\n` });
      step("bump", "failed", msg);
      skipFrom("push");
      return stop(false);
    }
    emit(job, {
      type: "log",
      text: `Bump: ${decision.bump}  ${decision.from} → ${decision.to}  (${decision.reasoning})\n`,
    });
    const bumpCommit = await runGit(mainDir, ["commit", "-am", `chore: bump version to ${decision.to}`]);
    if (!bumpCommit.ok) {
      step("bump", "failed", bumpCommit.stderr || bumpCommit.stdout);
      skipFrom("push");
      return stop(false);
    }
    step("bump", "ok", `${decision.from} → ${decision.to}`);

    // 5) PUSH — from main
    if (!push) {
      step("push", "skipped");
      return stop(true);
    }
    return stop(await pushMain());
  } catch (err) {
    emit(job, { type: "error", message: (err as Error).message });
    finishJob(job, "error");
  }
}

const app = express();
app.use(express.json());

app.get("/api/repos", async (_req, res) => {
  try {
    const config = await loadConfig();
    const repos: Repo[] = await Promise.all(
      config.repos.map(async (entry) => ({ ...entry, status: await readStatus(entry) })),
    );
    // Guard against a stale selection pointing at a removed repo.
    const selectedId = repos.some((r) => r.id === config.selectedId) ? config.selectedId : null;
    const selectedWorktree = selectedId ? config.selectedWorktree : null;
    res.json({ repos, selectedId, selectedWorktree });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Browse the local filesystem so the UI can pick a repo directory.
app.get("/api/browse", async (req, res) => {
  try {
    const raw = typeof req.query.path === "string" && req.query.path ? req.query.path : os.homedir();
    const dir = path.resolve(raw);

    const dirents = await readdir(dir, { withFileTypes: true });
    const entries: BrowseEntry[] = await Promise.all(
      dirents
        .filter((d) => d.isDirectory() && !d.name.startsWith("."))
        .map(async (d) => {
          const full = path.join(dir, d.name);
          return { name: d.name, path: full, isGitRepo: await isGitRepo(full) };
        }),
    );
    entries.sort((a, b) => a.name.localeCompare(b.name));

    const parent = path.dirname(dir);
    const result: BrowseResult = {
      path: dir,
      parent: parent === dir ? null : parent,
      isGitRepo: await isGitRepo(dir),
      entries,
    };
    res.json(result);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    const status = code === "ENOENT" ? 404 : code === "EACCES" ? 403 : 500;
    res.status(status).json({ error: (err as Error).message });
  }
});

// Add a local repo directory to the monitored config.
app.post("/api/repos", async (req, res) => {
  try {
    const target = typeof req.body?.path === "string" ? path.resolve(req.body.path) : "";
    if (!target) {
      res.status(400).json({ error: "Body must include a 'path' string" });
      return;
    }
    if (!(await isGitRepo(target))) {
      res.status(400).json({ error: `${target} is not a git repository` });
      return;
    }

    const config = await loadConfig();
    if (config.repos.some((e) => e.path && path.resolve(e.path) === target)) {
      res.status(409).json({ error: "That repository is already being monitored" });
      return;
    }

    const name = path.basename(target);
    const entry: RepoConfigEntry = {
      id: uniqueId(name, new Set(config.repos.map((e) => e.id))),
      name,
      path: target,
    };
    // Adding a repo also makes it the selected one (on its main working tree).
    await saveConfig({
      repos: [...config.repos, entry],
      selectedId: entry.id,
      selectedWorktree: null,
    });

    const repo: Repo = { ...entry, status: await readStatus(entry) };
    res.status(201).json({ repo });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Detailed git status (changed files, ahead/behind) for one repo.
app.get("/api/repos/:id/status", async (req, res) => {
  try {
    const config = await loadConfig();
    const entry = config.repos.find((e) => e.id === req.params.id);
    if (!entry) {
      res.status(404).json({ error: `No monitored repo with id '${req.params.id}'` });
      return;
    }
    const dir = await resolveWorktreePath(entry, req.query.worktree);
    res.json(await readStatusDetail(entry, dir));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/** Parse a combined `git diff` into per-file DiffLine[] keyed by the b-side path. */
function parseUnifiedDiff(combined: string): Map<string, DiffLine[]> {
  const byFile = new Map<string, DiffLine[]>();
  let cur: DiffLine[] | null = null;
  let oldNum = 0;
  let newNum = 0;
  for (const raw of combined.split("\n")) {
    if (raw.startsWith("diff --git ")) {
      const m = /^diff --git a\/(.+) b\/(.+)$/.exec(raw);
      cur = [];
      byFile.set(m ? m[2] : raw.slice("diff --git ".length), cur);
      continue;
    }
    if (!cur) continue;
    if (raw.startsWith("@@")) {
      const m = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
      if (m) {
        oldNum = Number(m[1]);
        newNum = Number(m[2]);
      }
      continue;
    }
    if (
      raw.startsWith("--- ") ||
      raw.startsWith("+++ ") ||
      raw.startsWith("index ") ||
      raw.startsWith("new file mode") ||
      raw.startsWith("deleted file mode") ||
      raw.startsWith("old mode") ||
      raw.startsWith("new mode") ||
      raw.startsWith("similarity ") ||
      raw.startsWith("rename ") ||
      raw.startsWith("copy ") ||
      raw.startsWith("\\ ")
    ) {
      continue;
    }
    if (raw.startsWith("Binary files")) {
      cur.push({ type: "normal", text: "(binary file)" });
      continue;
    }
    if (cur.length > 3000) continue; // cap huge diffs
    const marker = raw[0];
    const text = raw.slice(1);
    if (marker === "+") {
      cur.push({ type: "added", text, newNum });
      newNum++;
    } else if (marker === "-") {
      cur.push({ type: "removed", text, oldNum });
      oldNum++;
    } else {
      cur.push({ type: "normal", text, oldNum, newNum });
      oldNum++;
      newNum++;
    }
  }
  return byFile;
}

/** Changed files with parsed diffs (tracked via `git diff HEAD`; untracked = whole-file adds). */
async function readDiffFiles(dir: string): Promise<DiffFile[]> {
  // `-b` puts a `## branch` line first so git()'s .trim() doesn't eat the first
  // file entry's leading status space; we then skip that header line.
  const statusText = (await git(dir, ["status", "--porcelain", "-b"])) ?? "";
  const combined = (await git(dir, ["diff", "HEAD"])) ?? "";
  const parsed = parseUnifiedDiff(combined);
  const files: DiffFile[] = [];
  for (const line of statusText.split("\n").filter((l) => l && !l.startsWith("## "))) {
    const x = line[0];
    const y = line[1];
    let p = line.slice(3);
    const arrow = p.indexOf(" -> ");
    if (arrow >= 0) p = p.slice(arrow + 4);
    const untracked = x === "?";
    const status: DiffFile["status"] =
      untracked || x === "A" ? "A" : x === "D" || y === "D" ? "D" : "M";
    let diff = parsed.get(p) ?? [];
    if (untracked && diff.length === 0) {
      try {
        const content = await readFile(path.join(dir, p), "utf8");
        diff = content
          .split("\n")
          .slice(0, 3000)
          .map((t, i) => ({ type: "added" as const, text: t, newNum: i + 1 }));
      } catch {
        diff = [{ type: "normal", text: "(unreadable / binary)" }];
      }
    }
    files.push({ path: p, name: path.basename(p), status, diff });
  }
  return files;
}

// Changed files with parsed unified diffs (for the Changes view). Honors ?worktree=.
app.get("/api/repos/:id/diff", async (req, res) => {
  try {
    const config = await loadConfig();
    const entry = config.repos.find((e) => e.id === req.params.id);
    if (!entry) {
      res.status(404).json({ error: `No monitored repo with id '${req.params.id}'` });
      return;
    }
    const dir = await resolveWorktreePath(entry, req.query.worktree);
    if (!dir) {
      res.json({ files: [] });
      return;
    }
    res.json({ files: await readDiffFiles(dir) });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Git worktrees attached to one repo (main + linked).
app.get("/api/repos/:id/worktrees", async (req, res) => {
  try {
    const config = await loadConfig();
    const entry = config.repos.find((e) => e.id === req.params.id);
    if (!entry) {
      res.status(404).json({ error: `No monitored repo with id '${req.params.id}'` });
      return;
    }
    res.json({ worktrees: await readWorktrees(entry) });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Full detail (metadata + per-file stats + parsed diff) for one commit. Honors ?worktree=.
app.get("/api/repos/:id/commit/:hash", async (req, res) => {
  try {
    const config = await loadConfig();
    const entry = config.repos.find((e) => e.id === req.params.id);
    if (!entry) {
      res.status(404).json({ error: `No monitored repo with id '${req.params.id}'` });
      return;
    }
    // Only hex hashes reach git — no arbitrary refs, no option injection.
    if (!/^[0-9a-fA-F]{4,64}$/.test(req.params.hash)) {
      res.status(400).json({ error: "Invalid commit hash" });
      return;
    }
    const dir = (await resolveWorktreePath(entry, req.query.worktree)) ?? entry.path;
    if (!dir) {
      res.status(404).json({ error: "Repo has no local path" });
      return;
    }
    const detail = await readCommitDetail(dir, req.params.hash);
    if (!detail) {
      res.status(404).json({ error: "No such commit" });
      return;
    }
    res.json(detail);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Create a new linked worktree. Body: { path, branch }. Attaches an existing branch
// or creates a new one (from HEAD) when it doesn't exist yet.
app.post("/api/repos/:id/worktrees", async (req, res) => {
  try {
    const config = await loadConfig();
    const entry = config.repos.find((e) => e.id === req.params.id);
    if (!entry) {
      res.status(404).json({ error: `No monitored repo with id '${req.params.id}'` });
      return;
    }
    if (!entry.path) {
      res.status(400).json({ error: "Repo has no local path" });
      return;
    }
    const rawPath: unknown = req.body?.path;
    const rawBranch: unknown = req.body?.branch;
    if (typeof rawPath !== "string" || rawPath.trim() === "") {
      res.status(400).json({ error: "Body must include a 'path' for the new worktree" });
      return;
    }
    if (
      typeof rawBranch !== "string" ||
      rawBranch.trim() === "" ||
      rawBranch.startsWith("-") ||
      !/^[\w./-]+$/.test(rawBranch.trim())
    ) {
      res.status(400).json({ error: "Body must include a valid 'branch' name" });
      return;
    }
    // path.resolve neutralizes any leading "-", so the path can't become a git option.
    const wtPath = path.resolve(rawPath.trim());
    const branch = rawBranch.trim();
    if (existsSync(wtPath)) {
      res.status(409).json({ error: `Path already exists: ${wtPath}` });
      return;
    }

    const branchExists = await gitExec(entry.path, [
      "rev-parse",
      "--verify",
      "--quiet",
      `refs/heads/${branch}`,
    ]);
    const args = branchExists.ok
      ? ["worktree", "add", wtPath, branch] // attach the existing branch
      : ["worktree", "add", "-b", branch, wtPath]; // create a new branch from HEAD
    const add = await gitExec(entry.path, args);
    if (!add.ok) {
      res.status(409).json({ error: add.stderr || add.stdout || "git worktree add failed" });
      return;
    }
    res.json({ ok: true, path: wtPath, branch });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Check out a ref (commit hash or branch) in the main tree (or ?worktree). Body: { ref, worktree? }.
// Refuses when the tree is dirty; a bare hash lands on a detached HEAD (reversible).
app.post("/api/repos/:id/checkout", async (req, res) => {
  try {
    const config = await loadConfig();
    const entry = config.repos.find((e) => e.id === req.params.id);
    if (!entry) {
      res.status(404).json({ error: `No monitored repo with id '${req.params.id}'` });
      return;
    }
    const ref: unknown = req.body?.ref;
    if (
      typeof ref !== "string" ||
      ref === "" ||
      ref.startsWith("-") ||
      !/^[\w./~^{}@-]+$/.test(ref)
    ) {
      res.status(400).json({ error: "Body must include a valid 'ref'" });
      return;
    }
    const dir = (await resolveWorktreePath(entry, req.body?.worktree)) ?? entry.path;
    if (!dir) {
      res.status(404).json({ error: "Repo has no local path" });
      return;
    }
    const verify = await gitExec(dir, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
    if (!verify.ok) {
      res.status(404).json({ error: `'${ref}' is not a commit in this repo` });
      return;
    }
    const dirty = await git(dir, ["status", "--porcelain"]);
    if (dirty && dirty.length > 0) {
      res.status(409).json({
        error: "The working tree has uncommitted changes. Commit or stash them first.",
      });
      return;
    }
    const co = await gitExec(dir, ["checkout", ref]);
    if (!co.ok) {
      res.status(409).json({ error: co.stderr || co.stdout || "git checkout failed" });
      return;
    }
    const head = (await git(dir, ["rev-parse", "--short", "HEAD"])) ?? "";
    const branch = await git(dir, ["symbolic-ref", "--quiet", "--short", "HEAD"]); // null if detached
    res.json({ ok: true, ref, detached: branch === null, head, branch });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Run a shell command in the repo/worktree dir (the Terminal drawer). Body: { command, worktree? }.
// SECURITY: this is arbitrary RCE — acceptable ONLY because the server is localhost-bound (see the
// security notes below) and shares the pipeline's posture. childEnv() strips the Anthropic keys so a
// command can't exfiltrate them; 20s timeout + 1MB output cap bound runaway/huge output.
app.post("/api/repos/:id/exec", async (req, res) => {
  try {
    const config = await loadConfig();
    const entry = config.repos.find((e) => e.id === req.params.id);
    if (!entry) {
      res.status(404).json({ error: `No monitored repo with id '${req.params.id}'` });
      return;
    }
    if (!entry.path) {
      res.status(400).json({ error: "Repository has no local path" });
      return;
    }
    const command: unknown = req.body?.command;
    if (typeof command !== "string" || command.trim() === "") {
      res.status(400).json({ error: "Body must include a non-empty 'command'" });
      return;
    }
    const dir = (await resolveWorktreePath(entry, req.body?.worktree)) ?? entry.path;
    const { code, output } = await runShell(dir, command);
    res.json({ command, cwd: dir, code, output });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Push the main working tree's branch to origin. Body: {} (operates on the main tree).
app.post("/api/repos/:id/push", async (req, res) => {
  try {
    const config = await loadConfig();
    const entry = config.repos.find((e) => e.id === req.params.id);
    if (!entry) {
      res.status(404).json({ error: `No monitored repo with id '${req.params.id}'` });
      return;
    }
    if (!entry.path) {
      res.status(400).json({ error: "Repository has no local path" });
      return;
    }

    const wts = await readWorktrees(entry);
    const main = wts.find((w) => w.isMain);
    if (!main?.path) {
      res.status(409).json({ error: "Could not locate the main working tree" });
      return;
    }
    if (!main.branch) {
      res.status(409).json({ error: "The main working tree is detached — nothing to push" });
      return;
    }

    const remotes = await git(main.path, ["remote"]);
    if (!remotes || !remotes.split("\n").includes("origin")) {
      res.status(409).json({ error: "No 'origin' remote is configured for this repo" });
      return;
    }

    const push = await gitExec(main.path, ["push", "origin", main.branch]);
    if (!push.ok) {
      res.status(409).json({
        error: `git push failed: ${push.stderr || push.stdout}`,
      });
      return;
    }

    // git writes push progress ("To github.com:…") to stderr even on success.
    res.json({
      ok: true,
      branch: main.branch,
      remote: "origin",
      detail: (push.stderr || push.stdout).trim(),
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Detected ways to run this repo's tests (docker script preferred).
app.get("/api/repos/:id/test-runners", async (req, res) => {
  try {
    const config = await loadConfig();
    const entry = config.repos.find((e) => e.id === req.params.id);
    if (!entry) {
      res.status(404).json({ error: `No monitored repo with id '${req.params.id}'` });
      return;
    }
    res.json({ runners: await detectTestRunners(entry) });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Start the release pipeline (tests → bump → commit → push) on the main working tree.
// Body: { command: string, push?: boolean }. The command is user-confirmed (arbitrary local exec).
app.post("/api/repos/:id/pipeline", async (req, res) => {
  try {
    const config = await loadConfig();
    const entry = config.repos.find((e) => e.id === req.params.id);
    if (!entry) {
      res.status(404).json({ error: `No monitored repo with id '${req.params.id}'` });
      return;
    }
    if (!entry.path) {
      res.status(400).json({ error: "Repository has no local path" });
      return;
    }
    const command = typeof req.body?.command === "string" ? req.body.command.trim() : "";
    if (!command) {
      res.status(400).json({ error: "Body must include a 'command' string" });
      return;
    }
    const push = req.body?.push !== false; // default true

    const job: Job = {
      id: crypto.randomUUID(),
      repoId: entry.id,
      status: "running",
      events: [],
      subscribers: new Set(),
      child: null,
      cancelled: false,
    };
    jobs.set(job.id, job);
    void runPipeline(job, entry, req.body?.worktree, command, push);
    res.status(201).json({ jobId: job.id });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// SSE stream of a pipeline job's events (replays buffered events, then streams live).
app.get("/api/repos/:id/pipeline/:jobId/stream", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: "No such pipeline job" });
    return;
  }
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  for (const ev of job.events) res.write(`data: ${JSON.stringify(ev)}\n\n`);
  if (job.status !== "running") {
    res.write("event: end\ndata: {}\n\n");
    res.end();
    return;
  }
  job.subscribers.add(res);
  req.on("close", () => job.subscribers.delete(res));
});

// Cancel a running pipeline job (kills the test process group).
app.post("/api/repos/:id/pipeline/:jobId/cancel", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: "No such pipeline job" });
    return;
  }
  job.cancelled = true;
  if (job.child?.pid) {
    try {
      process.kill(-job.child.pid, "SIGTERM");
    } catch {
      /* already gone */
    }
  }
  res.json({ ok: true });
});

// Merge a linked worktree's branch into the repo's main working tree.
// Body: { worktree: <path> }. Runs `git merge` in the main worktree.
app.post("/api/repos/:id/merge-worktree", async (req, res) => {
  try {
    const config = await loadConfig();
    const entry = config.repos.find((e) => e.id === req.params.id);
    if (!entry) {
      res.status(404).json({ error: `No monitored repo with id '${req.params.id}'` });
      return;
    }

    const requested: unknown = req.body?.worktree;
    if (typeof requested !== "string" || requested === "") {
      res.status(400).json({ error: "Body must include a 'worktree' path" });
      return;
    }

    const wts = await readWorktrees(entry);
    const target = path.resolve(requested);
    const source = wts.find((w) => path.resolve(w.path) === target);
    const main = wts.find((w) => w.isMain);

    if (!source) {
      res.status(404).json({ error: "That path is not a worktree of this repo" });
      return;
    }
    if (source.isMain) {
      res.status(400).json({ error: "That is the main working tree — nothing to merge" });
      return;
    }
    if (!source.branch) {
      res.status(400).json({ error: "The worktree is detached (no branch to merge)" });
      return;
    }
    if (!main?.path || !main.branch) {
      res.status(409).json({ error: "The main working tree has no branch checked out" });
      return;
    }
    if (source.branch === main.branch) {
      res.status(409).json({ error: `The worktree is already on '${main.branch}'` });
      return;
    }

    // Refuse if the main tree is dirty — a merge there would be unsafe.
    const dirty = await git(main.path, ["status", "--porcelain"]);
    if (dirty && dirty.length > 0) {
      res.status(409).json({
        error: `The main working tree ('${main.branch}') has uncommitted changes. Commit or stash them first.`,
      });
      return;
    }

    const merge = await gitExec(main.path, ["merge", "--no-edit", source.branch]);
    if (!merge.ok) {
      // Don't leave the main tree in a conflicted state.
      await gitExec(main.path, ["merge", "--abort"]);
      res.status(409).json({
        error: `Merge of '${source.branch}' into '${main.branch}' failed (likely conflicts) — the merge was aborted, main is unchanged.`,
        detail: merge.stdout || merge.stderr,
      });
      return;
    }

    res.json({
      ok: true,
      source: source.branch,
      target: main.branch,
      alreadyUpToDate: /already up to date/i.test(merge.stdout),
      message: merge.stdout,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Sync a linked worktree's branch WITH the repo's main branch — the inverse of
// merge-worktree. Body: { worktree: <path> }. Runs `git merge <mainBranch>`
// inside the worktree, so the dev branch picks up whatever landed on main.
app.post("/api/repos/:id/sync-worktree", async (req, res) => {
  try {
    const config = await loadConfig();
    const entry = config.repos.find((e) => e.id === req.params.id);
    if (!entry) {
      res.status(404).json({ error: `No monitored repo with id '${req.params.id}'` });
      return;
    }

    const requested: unknown = req.body?.worktree;
    if (typeof requested !== "string" || requested === "") {
      res.status(400).json({ error: "Body must include a 'worktree' path" });
      return;
    }

    const wts = await readWorktrees(entry);
    const target = path.resolve(requested);
    const source = wts.find((w) => path.resolve(w.path) === target);
    const main = wts.find((w) => w.isMain);

    if (!source) {
      res.status(404).json({ error: "That path is not a worktree of this repo" });
      return;
    }
    if (source.isMain) {
      res.status(400).json({ error: "That is the main working tree — nothing to sync into" });
      return;
    }
    if (!source.branch) {
      res.status(400).json({ error: "The worktree is detached (no branch to sync)" });
      return;
    }
    if (!main?.branch) {
      res.status(409).json({ error: "The main working tree has no branch checked out" });
      return;
    }
    if (source.branch === main.branch) {
      res.status(409).json({ error: `The worktree is already on '${main.branch}'` });
      return;
    }

    // Refuse if the worktree is dirty — a merge here would be unsafe.
    const dirty = await git(source.path, ["status", "--porcelain"]);
    if (dirty && dirty.length > 0) {
      res.status(409).json({
        error: `The worktree ('${source.branch}') has uncommitted changes. Commit or stash them first.`,
      });
      return;
    }

    // `main` is a local branch ref visible from any worktree in the shared repo,
    // so it can be merged into the worktree's branch without touching main's tree.
    const merge = await gitExec(source.path, ["merge", "--no-edit", main.branch]);
    if (!merge.ok) {
      // Don't leave the worktree in a conflicted state.
      await gitExec(source.path, ["merge", "--abort"]);
      res.status(409).json({
        error: `Sync of '${main.branch}' into '${source.branch}' failed (likely conflicts) — the merge was aborted, the worktree is unchanged.`,
        detail: merge.stdout || merge.stderr,
      });
      return;
    }

    res.json({
      ok: true,
      source: main.branch,
      target: source.branch,
      alreadyUpToDate: /already up to date/i.test(merge.stdout),
      message: merge.stdout,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Stage all changes and commit them with an AI-generated message (Anthropic SDK).
// Body: { worktree?: <path> }. Nothing is staged/committed if message generation fails.
app.post("/api/repos/:id/commit", async (req, res) => {
  try {
    const config = await loadConfig();
    const entry = config.repos.find((e) => e.id === req.params.id);
    if (!entry) {
      res.status(404).json({ error: `No monitored repo with id '${req.params.id}'` });
      return;
    }
    if (!entry.path) {
      res.status(400).json({ error: "Repository has no local path" });
      return;
    }
    const dir = (await resolveWorktreePath(entry, req.body?.worktree)) ?? entry.path;

    const statusText = await git(dir, ["status", "--porcelain"]);
    if (statusText === null) {
      res.status(400).json({ error: "Not a git repository" });
      return;
    }
    if (statusText.trim() === "") {
      res.status(409).json({ error: "Nothing to commit — the working tree is clean" });
      return;
    }

    // Use a caller-supplied message verbatim; otherwise ask Claude for one.
    // Generation reads the diff WITHOUT touching the index, so a failure leaves the tree untouched.
    const custom = typeof req.body?.message === "string" ? req.body.message.trim() : "";
    let message: string;
    try {
      message = custom || (await generateOrThrow(dir, statusText));
    } catch (err) {
      if (err instanceof CommitMsgError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      throw err;
    }

    // Only now do we mutate the repo.
    const staged = await gitExec(dir, ["add", "-A"]);
    if (!staged.ok) {
      res.status(500).json({ error: `git add failed: ${staged.stderr || staged.stdout}` });
      return;
    }
    const committed = await gitExec(dir, ["commit", "-m", message]);
    if (!committed.ok) {
      res.status(409).json({
        error: `git commit failed: ${committed.stderr || committed.stdout}`,
      });
      return;
    }

    const hash = (await git(dir, ["rev-parse", "--short", "HEAD"])) ?? "";
    res.json({ ok: true, hash, subject: message.split("\n")[0], message });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Preview an AI-generated commit message WITHOUT committing (for the Changes view's
// "generate" button). Body: { worktree? }. Never touches the index.
app.post("/api/repos/:id/commit/message", async (req, res) => {
  try {
    const config = await loadConfig();
    const entry = config.repos.find((e) => e.id === req.params.id);
    if (!entry) {
      res.status(404).json({ error: `No monitored repo with id '${req.params.id}'` });
      return;
    }
    if (!entry.path) {
      res.status(400).json({ error: "Repository has no local path" });
      return;
    }
    const dir = (await resolveWorktreePath(entry, req.body?.worktree)) ?? entry.path;
    const statusText = await git(dir, ["status", "--porcelain"]);
    if (statusText === null) {
      res.status(400).json({ error: "Not a git repository" });
      return;
    }
    if (statusText.trim() === "") {
      res.status(409).json({ error: "Nothing to describe — the working tree is clean" });
      return;
    }
    try {
      res.json({ message: await generateOrThrow(dir, statusText) });
    } catch (err) {
      if (err instanceof CommitMsgError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      throw err;
    }
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Recent commits for one repo. Optional ?limit= (default 30, capped at 200).
app.get("/api/repos/:id/log", async (req, res) => {
  try {
    const config = await loadConfig();
    const entry = config.repos.find((e) => e.id === req.params.id);
    if (!entry) {
      res.status(404).json({ error: `No monitored repo with id '${req.params.id}'` });
      return;
    }
    const requested = Number(req.query.limit);
    const limit = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), 200) : 30;
    const all = req.query.all === "1" || req.query.all === "true";
    const dir = await resolveWorktreePath(entry, req.query.worktree);
    res.json({ commits: await readLog(entry, limit, dir, all) });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Colored, columnar git-log format (graph on the left) — the self-contained "pretty" style.
const PRETTY_FORMAT =
  "%C(bold blue)%h%C(reset) %C(green)(%ar)%C(reset)%C(auto)%d%C(reset) %s %C(dim white)- %an%C(reset)";

// `git log --graph` output in three styles: plain, pretty (colored), forest (git-foresta).
// e.g. ?style=pretty&all=1&limit=200  or  ?style=plain&all=1&decorate=1&oneline=1&graph=1
app.get("/api/repos/:id/graph", async (req, res) => {
  try {
    const config = await loadConfig();
    const entry = config.repos.find((e) => e.id === req.params.id);
    if (!entry) {
      res.status(404).json({ error: `No monitored repo with id '${req.params.id}'` });
      return;
    }
    if (!entry.path) {
      res.json({ command: "", text: "", available: false, forestAvailable: false });
      return;
    }
    const dir = (await resolveWorktreePath(entry, req.query.worktree)) ?? entry.path;

    const on = (name: string) => req.query[name] === "1" || req.query[name] === "true";
    const style =
      req.query.style === "pretty" || req.query.style === "forest" ? req.query.style : "plain";
    const requested = Number(req.query.limit);
    const limit = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), 1000) : 200;

    let command = "";
    let text = "";
    let forestAvailable = true;

    if (style === "forest") {
      // Shell out to git-foresta / git-forest if the user has one installed.
      const bin = await findForestBin();
      forestAvailable = bin !== null;
      if (bin) {
        const args: string[] = [];
        if (on("all")) args.push("--all");
        args.push(`-${limit}`); // forwarded to git log as a commit-count limit
        command = `${bin} ${args.join(" ")}`;
        text = (await run(bin, args, dir)) ?? "";
      } else {
        command = "git-foresta / git-forest — not found on PATH";
      }
    } else if (style === "pretty") {
      // Fixed, colored format — no user strings reach git. --color=always so we can render it.
      const args = ["log", "--graph", "--color=always", `-n${limit}`];
      if (on("all")) args.push("--all");
      args.push(`--format=${PRETTY_FORMAT}`);
      command = `git log --graph --color=always${on("all") ? " --all" : ""} -n${limit} --format='${PRETTY_FORMAT}'`;
      text = (await git(dir, args)) ?? "";
    } else {
      // Plain — exactly the flags the user toggled (allowlisted, no user strings).
      const args = ["log"];
      if (on("all")) args.push("--all");
      if (on("decorate")) args.push("--decorate");
      if (on("oneline")) args.push("--oneline");
      if (on("graph")) args.push("--graph");
      args.push(`-n${limit}`);
      command = `git ${args.join(" ")}`;
      text = (await git(dir, args)) ?? "";
    }

    res.json({ command, text, available: true, forestAvailable });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Persist which repo is currently selected. Body: { id: string | null }.
app.put("/api/selection", async (req, res) => {
  try {
    const id: unknown = req.body?.id;
    if (id !== null && typeof id !== "string") {
      res.status(400).json({ error: "Body must include an 'id' string or null" });
      return;
    }

    const config = await loadConfig();
    if (id !== null && !config.repos.some((e) => e.id === id)) {
      res.status(404).json({ error: `No monitored repo with id '${id}'` });
      return;
    }

    // Switching repo resets the active worktree back to the main working tree.
    const selectedWorktree = id === config.selectedId ? config.selectedWorktree : null;
    await saveConfig({ ...config, selectedId: id, selectedWorktree });
    res.json({ selectedId: id, selectedWorktree });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Persist which worktree of the selected repo is active. Body: { path: string | null }.
// null selects the main working tree. A path must be a real worktree of the selected repo.
app.put("/api/selection/worktree", async (req, res) => {
  try {
    const target: unknown = req.body?.path;
    if (target !== null && typeof target !== "string") {
      res.status(400).json({ error: "Body must include a 'path' string or null" });
      return;
    }

    const config = await loadConfig();
    const entry = config.repos.find((e) => e.id === config.selectedId);
    if (!entry) {
      res.status(409).json({ error: "No repo is currently selected" });
      return;
    }

    let selectedWorktree: string | null = null;
    if (typeof target === "string" && target !== "") {
      const resolved = path.resolve(target);
      const wts = await readWorktrees(entry);
      const match = wts.find((w) => path.resolve(w.path) === resolved);
      if (!match) {
        res.status(404).json({ error: "That path is not a worktree of the selected repo" });
        return;
      }
      // Treat the main worktree as "no override" so it round-trips as null.
      selectedWorktree = match.isMain ? null : match.path;
    }

    await saveConfig({ ...config, selectedWorktree });
    res.json({ selectedWorktree });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get("/api/health", async (_req, res) => {
  try {
    const config = await loadConfig();
    res.json({
      node: process.version,
      platform: os.platform(),
      arch: os.arch(),
      uptimeSec: Math.floor(process.uptime()),
      host: HOST,
      apiPort: PORT,
      repoCount: config.repos.length,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.listen(PORT, HOST, () => {
  console.log(`[api] listening on http://${HOST}:${PORT}  (config: ${CONFIG_PATH})`);
});
