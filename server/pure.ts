// Pure, side-effect-free helpers used by server/index.ts.
//
// Kept in their own module so they can be unit-tested without importing
// server/index.ts (which starts the HTTP server on import). No fs, no git, no
// network — inputs in, values out.
import Anthropic from "@anthropic-ai/sdk";
import type { Worktree, GitStatusDetail, BumpDecision, TestRunner } from "../shared/types.ts";

/** Slugify `base` into a stable id unique within `taken` (appends -2, -3, …). */
export function uniqueId(base: string, taken: Set<string>): string {
  const slug = base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "repo";
  if (!taken.has(slug)) return slug;
  let i = 2;
  while (taken.has(`${slug}-${i}`)) i++;
  return `${slug}-${i}`;
}

/** Parse a `git status -b --porcelain` branch header line. */
export function parseBranchLine(
  line: string,
): Pick<GitStatusDetail, "branch" | "upstream" | "ahead" | "behind"> {
  let rest = line.replace(/^## /, "");
  let ahead = 0;
  let behind = 0;

  const track = /\[(.+)\]$/.exec(rest);
  if (track) {
    ahead = Number(/ahead (\d+)/.exec(track[1])?.[1] ?? 0);
    behind = Number(/behind (\d+)/.exec(track[1])?.[1] ?? 0);
    rest = rest.slice(0, track.index).trim();
  }

  const dots = rest.indexOf("...");
  if (dots >= 0) {
    return { branch: rest.slice(0, dots), upstream: rest.slice(dots + 3), ahead, behind };
  }
  // "No commits yet on main" — surface the real branch name.
  const noCommits = /^No commits yet on (.+)$/.exec(rest);
  return { branch: noCommits ? noCommits[1] : rest, upstream: null, ahead, behind };
}

/** Parse `git worktree list --porcelain` into structured entries (first = main). */
export function parseWorktrees(porcelain: string): Worktree[] {
  return porcelain
    .split(/\n\n+/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block, idx) => {
      const wt: Worktree = {
        path: "",
        head: null,
        branch: null,
        isMain: idx === 0,
        isBare: false,
        detached: false,
        locked: false,
        lockedReason: null,
        prunable: false,
      };
      for (const line of block.split("\n")) {
        if (line.startsWith("worktree ")) wt.path = line.slice("worktree ".length);
        else if (line.startsWith("HEAD ")) wt.head = line.slice("HEAD ".length);
        else if (line.startsWith("branch "))
          wt.branch = line.slice("branch ".length).replace(/^refs\/heads\//, "");
        else if (line === "bare") wt.isBare = true;
        else if (line === "detached") wt.detached = true;
        else if (line === "locked" || line.startsWith("locked ")) {
          wt.locked = true;
          wt.lockedReason = line.length > "locked ".length ? line.slice("locked ".length) : null;
        } else if (line === "prunable" || line.startsWith("prunable ")) wt.prunable = true;
      }
      return wt;
    });
}

/** Increment the core semver of `v` per `bump` (prerelease/build suffixes are dropped). */
export function nextVersion(v: string, bump: BumpDecision["bump"]): string {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v);
  if (!m) throw new Error(`Cannot parse version "${v}"`);
  let [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (bump === "major") (major += 1), (minor = 0), (patch = 0);
  else if (bump === "minor") (minor += 1), (patch = 0);
  else patch += 1;
  return `${major}.${minor}.${patch}`;
}

/**
 * Bump the `version` field in raw package.json text with a targeted replace
 * (preserves formatting). Pure counterpart of applyBump — throws if no version.
 */
export function bumpVersionInPackageJson(
  raw: string,
  bump: BumpDecision["bump"],
): { from: string; to: string; text: string } {
  const m = /"version"\s*:\s*"([^"]+)"/.exec(raw);
  if (!m) throw new Error('package.json has no "version" field');
  const from = m[1];
  const to = nextVersion(from, bump);
  return { from, to, text: raw.replace(/("version"\s*:\s*")[^"]+(")/, `$1${to}$2`) };
}

/** Friendly message for Anthropic auth failures (same wording as the commit endpoint). */
export function authMessage(err: unknown): string {
  const raw = (err as Error).message ?? "";
  if (
    err instanceof Anthropic.AuthenticationError ||
    (err as { status?: number }).status === 401 ||
    /authentication method|api[ _]?key|ANTHROPIC_API_KEY|credential/i.test(raw)
  ) {
    return "No Anthropic credentials found. Set ANTHROPIC_API_KEY (or run `ant auth login`) for the API server.";
  }
  return raw;
}

/** Filesystem facts detectTestRunners gathers, split out so scoring is testable. */
export interface RunnerDetectionInput {
  /** Docker test shell scripts that exist, in preference order. */
  dockerScriptFiles: string[];
  /** package.json `scripts` map. */
  scripts: Record<string, string>;
  /** Ecosystem marker files that exist (go.mod, Cargo.toml, pytest.ini, pyproject.toml). */
  ecoFiles: string[];
  /** Whether the Makefile has a `test:` target. */
  makefileHasTest: boolean;
}

/** Score/rank candidate test runners from gathered repo facts (highest confidence first). */
export function selectTestRunners(input: RunnerDetectionInput): TestRunner[] {
  const runners: TestRunner[] = [];
  const add = (r: Omit<TestRunner, "id">) => runners.push({ id: `r${runners.length}`, ...r });

  // 1. Docker test shell scripts.
  for (const rel of input.dockerScriptFiles) {
    add({ kind: "docker-script", label: `Docker: ${rel}`, command: `bash ${rel}`, confidence: 100 });
  }

  // 2. package.json script that shells into docker for tests.
  for (const [name, body] of Object.entries(input.scripts)) {
    if (/docker/i.test(body) && /test/i.test(`${name} ${body}`)) {
      add({ kind: "docker-script", label: `Docker (npm): ${name}`, command: `npm run ${name}`, confidence: 90 });
    }
  }

  // 3. Plain npm test scripts.
  const npmConf: Record<string, number> = { "test:ci": 65, test: 60, "test:unit": 55, "test:e2e": 50 };
  for (const [name, confidence] of Object.entries(npmConf)) {
    if (input.scripts[name]) add({ kind: "npm", label: `npm: ${name}`, command: `npm run ${name}`, confidence });
  }

  // 4. Other ecosystems (presence-based, canonical order preserved).
  const eco: { file: string; label: string; command: string }[] = [
    { file: "go.mod", label: "Go: go test ./...", command: "go test ./..." },
    { file: "Cargo.toml", label: "Rust: cargo test", command: "cargo test" },
    { file: "pytest.ini", label: "Python: pytest", command: "pytest" },
    { file: "pyproject.toml", label: "Python: pytest", command: "pytest" },
  ];
  for (const e of eco) {
    if (input.ecoFiles.includes(e.file)) {
      add({ kind: "other", label: e.label, command: e.command, confidence: 40 });
    }
  }
  if (input.makefileHasTest) {
    add({ kind: "other", label: "Make: make test", command: "make test", confidence: 45 });
  }

  return runners.sort((a, b) => b.confidence - a.confidence);
}

/**
 * The repository's canonical default branch name, given the `origin/HEAD` symbolic
 * ref value (e.g. "origin/main") and the set of local branch names. Pure decision
 * behind resolveDefaultBranch; falls back to `fallback` when nothing matches.
 */
export function pickDefaultBranch(
  originHead: string | null,
  localBranches: Set<string>,
  fallback: string,
): string {
  if (originHead) {
    const name = originHead.replace(/^origin\//, "").trim();
    if (name) return name;
  }
  for (const candidate of ["main", "master"]) {
    if (localBranches.has(candidate)) return candidate;
  }
  return fallback;
}
