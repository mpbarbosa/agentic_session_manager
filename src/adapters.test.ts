import { describe, it, expect } from "vitest";
import { avatarFor, toRepository, statusToFileChanges, logToCommits, worktreesToView } from "./adapters.ts";
import type { Repo, Commit, GitStatusDetail, Worktree } from "../shared/types.ts";

const repo = (over: Partial<Repo> = {}): Repo => ({
  id: "r1",
  name: "My Repo",
  path: "/home/u/My Repo",
  status: { branch: "main", dirtyCount: 0, lastCommit: null, worktrees: [], available: true },
  ...over,
});

const status = (files: GitStatusDetail["files"]): GitStatusDetail => ({
  id: "r1",
  name: "r",
  available: true,
  branch: "main",
  upstream: "origin/main",
  ahead: 0,
  behind: 0,
  files,
  clean: files.length === 0,
});

const worktree = (over: Partial<Worktree> = {}): Worktree => ({
  path: "/repo",
  head: "abcdef1234",
  branch: "main",
  isMain: true,
  isBare: false,
  detached: false,
  locked: false,
  lockedReason: null,
  prunable: false,
  ...over,
});

describe("avatarFor", () => {
  it("is a deterministic self-contained data URI", () => {
    const a = avatarFor("Ada Lovelace");
    expect(a).toBe(avatarFor("Ada Lovelace")); // deterministic
    expect(a.startsWith("data:image/svg+xml;utf8,")).toBe(true); // no network
    expect(decodeURIComponent(a)).toContain(">AL<"); // initials
  });

  it("uses '?' when there are no usable initials", () => {
    expect(decodeURIComponent(avatarFor(""))).toContain(">?<");
  });
});

describe("toRepository", () => {
  it("maps id/name/path and the active branch", () => {
    expect(toRepository(repo())).toEqual({
      id: "r1",
      name: "My Repo",
      activeBranch: "main",
      path: "/home/u/My Repo",
    });
  });

  it("falls back to '—' branch and '' path when absent", () => {
    const r = repo({ path: undefined, status: { branch: null, dirtyCount: 0, lastCommit: null, worktrees: [], available: false } });
    expect(toRepository(r)).toMatchObject({ activeBranch: "—", path: "" });
  });
});

describe("statusToFileChanges", () => {
  it("maps porcelain x/y columns to A/M/D and derives name", () => {
    const out = statusToFileChanges(
      status([
        { path: "new.ts", x: "?", y: "?" }, // untracked → added
        { path: "src/mod.ts", x: "M", y: " " }, // staged modify
        { path: "gone.ts", x: " ", y: "D" }, // unstaged delete
        { path: "added.ts", x: "A", y: " " },
      ]),
    );
    expect(out.map((f) => [f.name, f.status])).toEqual([
      ["new.ts", "A"],
      ["mod.ts", "M"],
      ["gone.ts", "D"],
      ["added.ts", "A"],
    ]);
  });
});

describe("logToCommits", () => {
  it("maps API commits to the view model", () => {
    const api: Commit[] = [
      {
        hash: "0123456789abcdef",
        shortHash: "0123456",
        subject: "feat: thing",
        author: "Grace Hopper",
        authorEmail: "grace@example.com",
        date: "2026-01-01T00:00:00Z",
        relativeDate: "2 days ago",
        body: "details",
      },
    ];
    const [c] = logToCommits(api);
    expect(c).toMatchObject({
      hash: "0123456",
      message: "feat: thing",
      body: "details",
      relativeTime: "2 days ago",
    });
    expect(c.author).toMatchObject({ name: "Grace Hopper", email: "grace@example.com" });
    expect(c.author.avatar.startsWith("data:image/svg+xml")).toBe(true);
  });

  it("derives a short hash when shortHash is empty", () => {
    const [c] = logToCommits([
      { hash: "abcdef1234567890", shortHash: "", subject: "x", author: "A", authorEmail: "", date: "", relativeDate: "", body: "" },
    ]);
    expect(c.hash).toBe("abcdef1");
  });
});

describe("worktreesToView", () => {
  it("labels main, active, and detached worktrees", () => {
    const wts = [
      worktree({ path: "/repo", branch: "main", isMain: true }),
      worktree({ path: "/repo/wt-feat", branch: "feat", isMain: false }),
      worktree({ path: "/repo/wt-det", branch: null, isMain: false, detached: true }),
    ];
    const out = worktreesToView(wts, null);
    expect(out.map((w) => [w.name, w.branch, w.status])).toEqual([
      ["repo", "main", "main"],
      ["wt-feat", "feat", "active"],
      ["wt-det", "detached", "detached"],
    ]);
    // selectedWorktree === null → the main worktree is active.
    expect(out.find((w) => w.status === "main")?.isActive).toBe(true);
  });

  it("marks the selected worktree active", () => {
    const wts = [worktree({ path: "/repo", isMain: true }), worktree({ path: "/repo/wt", branch: "feat", isMain: false })];
    const out = worktreesToView(wts, "/repo/wt");
    expect(out.find((w) => w.path === "/repo/wt")?.isActive).toBe(true);
    expect(out.find((w) => w.path === "/repo")?.isActive).toBe(false);
  });

  it("labels a bare worktree", () => {
    const [w] = worktreesToView([worktree({ branch: null, isBare: true })], null);
    expect(w.branch).toBe("bare");
  });
});
