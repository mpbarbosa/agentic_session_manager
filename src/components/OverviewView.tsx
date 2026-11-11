import { useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  FolderDot,
  GitBranch,
  RefreshCw,
  Search,
  FileCode,
  Layers,
  AlertTriangle,
  Plus,
} from 'lucide-react';
import type { OverviewSortKey, RepoOverviewRow } from '../types';
import { DEFAULT_SORT, nextSort, summarize, visibleRepos } from '../overview';

interface OverviewViewProps {
  repos: RepoOverviewRow[];
  activeRepoId: string;
  onSelectRepo: (id: string) => void;
  onRefresh: () => void;
  onAddRepo: () => void;
  loading: boolean;
}

// Widths mirror the row cells below, so headers stay over their own column.
const COLUMNS: { key: OverviewSortKey; label: string; className: string }[] = [
  { key: 'name', label: 'Repository', className: 'w-[26%] pr-3' },
  { key: 'branch', label: 'Branch', className: 'w-[16%] pr-3' },
  { key: 'dirty', label: 'Dirty', className: 'w-[8%] pr-3 text-right' },
  { key: 'age', label: 'Last commit', className: 'w-[38%] pr-3' },
  { key: 'worktrees', label: 'Trees', className: 'w-[8%] text-right' },
];

/**
 * The fleet dashboard: every configured repo in one sortable, filterable table.
 * Purely presentational — rows arrive already mapped from `GET /api/repos`, and
 * picking one hands the id back up to App, which drops into the per-repo views.
 */
export default function OverviewView({
  repos,
  activeRepoId,
  onSelectRepo,
  onRefresh,
  onAddRepo,
  loading,
}: OverviewViewProps) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState(DEFAULT_SORT);

  const rows = useMemo(() => visibleRepos(repos, query, sort), [repos, query, sort]);
  const summary = useMemo(() => summarize(repos), [repos]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Toolbar: filter + fleet summary */}
      <div className="px-6 pt-5 pb-4 border-b border-outline-variant bg-surface-container-lowest shrink-0">
        <div className="flex items-center justify-between gap-4 mb-4">
          <div>
            <h1 className="text-lg font-semibold text-on-surface">Overview</h1>
            <p className="text-xs text-on-surface-variant mt-0.5 font-mono">
              {summary.total} repositories monitored
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onAddRepo}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-outline-variant text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-all font-mono text-xs"
            >
              <Plus className="w-3.5 h-3.5" />
              Add repo
            </button>
            <button
              onClick={onRefresh}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-secondary text-on-secondary-fixed font-semibold hover:opacity-95 transition-all text-xs disabled:opacity-75"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              {loading ? 'Scanning…' : 'Rescan'}
            </button>
          </div>
        </div>

        <div className="flex items-center gap-4 flex-wrap">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="w-4 h-4 text-outline absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by name, branch, path or purpose…"
              aria-label="Filter repositories"
              className="w-full bg-surface-container-high border border-outline-variant rounded-lg pl-9 pr-3 py-2 font-mono text-xs text-on-surface placeholder:text-outline focus:outline-none focus:border-primary transition-colors"
            />
          </div>

          <div className="flex items-center gap-4 font-mono text-[11px] text-on-surface-variant">
            <span className="flex items-center gap-1.5" title="Repos with uncommitted changes">
              <FileCode className="w-3.5 h-3.5 text-error" />
              {summary.dirtyRepos} dirty
              <span className="text-outline">({summary.dirtyFiles} files)</span>
            </span>
            <span className="flex items-center gap-1.5" title="No commit in the last 90 days">
              <AlertTriangle className="w-3.5 h-3.5 text-tertiary" />
              {summary.stale} stale
            </span>
            <span className="flex items-center gap-1.5" title="Linked worktrees across the fleet">
              <Layers className="w-3.5 h-3.5 text-secondary" />
              {summary.linkedWorktrees} worktrees
            </span>
            {summary.available < summary.total && (
              <span className="flex items-center gap-1.5 text-error" title="Configured path missing or not a git repo">
                {summary.total - summary.available} unavailable
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Column headers */}
      <div className="flex items-center px-6 py-2 border-b border-outline-variant bg-surface-container-low text-[10px] uppercase font-semibold text-outline font-mono shrink-0">
        {COLUMNS.map((col) => {
          const active = sort.key === col.key;
          return (
            <button
              key={col.key}
              onClick={() => setSort(nextSort(sort, col.key))}
              aria-label={`Sort by ${col.label}`}
              className={`${col.className} shrink-0 flex items-center gap-1 hover:text-on-surface transition-colors ${
                col.className.includes('text-right') ? 'justify-end' : ''
              } ${active ? 'text-primary' : ''}`}
            >
              <span>{col.label}</span>
              {active &&
                (sort.direction === 'asc' ? (
                  <ArrowUp className="w-3 h-3" />
                ) : (
                  <ArrowDown className="w-3 h-3" />
                ))}
            </button>
          );
        })}
      </div>

      {/* Rows */}
      <div className="flex-1 overflow-y-auto">
        {rows.length === 0 && (
          <div className="px-6 py-16 text-center font-mono text-xs text-on-surface-variant">
            {repos.length === 0
              ? loading
                ? 'Reading repositories…'
                : 'No repositories configured yet.'
              : `No repository matches “${query}”.`}
          </div>
        )}

        {rows.map((repo) => (
          <button
            key={repo.id}
            onClick={() => onSelectRepo(repo.id)}
            className={`w-full flex items-center px-6 py-2.5 border-b border-outline-variant/50 text-left font-mono text-xs transition-colors ${
              repo.id === activeRepoId
                ? 'bg-surface-container-high'
                : 'hover:bg-surface-container-low'
            } ${repo.available ? '' : 'opacity-60'}`}
          >
            {/* Name */}
            <div className="w-[26%] shrink-0 flex items-center gap-2 pr-3 min-w-0">
              <FolderDot
                className={`w-3.5 h-3.5 shrink-0 ${
                  repo.id === activeRepoId ? 'text-primary' : 'text-outline'
                }`}
              />
              <div className="min-w-0">
                <div
                  className={`truncate ${
                    repo.id === activeRepoId ? 'text-primary font-semibold' : 'text-on-surface'
                  }`}
                >
                  {repo.name}
                </div>
                {repo.description && (
                  <div className="truncate text-[10px] text-outline">{repo.description}</div>
                )}
              </div>
            </div>

            {/* Branch */}
            <div className="w-[16%] shrink-0 pr-3 min-w-0 flex items-center gap-1.5 text-on-surface-variant">
              {repo.available ? (
                <>
                  <GitBranch className="w-3 h-3 shrink-0 text-secondary" />
                  <span className="truncate">{repo.branch}</span>
                </>
              ) : (
                <span className="text-error truncate">unavailable</span>
              )}
            </div>

            {/* Dirty count */}
            <div className="w-[8%] shrink-0 text-right pr-3">
              {repo.dirtyCount > 0 ? (
                <span className="text-error font-semibold">{repo.dirtyCount}</span>
              ) : (
                <span className="text-outline">—</span>
              )}
            </div>

            {/* Last commit */}
            <div className="w-[38%] shrink-0 pr-3 min-w-0">
              {repo.lastCommitRelative ? (
                <div className="flex items-baseline gap-2 min-w-0">
                  <span className="text-outline shrink-0 w-[92px]">
                    {repo.lastCommitRelative}
                  </span>
                  <span className="truncate text-on-surface-variant">
                    {repo.lastCommitSubject}
                  </span>
                </div>
              ) : (
                <span className="text-outline">no commits</span>
              )}
            </div>

            {/* Worktree count */}
            <div className="w-[8%] shrink-0 text-right">
              {repo.worktreeCount > 1 ? (
                <span className="text-secondary">{repo.worktreeCount}</span>
              ) : (
                <span className="text-outline">{repo.worktreeCount || '—'}</span>
              )}
            </div>
          </button>
        ))}
      </div>

      {/* Footer count */}
      {rows.length > 0 && (
        <div className="px-6 py-2 border-t border-outline-variant bg-surface-container-low font-mono text-[10px] text-outline shrink-0">
          Showing {rows.length} of {repos.length} repositories
        </div>
      )}
    </div>
  );
}
