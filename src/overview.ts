// Pure filtering/sorting/summarising for the multi-repo Overview.
//
// Deliberately free of React and of the API client so the behaviour that makes
// ~105 repos navigable — "which did I leave dirty", "which have I not touched
// in a year" — can be unit-tested on plain data. Inputs in, values out.
import type {
  OverviewSort,
  OverviewSortKey,
  RepoOverviewRow,
  SortDirection,
} from './types';

/** Default ordering: stalest repo first — the overview exists to surface forgotten work. */
export const DEFAULT_SORT: OverviewSort = { key: 'age', direction: 'desc' };

/**
 * Each column's natural first click. Name/branch read best A→Z; the "something
 * needs attention" columns (age, dirty count, worktrees) read best biggest-first.
 */
export function defaultDirectionFor(key: OverviewSortKey): SortDirection {
  return key === 'name' || key === 'branch' ? 'asc' : 'desc';
}

/**
 * Toggle a sort: clicking the active column flips direction, clicking a new one
 * starts at that column's natural direction.
 */
export function nextSort(current: OverviewSort, key: OverviewSortKey): OverviewSort {
  if (current.key === key) {
    return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' };
  }
  return { key, direction: defaultDirectionFor(key) };
}

/**
 * Case-insensitive substring filter. Matches the repo name first and foremost,
 * but also its branch, path and description, so "the thing about invoices" or
 * "which repos are on a feature branch" both work. A blank query matches all.
 */
export function filterRepos(rows: RepoOverviewRow[], query: string): RepoOverviewRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) =>
    [r.name, r.branch, r.path, r.description].some((field) =>
      field.toLowerCase().includes(q),
    ),
  );
}

/**
 * Comparator value for a row under one sort key. `age` sorts on commit time, so
 * 'desc' means *stalest first* (oldest commit) — the useful default — rather
 * than the literal numeric descent.
 */
function compareBy(key: OverviewSortKey, a: RepoOverviewRow, b: RepoOverviewRow): number {
  switch (key) {
    case 'name':
      return a.name.localeCompare(b.name);
    case 'branch':
      return a.branch.localeCompare(b.branch);
    case 'dirty':
      return a.dirtyCount - b.dirtyCount;
    case 'worktrees':
      return a.worktreeCount - b.worktreeCount;
    case 'age':
      // Newer commit = "larger"; 'desc' then puts the oldest (stalest) first.
      return (b.lastCommitAt as number) - (a.lastCommitAt as number);
  }
}

/**
 * Sort a copy of `rows`. Repos with no known last commit (unavailable, or no
 * commits yet) always sink to the bottom when sorting by age, in *both*
 * directions — they have no age, so letting them lead either end is just noise.
 * Name is the tiebreaker everywhere, which keeps the order stable across renders.
 */
export function sortRepos(rows: RepoOverviewRow[], sort: OverviewSort): RepoOverviewRow[] {
  const sign = sort.direction === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (sort.key === 'age') {
      const aUnknown = a.lastCommitAt === null;
      const bUnknown = b.lastCommitAt === null;
      if (aUnknown || bUnknown) {
        if (aUnknown && bUnknown) return a.name.localeCompare(b.name);
        return aUnknown ? 1 : -1;
      }
    }
    const primary = compareBy(sort.key, a, b);
    if (primary !== 0) return primary * sign;
    return a.name.localeCompare(b.name);
  });
}

/** Filter then sort — what the Overview renders. */
export function visibleRepos(
  rows: RepoOverviewRow[],
  query: string,
  sort: OverviewSort,
): RepoOverviewRow[] {
  return sortRepos(filterRepos(rows, query), sort);
}

/** Headline counts for the Overview's summary strip. */
export interface FleetSummary {
  total: number;
  available: number;
  /** Repos with at least one uncommitted change. */
  dirtyRepos: number;
  /** Uncommitted files across the whole fleet. */
  dirtyFiles: number;
  /** Repos whose last commit is older than 90 days (unknown ages excluded). */
  stale: number;
  /** Linked worktrees across the fleet (i.e. excluding each repo's main tree). */
  linkedWorktrees: number;
}

const STALE_AFTER_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Summarise the fleet. `now` is injected so the stale count is testable. */
export function summarize(rows: RepoOverviewRow[], now: number = Date.now()): FleetSummary {
  return {
    total: rows.length,
    available: rows.filter((r) => r.available).length,
    dirtyRepos: rows.filter((r) => r.dirtyCount > 0).length,
    dirtyFiles: rows.reduce((sum, r) => sum + r.dirtyCount, 0),
    stale: rows.filter(
      (r) => r.lastCommitAt !== null && now - r.lastCommitAt > STALE_AFTER_DAYS * DAY_MS,
    ).length,
    linkedWorktrees: rows.reduce((sum, r) => sum + Math.max(0, r.worktreeCount - 1), 0),
  };
}

/**
 * Filter the sidebar's repository switcher. Separate from `filterRepos` because
 * the switcher holds the leaner `Repository` view-model, but the behaviour
 * matches: case-insensitive substring over name, branch and path. Without this
 * the switcher is an unsearchable flat list, which at ~105 repos is unusable.
 */
export function filterRepositories<T extends { name: string; activeBranch: string; path: string }>(
  repos: T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return repos;
  return repos.filter((r) =>
    [r.name, r.activeBranch, r.path].some((field) => field.toLowerCase().includes(q)),
  );
}
