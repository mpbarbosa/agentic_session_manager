import { describe, it, expect } from "vitest";
import {
  DEFAULT_SORT,
  defaultDirectionFor,
  filterRepos,
  filterRepositories,
  nextSort,
  sortRepos,
  summarize,
  visibleRepos,
} from "./overview.ts";
import type { RepoOverviewRow } from "./types";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-11-11T12:00:00Z");
const daysAgo = (n: number) => NOW - n * DAY;

const row = (over: Partial<RepoOverviewRow> = {}): RepoOverviewRow => ({
  id: "r",
  name: "repo",
  path: "/home/u/repo",
  description: "",
  branch: "main",
  dirtyCount: 0,
  lastCommitSubject: "a commit",
  lastCommitRelative: "1 day ago",
  lastCommitAt: daysAgo(1),
  worktreeCount: 1,
  available: true,
  ...over,
});

describe("filterRepos", () => {
  const rows = [
    row({ id: "a", name: "agora_na_copa", branch: "main", description: "World Cup site" }),
    row({ id: "b", name: "ibira.js", branch: "feat/parser", description: "A tiny parser" }),
    row({ id: "c", name: "sysupdate", path: "/opt/tools/sysupdate", description: "" }),
  ];

  it("matches on repo name, case-insensitively", () => {
    expect(filterRepos(rows, "IBIRA").map((r) => r.id)).toEqual(["b"]);
  });

  it("matches a substring anywhere in the name", () => {
    expect(filterRepos(rows, "copa").map((r) => r.id)).toEqual(["a"]);
  });

  it("also matches branch, path and description", () => {
    expect(filterRepos(rows, "feat/").map((r) => r.id)).toEqual(["b"]);
    expect(filterRepos(rows, "/opt/tools").map((r) => r.id)).toEqual(["c"]);
    expect(filterRepos(rows, "world cup").map((r) => r.id)).toEqual(["a"]);
  });

  it("returns everything for a blank or whitespace-only query", () => {
    expect(filterRepos(rows, "")).toHaveLength(3);
    expect(filterRepos(rows, "   ")).toHaveLength(3);
  });

  it("ignores surrounding whitespace in the query", () => {
    expect(filterRepos(rows, "  ibira  ").map((r) => r.id)).toEqual(["b"]);
  });

  it("returns nothing when nothing matches", () => {
    expect(filterRepos(rows, "zzz")).toEqual([]);
  });

  it("does not mutate the input array", () => {
    const input = [...rows];
    filterRepos(input, "ibira");
    expect(input).toEqual(rows);
  });
});

describe("sortRepos", () => {
  const rows = [
    row({ id: "fresh", name: "fresh", lastCommitAt: daysAgo(1), dirtyCount: 0, worktreeCount: 1 }),
    row({ id: "stale", name: "stale", lastCommitAt: daysAgo(400), dirtyCount: 2, worktreeCount: 3 }),
    row({ id: "mid", name: "mid", lastCommitAt: daysAgo(30), dirtyCount: 9, worktreeCount: 2 }),
  ];

  it("sorts stalest-first by default, which is the point of the view", () => {
    expect(sortRepos(rows, DEFAULT_SORT).map((r) => r.id)).toEqual(["stale", "mid", "fresh"]);
  });

  it("sorts freshest-first when age is ascending", () => {
    expect(sortRepos(rows, { key: "age", direction: "asc" }).map((r) => r.id)).toEqual([
      "fresh",
      "mid",
      "stale",
    ]);
  });

  it("sorts by dirty count, messiest first", () => {
    expect(sortRepos(rows, { key: "dirty", direction: "desc" }).map((r) => r.id)).toEqual([
      "mid",
      "stale",
      "fresh",
    ]);
  });

  it("sorts by dirty count ascending", () => {
    expect(sortRepos(rows, { key: "dirty", direction: "asc" }).map((r) => r.id)).toEqual([
      "fresh",
      "stale",
      "mid",
    ]);
  });

  it("sorts by worktree count", () => {
    expect(sortRepos(rows, { key: "worktrees", direction: "desc" }).map((r) => r.id)).toEqual([
      "stale",
      "mid",
      "fresh",
    ]);
  });

  it("sorts by name and by branch", () => {
    expect(sortRepos(rows, { key: "name", direction: "asc" }).map((r) => r.id)).toEqual([
      "fresh",
      "mid",
      "stale",
    ]);
    const branched = [
      row({ id: "x", name: "x", branch: "release" }),
      row({ id: "y", name: "y", branch: "develop" }),
    ];
    expect(sortRepos(branched, { key: "branch", direction: "asc" }).map((r) => r.id)).toEqual([
      "y",
      "x",
    ]);
  });

  it("breaks ties by name, so the order is stable across renders", () => {
    const tied = [
      row({ id: "c", name: "charlie", dirtyCount: 5 }),
      row({ id: "a", name: "alpha", dirtyCount: 5 }),
      row({ id: "b", name: "bravo", dirtyCount: 5 }),
    ];
    expect(sortRepos(tied, { key: "dirty", direction: "desc" }).map((r) => r.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("sinks repos with no known commit date to the bottom in BOTH age directions", () => {
    const withUnknown = [
      ...rows,
      row({ id: "broken", name: "broken", lastCommitAt: null, available: false }),
    ];
    expect(sortRepos(withUnknown, { key: "age", direction: "desc" }).at(-1)?.id).toBe("broken");
    expect(sortRepos(withUnknown, { key: "age", direction: "asc" }).at(-1)?.id).toBe("broken");
  });

  it("orders several unknown-age repos by name", () => {
    const unknowns = [
      row({ id: "z", name: "zeta", lastCommitAt: null }),
      row({ id: "a", name: "alpha", lastCommitAt: null }),
    ];
    expect(sortRepos(unknowns, { key: "age", direction: "desc" }).map((r) => r.id)).toEqual([
      "a",
      "z",
    ]);
  });

  it("does not mutate the input array", () => {
    const input = [...rows];
    sortRepos(input, { key: "name", direction: "asc" });
    expect(input.map((r) => r.id)).toEqual(["fresh", "stale", "mid"]);
  });
});

describe("nextSort", () => {
  it("flips direction when the active column is clicked again", () => {
    expect(nextSort({ key: "age", direction: "desc" }, "age")).toEqual({
      key: "age",
      direction: "asc",
    });
    expect(nextSort({ key: "age", direction: "asc" }, "age")).toEqual({
      key: "age",
      direction: "desc",
    });
  });

  it("starts a new column at its natural direction", () => {
    expect(nextSort({ key: "age", direction: "asc" }, "name")).toEqual({
      key: "name",
      direction: "asc",
    });
    expect(nextSort({ key: "name", direction: "asc" }, "dirty")).toEqual({
      key: "dirty",
      direction: "desc",
    });
  });

  it("reads text columns A-Z and attention columns biggest-first", () => {
    expect(defaultDirectionFor("name")).toBe("asc");
    expect(defaultDirectionFor("branch")).toBe("asc");
    expect(defaultDirectionFor("dirty")).toBe("desc");
    expect(defaultDirectionFor("age")).toBe("desc");
    expect(defaultDirectionFor("worktrees")).toBe("desc");
  });
});

describe("visibleRepos", () => {
  it("filters first, then sorts what survived", () => {
    const rows = [
      row({ id: "a", name: "api-old", lastCommitAt: daysAgo(300) }),
      row({ id: "b", name: "api-new", lastCommitAt: daysAgo(2) }),
      row({ id: "c", name: "web", lastCommitAt: daysAgo(999) }),
    ];
    expect(visibleRepos(rows, "api", DEFAULT_SORT).map((r) => r.id)).toEqual(["a", "b"]);
  });
});

describe("summarize", () => {
  it("counts dirty repos, dirty files, stale repos and linked worktrees", () => {
    const rows = [
      row({ dirtyCount: 3, worktreeCount: 2, lastCommitAt: daysAgo(10) }),
      row({ dirtyCount: 1, worktreeCount: 1, lastCommitAt: daysAgo(200) }),
      row({ dirtyCount: 0, worktreeCount: 4, lastCommitAt: daysAgo(91) }),
      row({ dirtyCount: 0, worktreeCount: 1, lastCommitAt: null, available: false }),
    ];
    expect(summarize(rows, NOW)).toEqual({
      total: 4,
      available: 3,
      dirtyRepos: 2,
      dirtyFiles: 4,
      stale: 2,
      linkedWorktrees: 4,
    });
  });

  it("excludes unknown-age repos from the stale count rather than calling them infinitely old", () => {
    expect(summarize([row({ lastCommitAt: null })], NOW).stale).toBe(0);
  });

  it("treats exactly 90 days as not yet stale", () => {
    expect(summarize([row({ lastCommitAt: daysAgo(90) })], NOW).stale).toBe(0);
    expect(summarize([row({ lastCommitAt: daysAgo(91) })], NOW).stale).toBe(1);
  });

  it("handles an empty fleet", () => {
    expect(summarize([], NOW)).toEqual({
      total: 0,
      available: 0,
      dirtyRepos: 0,
      dirtyFiles: 0,
      stale: 0,
      linkedWorktrees: 0,
    });
  });
});

describe("filterRepositories (sidebar switcher)", () => {
  const repos = [
    { id: "a", name: "agora_na_copa", activeBranch: "main", path: "/home/u/agora_na_copa" },
    { id: "b", name: "ibira.js", activeBranch: "feat/parser", path: "/home/u/ibira.js" },
  ];

  it("matches name, branch and path, case-insensitively", () => {
    expect(filterRepositories(repos, "IBIRA").map((r) => r.id)).toEqual(["b"]);
    expect(filterRepositories(repos, "feat").map((r) => r.id)).toEqual(["b"]);
    expect(filterRepositories(repos, "/home/u/agora").map((r) => r.id)).toEqual(["a"]);
  });

  it("returns everything for a blank query and nothing for a miss", () => {
    expect(filterRepositories(repos, "  ")).toHaveLength(2);
    expect(filterRepositories(repos, "nope")).toEqual([]);
  });
});
