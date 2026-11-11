import { useCallback, useEffect, useState } from 'react';
import type { BranchInfo } from '../../shared/types.ts';
import { GitBranch, RefreshCw, Check, Copy, ArrowUp, ArrowDown, AlertTriangle } from 'lucide-react';

interface BranchesViewProps {
  repoName: string;
  /** Fetch all local branches for the active repo. */
  onLoadBranches: () => Promise<BranchInfo[]>;
}

/** Read-only overview of every local branch and its upstream tracking status. */
export default function BranchesView({ repoName, onLoadBranches }: BranchesViewProps) {
  const [branches, setBranches] = useState<BranchInfo[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    onLoadBranches()
      .then(setBranches)
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [onLoadBranches]);

  // Load on mount / repo change (onLoadBranches identity changes with the active repo).
  useEffect(() => {
    load();
  }, [load]);

  const total = branches?.length ?? 0;
  const tracked = (branches ?? []).filter((b) => b.upstream && !b.gone).length;

  return (
    <div className="flex-1 overflow-y-auto p-6 bg-surface-container-lowest font-sans select-none">
      {/* Header */}
      <div className="mb-4 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-on-surface mb-1 flex items-center gap-3">
            Branches
            {repoName && (
              <span className="text-[10px] font-mono text-outline font-semibold px-2 py-0.5 bg-surface-container-high rounded">
                {repoName}
              </span>
            )}
          </h2>
          <p className="text-xs text-on-surface-variant font-mono">
            Every local branch, newest commit first.{' '}
            {branches && (
              <span className="text-outline">
                {total} branch{total === 1 ? '' : 'es'}
                {total > 0 && (
                  <>
                    {' · '}
                    {tracked} tracking a remote
                  </>
                )}
                .
              </span>
            )}
          </p>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-3 text-xs font-mono bg-surface-container-lowest p-2 border border-outline-variant rounded-lg shrink-0">
          <button
            onClick={load}
            disabled={loading}
            className="px-3 py-1 bg-secondary-container text-on-secondary-container rounded font-semibold hover:opacity-95 transition-all flex items-center gap-1 disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 bg-error/10 border border-error/30 rounded-lg p-3 text-xs font-mono text-error">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="border border-outline-variant rounded-xl overflow-hidden">
        <div className="grid grid-cols-[minmax(200px,1fr)_130px_minmax(160px,1.6fr)_36px] bg-surface-container-high text-[10px] font-mono font-bold uppercase text-outline">
          <div className="px-4 py-2">Branch</div>
          <div className="px-2 py-2">Upstream</div>
          <div className="px-4 py-2">Last commit</div>
          <div className="px-2 py-2"></div>
        </div>

        {loading && !branches && (
          <div className="px-4 py-8 text-center text-outline font-mono text-xs">Loading branches…</div>
        )}
        {branches?.length === 0 && !loading && (
          <div className="px-4 py-8 text-center text-outline font-mono text-xs">No local branches.</div>
        )}

        {branches?.map((b) => <BranchRow key={b.name} branch={b} />)}
      </div>
    </div>
  );
}

function BranchRow({ branch: b }: { branch: BranchInfo }) {
  const [copied, setCopied] = useState(false);
  const copyName = () => {
    navigator.clipboard
      ?.writeText(b.name)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  };

  return (
    <div
      className={`grid grid-cols-[minmax(200px,1fr)_130px_minmax(160px,1.6fr)_36px] items-center border-t border-outline-variant/60 font-mono text-xs ${
        b.current ? 'bg-surface-container/40' : ''
      }`}
    >
      {/* Name + badges */}
      <div className="px-4 py-2.5 flex items-center gap-2 min-w-0">
        <GitBranch className={`w-3.5 h-3.5 shrink-0 ${b.current ? 'text-secondary' : 'text-outline'}`} />
        <span
          className={`truncate ${b.current ? 'text-on-surface font-bold' : 'text-on-surface'}`}
          title={b.name}
        >
          {b.name}
        </span>
        {b.current && (
          <span className="px-1.5 py-0.5 rounded text-[9px] uppercase font-bold bg-secondary/20 text-secondary shrink-0">
            current
          </span>
        )}
        {b.worktree && !b.isMain && (
          <span
            className="px-1.5 py-0.5 rounded text-[9px] uppercase font-bold bg-primary/15 text-primary shrink-0"
            title={b.worktree}
          >
            worktree
          </span>
        )}
      </div>

      {/* Upstream + ahead/behind */}
      <div className="px-2 py-2.5 min-w-0">
        {b.upstream ? (
          b.gone ? (
            <span
              className="inline-flex items-center gap-1 text-[10px] uppercase font-bold text-error"
              title={`Upstream ${b.upstream} no longer exists`}
            >
              <AlertTriangle className="w-3 h-3" /> gone
            </span>
          ) : (
            <div className="flex items-center gap-2">
              {b.ahead === 0 && b.behind === 0 ? (
                <span className="inline-flex items-center gap-1 text-outline" title="In sync with upstream">
                  <Check className="w-3 h-3" /> synced
                </span>
              ) : (
                <>
                  {b.ahead > 0 && (
                    <span className="inline-flex items-center gap-0.5 text-secondary font-bold" title={`${b.ahead} unpushed`}>
                      <ArrowUp className="w-3 h-3" />
                      {b.ahead}
                    </span>
                  )}
                  {b.behind > 0 && (
                    <span
                      className="inline-flex items-center gap-0.5 text-on-surface-variant"
                      title={`${b.behind} unpulled`}
                    >
                      <ArrowDown className="w-3 h-3" />
                      {b.behind}
                    </span>
                  )}
                </>
              )}
            </div>
          )
        ) : (
          <span className="text-outline text-[10px]" title="No tracking branch">
            local only
          </span>
        )}
        {b.upstream && (
          <div className="text-[9px] text-outline truncate" title={b.upstream}>
            {b.upstream}
          </div>
        )}
      </div>

      {/* Last commit */}
      <div className="px-4 py-2.5 min-w-0">
        <div className="truncate text-on-surface-variant" title={b.subject}>
          {b.subject || '—'}
        </div>
        <div className="text-[10px] text-outline">
          {b.head} · {b.relativeDate}
        </div>
      </div>

      {/* Copy the branch name */}
      <div className="px-2 py-2.5 flex justify-end">
        <button
          onClick={copyName}
          title={copied ? 'Copied!' : `Copy "${b.name}"`}
          className="p-1 rounded text-outline hover:text-on-surface hover:bg-surface-container-high transition-colors"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-secondary" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
      </div>
    </div>
  );
}
