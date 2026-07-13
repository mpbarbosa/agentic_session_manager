/** A repository the manager can monitor. Sourced from repos.config.json. */
export interface RepoConfigEntry {
  id: string;
  name: string;
  /** Absolute path to the repo on the local machine (optional for remote-only repos). */
  path?: string;
  description?: string;
  url?: string;
}

/** On-disk shape of repos.config.json. */
export interface RepoConfigFile {
  repos: RepoConfigEntry[];
  /** id of the currently-selected repo, or null when none is selected. */
  selectedId?: string | null;
  /** Path of the active worktree within the selected repo; null = the main working tree. */
  selectedWorktree?: string | null;
}

/** Live git status enrichment computed by the API for a configured repo. */
export interface RepoStatus {
  /** Current branch, or null if the path is missing / not a git repo. */
  branch: string | null;
  /** Number of files with uncommitted changes. */
  dirtyCount: number;
  /** Short hash + subject of the most recent commit, if available. */
  lastCommit: string | null;
  /** Names of git worktrees attached to this repo. */
  worktrees: string[];
  /** True when the configured path exists and is a git repository. */
  available: boolean;
}

/** A configured repo joined with its live status, as returned by GET /api/repos. */
export interface Repo extends RepoConfigEntry {
  status: RepoStatus;
}

/** Response body of GET /api/repos: the repo list plus the persisted selection. */
export interface ReposResponse {
  repos: Repo[];
  selectedId: string | null;
  /** Active worktree path within the selected repo; null = the main working tree. */
  selectedWorktree: string | null;
}

/** One changed path in `git status --porcelain`, with its two status columns. */
export interface FileChange {
  path: string;
  /** Index (staged) status column, e.g. "M", "A", "D", " ". */
  x: string;
  /** Worktree (unstaged) status column, e.g. "M", "D", "?", " ". */
  y: string;
}

/** A git worktree attached to a repo (GET /api/repos/:id/worktrees). */
export interface Worktree {
  path: string;
  /** Checked-out commit SHA, or null (e.g. a bare repo). */
  head: string | null;
  /** Short branch name, or null when detached/bare. */
  branch: string | null;
  /** True for the primary working tree (the first entry git reports). */
  isMain: boolean;
  isBare: boolean;
  detached: boolean;
  locked: boolean;
  lockedReason: string | null;
  prunable: boolean;
}

/** One commit from `git log` (GET /api/repos/:id/log). */
export interface Commit {
  hash: string;
  shortHash: string;
  subject: string;
  author: string;
  /** Author date, ISO 8601. */
  date: string;
  /** Author date, humanized (e.g. "3 days ago"). */
  relativeDate: string;
}

/** Detailed git status for one repo (GET /api/repos/:id/status). */
export interface GitStatusDetail {
  id: string;
  name: string;
  /** True when the path exists and is a git repository. */
  available: boolean;
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  files: FileChange[];
  /** True when there are no changes (working tree clean). */
  clean: boolean;
}

/** A directory entry returned by the filesystem browser (GET /api/browse). */
export interface BrowseEntry {
  name: string;
  path: string;
  isGitRepo: boolean;
}

/** Result of browsing a single directory on the local machine. */
export interface BrowseResult {
  /** Absolute path of the directory being listed. */
  path: string;
  /** Parent directory, or null when at the filesystem root. */
  parent: string | null;
  /** True when `path` itself is the root of a git repository. */
  isGitRepo: boolean;
  /** Immediate subdirectories, sorted by name. */
  entries: BrowseEntry[];
}

/** A detected way to run a repo's test suite (GET /api/repos/:id/test-runners). */
export interface TestRunner {
  id: string;
  /** How it was detected: a docker test script, an npm script, or another ecosystem. */
  kind: "docker-script" | "npm" | "other";
  /** Human label, e.g. "Docker: scripts/docker-test.sh". */
  label: string;
  /** The command to run (shown to the user, editable before running). */
  command: string;
  /** Higher = stronger signal; the list is returned sorted by this descending. */
  confidence: number;
}

/** The semver bump Claude chose for a set of changes. */
export interface BumpDecision {
  bump: "major" | "minor" | "patch";
  from: string;
  to: string;
  reasoning: string;
}

/** A step of the release pipeline (in order). */
export type PipelineStep = "tests" | "commit" | "merge" | "bump" | "push";
export type StepStatus = "pending" | "running" | "ok" | "failed" | "skipped";

/** An event streamed from the pipeline SSE endpoint. */
export type PipelineEvent =
  | { type: "step"; step: PipelineStep; status: StepStatus; detail?: string }
  | { type: "log"; text: string }
  | { type: "done"; ok: boolean }
  | { type: "error"; message: string };
