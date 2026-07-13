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
