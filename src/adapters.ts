// Maps our API types (../shared/types.ts) → the transplanted prototype's view-model types (./types).
import type {
  Repo as ApiRepo,
  GitStatusDetail,
  Commit as ApiCommit,
  Worktree as ApiWorktree,
} from "../shared/types.ts";
import type { Repository, FileChange, Commit, Worktree } from "./types";

const basename = (p: string) => p.split("/").filter(Boolean).pop() ?? p;

/** Deterministic inline-SVG avatar (initials + hue from the name) — no network, no deps. */
export function avatarFor(name: string): string {
  const initials =
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("") || "?";
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) & 0xffff;
  const hue = hash % 360;
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64'>` +
    `<rect width='64' height='64' rx='32' fill='hsl(${hue} 45% 30%)'/>` +
    `<text x='32' y='41' font-family='sans-serif' font-size='26' font-weight='600' ` +
    `fill='hsl(${hue} 60% 82%)' text-anchor='middle'>${initials}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function toRepository(r: ApiRepo): Repository {
  return { id: r.id, name: r.name, activeBranch: r.status?.branch ?? "—", path: r.path ?? "" };
}

function mapStatus(x: string, y: string): FileChange["status"] {
  if (x === "?" || y === "?") return "A"; // untracked shown as added
  const primary = x !== " " ? x : y;
  if (primary === "A") return "A";
  if (primary === "D") return "D";
  return "M";
}

export function statusToFileChanges(s: GitStatusDetail): FileChange[] {
  return s.files.map((f) => ({
    path: f.path,
    name: basename(f.path),
    status: mapStatus(f.x, f.y),
    diff: [], // populated lazily via GET /diff (Phase 2)
  }));
}

export function logToCommits(commits: ApiCommit[]): Commit[] {
  return commits.map((c) => ({
    hash: c.shortHash || c.hash.slice(0, 7),
    author: { name: c.author, email: c.authorEmail ?? "", avatar: avatarFor(c.author) },
    date: c.date,
    message: c.subject,
    body: c.body ?? "",
    branches: [],
    tags: [],
    changes: [],
    relativeTime: c.relativeDate,
  }));
}

export function worktreesToView(wts: ApiWorktree[], selectedWorktree: string | null): Worktree[] {
  return wts.map((w) => ({
    id: w.path,
    name: basename(w.path),
    branch: w.branch ?? (w.isBare ? "bare" : "detached"),
    hash: w.head ? w.head.slice(0, 7) : "",
    path: w.path,
    status: w.isMain ? "main" : w.detached ? "detached" : "active",
    isActive: selectedWorktree === null ? w.isMain : selectedWorktree === w.path,
  }));
}
