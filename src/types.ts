export interface Repository {
  id: string;
  name: string;
  activeBranch: string;
  path: string;
}

export interface DiffLine {
  type: 'added' | 'removed' | 'normal';
  text: string;
  oldNum?: number;
  newNum?: number;
}

export interface FileChange {
  path: string;
  name: string;
  status: 'A' | 'M' | 'D'; // Added, Modified, Deleted
  diff: DiffLine[];
}

export interface CommitChange {
  path: string;
  type: 'add' | 'edit' | 'del';
  additions: number;
  deletions: number;
}

export interface Commit {
  hash: string;
  author: {
    name: string;
    email: string;
    avatar: string;
  };
  date: string;
  message: string;
  /** Commit body (may be empty). */
  body: string;
  branches: string[];
  tags: string[];
  changes: CommitChange[];
  relativeTime: string;
}

export interface Worktree {
  id: string;
  name: string;
  branch: string;
  hash: string;
  path: string;
  status: 'main' | 'active' | 'agora-dev' | 'agora-dev2' | 'agent' | 'detached';
  isActive: boolean;
}

/**
 * One row of the multi-repo Overview — a configured repo joined with the live
 * git status that `GET /api/repos` already returns. Built by `toOverviewRow`.
 */
export interface RepoOverviewRow {
  id: string;
  name: string;
  path: string;
  description: string;
  /** Current branch, or '—' when the repo is unavailable. */
  branch: string;
  dirtyCount: number;
  /** Subject of the last commit, or '' when the repo has no commits. */
  lastCommitSubject: string;
  /** Humanized last-commit age (e.g. '3 days ago'), or '' when unknown. */
  lastCommitRelative: string;
  /** Last-commit time in epoch ms; null when unknown (no commits / unavailable). */
  lastCommitAt: number | null;
  /** Worktrees attached to the repo, including the main working tree (so >= 1). */
  worktreeCount: number;
  /** False when the configured path is missing or is not a git repository. */
  available: boolean;
}

/** Sortable Overview columns. */
export type OverviewSortKey = 'name' | 'branch' | 'dirty' | 'age' | 'worktrees';
export type SortDirection = 'asc' | 'desc';

export interface OverviewSort {
  key: OverviewSortKey;
  direction: SortDirection;
}
