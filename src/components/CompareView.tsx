import { useCallback, useEffect, useState } from 'react';
import type { CompareResult, CompareRow } from '../../shared/types.ts';
import {
  GitBranch,
  GitMerge,
  Folder,
  RefreshCw,
  ChevronRight,
  ChevronDown,
  Check,
  Trash2,
  Copy,
  LogIn,
} from 'lucide-react';

interface CompareViewProps {
  repoName: string;
  /** Fetch the divergence matrix for the given base (default: main). */
  onLoadCompare: (base?: string) => Promise<CompareResult>;
  /** Remove a fully-merged, clean worktree by its path. */
  onPrune: (path: string) => Promise<{ ok: boolean; path: string }>;
  /** Delete a fully-merged local branch by name. */
  onDeleteBranch: (branch: string) => Promise<{ ok: boolean; branch: string }>;
  /** Merge a branch into the base. */
  onMergeBranch: (
    branch: string,
    into: string,
  ) => Promise<{ ok: boolean; source: string; target: string; alreadyUpToDate: boolean }>;
  /** Check out a ref in the main working tree. */
  onCheckout: (ref: string) => Promise<unknown>;
}

/**
 * The main working tree's current branch, clean and fully merged into the base (ahead 0) — i.e.
 * a feature branch you've already merged and can now retire: check out the base, then delete it.
 * Excludes the base itself (you're not "retiring" main while on main).
 */
function isCheckedOutMerged(r: CompareRow, base: string): boolean {
  return r.isMain && !!r.branch && !r.dirty && r.ahead === 0 && r.ref !== base;
}

/** A worktree fully contained in the base (ahead 0) with no uncommitted changes can be pruned. */
function isPrunableWorktree(r: CompareRow): boolean {
  return !!r.worktree && !r.isMain && r.ahead === 0 && !r.dirty;
}

/** A plain branch (no worktree) fully merged into the base can be deleted — but never the base itself. */
function isPrunableBranch(r: CompareRow, base: string): boolean {
  return !r.worktree && !!r.branch && !r.isMain && r.ahead === 0 && r.ref !== base;
}

/**
 * A branch ahead of the base can be merged into it. Note: we do NOT exclude `isMain`
 * rows — `isMain` marks the primary working tree's *current checkout*, which is often
 * exactly the feature branch you want to merge into a different base (e.g. `main`).
 * The only ref we can't merge is the base itself.
 */
function isMergeable(r: CompareRow, base: string): boolean {
  return !!r.branch && r.ahead > 0 && r.ref !== base;
}

export default function CompareView({
  repoName,
  onLoadCompare,
  onPrune,
  onDeleteBranch,
  onMergeBranch,
  onCheckout,
}: CompareViewProps) {
  const [result, setResult] = useState<CompareResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [base, setBase] = useState<string>('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [pruning, setPruning] = useState<string | null>(null);
  const [merging, setMerging] = useState<string | null>(null);
  const [busyRef, setBusyRef] = useState<string | null>(null);

  const load = useCallback(
    (b?: string) => {
      setLoading(true);
      setError(null);
      onLoadCompare(b)
        .then((r) => {
          setResult(r);
          setBase(r.base);
        })
        .catch((err) => setError((err as Error).message))
        .finally(() => setLoading(false));
    },
    [onLoadCompare],
  );

  // Load on mount / repo change (onLoadCompare identity changes with the active repo).
  useEffect(() => {
    load();
  }, [load]);

  const toggle = (ref: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(ref) ? next.delete(ref) : next.add(ref);
      return next;
    });

  const handleMerge = (row: CompareRow) => {
    if (merging || pruning || !row.branch || !result) return;
    const into = result.base;
    if (
      !window.confirm(
        `Merge '${row.branch}' into '${into}'?\n\n` +
          `Brings ${row.ahead} commit${row.ahead > 1 ? 's' : ''} into '${into}'. ` +
          `If '${into}' isn't checked out, the merge runs in a throwaway worktree so your working tree stays untouched. ` +
          `Conflicts abort cleanly (nothing changes).`,
      )
    ) {
      return;
    }
    setMerging(row.ref);
    setError(null);
    onMergeBranch(row.branch, into)
      .then(() => load(base || undefined))
      .catch((err) => setError((err as Error).message))
      .finally(() => setMerging(null));
  };

  const run = (ref: string, task: Promise<unknown>) => {
    setBusyRef(ref);
    setError(null);
    task
      .then(() => load(base || undefined))
      .catch((err) => setError((err as Error).message))
      .finally(() => setBusyRef(null));
  };

  const handleCheckoutMain = (row: CompareRow) => {
    if (busyRef || !result) return;
    const into = result.base;
    if (!window.confirm(`Check out '${into}' in the working tree (leaving '${row.branch}')?`)) return;
    run(row.ref, onCheckout(into));
  };

  const handleRetireBranch = (row: CompareRow) => {
    if (busyRef || !result || !row.branch) return;
    const into = result.base;
    const branch = row.branch;
    if (
      !window.confirm(
        `Delete branch '${branch}'?\n\n` +
          `It's fully merged into '${into}' and currently checked out, so this first checks out ` +
          `'${into}', then deletes '${branch}'. No commits are lost.`,
      )
    ) {
      return;
    }
    // Can't delete a checked-out branch — switch to the base first, then delete.
    run(row.ref, onCheckout(into).then(() => onDeleteBranch(branch)));
  };

  const handlePrune = (row: CompareRow) => {
    if (pruning) return;
    const baseRef = result?.base ?? 'the base';
    let action: Promise<unknown>;
    if (row.worktree) {
      if (
        !window.confirm(
          `Prune worktree '${row.name}'?\n\n` +
            `Removes the worktree directory:\n${row.worktree}\n\n` +
            `It's fully merged into ${baseRef} with no uncommitted changes. ` +
            `The branch and its commits stay in the repo (re-add later with \`git worktree add\`).`,
        )
      ) {
        return;
      }
      action = onPrune(row.worktree);
    } else if (row.branch) {
      if (
        !window.confirm(
          `Delete branch '${row.branch}'?\n\n` +
            `It's fully merged into ${baseRef}, so no commits are lost. ` +
            `Uses \`git branch -d\` (refuses if anything is unmerged).`,
        )
      ) {
        return;
      }
      action = onDeleteBranch(row.branch);
    } else {
      return;
    }
    setPruning(row.ref);
    setError(null);
    action
      .then(() => load(base || undefined))
      .catch((err) => setError((err as Error).message))
      .finally(() => setPruning(null));
  };

  const baseOptions = (result?.rows ?? []).filter((r) => r.branch).map((r) => r.branch as string);
  const mergeable = (result?.rows ?? []).filter((r) => isMergeable(r, result?.base ?? '')).length;

  return (
    <div className="flex-1 overflow-y-auto p-6 bg-surface-container-lowest font-sans select-none">
      {/* Header */}
      <div className="mb-4 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-on-surface mb-1 flex items-center gap-3">
            Compare branches
            {repoName && (
              <span className="text-[10px] font-mono text-outline font-semibold px-2 py-0.5 bg-surface-container-high rounded">
                {repoName}
              </span>
            )}
          </h2>
          <p className="text-xs text-on-surface-variant font-mono">
            Every local branch &amp; detached worktree vs the base — <span className="text-secondary">ahead</span> = commits it would merge in,{' '}
            <span className="text-outline">behind</span> = how stale it is.
            {result && (
              <>
                {' '}
                {mergeable === 0 ? (
                  <span className="text-secondary">Nothing to merge — all branches are contained in {result.base}.</span>
                ) : (
                  <span className="text-primary">
                    {mergeable} branch{mergeable > 1 ? 'es have' : ' has'} unmerged commits vs {result.base}.
                  </span>
                )}
              </>
            )}
          </p>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-3 text-xs font-mono bg-surface-container-lowest p-2 border border-outline-variant rounded-lg shrink-0">
          <span className="text-[10px] text-outline font-bold uppercase">Base:</span>
          <select
            value={base}
            onChange={(e) => load(e.target.value)}
            disabled={loading}
            className="bg-surface border-none text-secondary p-0 focus:ring-0 cursor-pointer font-bold disabled:opacity-60"
          >
            {base && !baseOptions.includes(base) && <option value={base}>{base}</option>}
            {baseOptions.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
          <button
            onClick={() => load(base || undefined)}
            disabled={loading}
            className="px-3 py-1 bg-secondary-container text-on-secondary-container rounded font-semibold hover:opacity-95 transition-all flex items-center gap-1 disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 bg-error/10 border border-error/30 rounded-lg p-3 text-xs font-mono text-error">{error}</div>
      )}

      {/* Matrix */}
      <div className="border border-outline-variant rounded-xl overflow-hidden">
        <div className="grid grid-cols-[minmax(200px,1fr)_84px_84px_110px_minmax(160px,1.4fr)_176px] bg-surface-container-high text-[10px] font-mono font-bold uppercase text-outline">
          <div className="px-4 py-2">Branch / Worktree</div>
          <div className="px-2 py-2 text-right">Ahead</div>
          <div className="px-2 py-2 text-right">Behind</div>
          <div className="px-2 py-2">Merge-base</div>
          <div className="px-4 py-2">Last commit</div>
          <div className="px-2 py-2"></div>
        </div>

        {loading && !result && <div className="px-4 py-8 text-center text-outline font-mono text-xs">Comparing…</div>}
        {result?.rows.length === 0 && !loading && (
          <div className="px-4 py-8 text-center text-outline font-mono text-xs">No branches to compare.</div>
        )}

        {result?.rows.map((row) => (
          <CompareRowView
            key={row.ref}
            row={row}
            base={result.base}
            open={expanded.has(row.ref)}
            onToggle={() => toggle(row.ref)}
            prunable={isPrunableWorktree(row) || isPrunableBranch(row, result.base)}
            pruning={pruning === row.ref}
            onPrune={() => handlePrune(row)}
            mergeable={isMergeable(row, result.base)}
            merging={merging === row.ref}
            onMerge={() => handleMerge(row)}
            retirable={isCheckedOutMerged(row, result.base)}
            busy={busyRef === row.ref}
            onCheckoutMain={() => handleCheckoutMain(row)}
            onRetire={() => handleRetireBranch(row)}
          />
        ))}
      </div>
    </div>
  );
}

function CompareRowView({
  row,
  base,
  open,
  onToggle,
  prunable,
  pruning,
  onPrune,
  mergeable,
  merging,
  onMerge,
  retirable,
  busy,
  onCheckoutMain,
  onRetire,
}: {
  row: CompareRow;
  base: string;
  open: boolean;
  onToggle: () => void;
  prunable: boolean;
  pruning: boolean;
  onPrune: () => void;
  mergeable: boolean;
  merging: boolean;
  onMerge: () => void;
  retirable: boolean;
  busy: boolean;
  onCheckoutMain: () => void;
  onRetire: () => void;
}) {
  const canExpand = row.unique.length > 0;
  const [copied, setCopied] = useState(false);
  // Copy the git name — branch name, or the short hash for a detached worktree.
  const copyName = () => {
    navigator.clipboard
      ?.writeText(row.ref)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  };
  return (
    <div className="border-t border-outline-variant/60 font-mono text-xs">
      <div
        onClick={canExpand ? onToggle : undefined}
        className={`grid grid-cols-[minmax(200px,1fr)_84px_84px_110px_minmax(160px,1.4fr)_176px] items-center ${
          canExpand ? 'cursor-pointer hover:bg-surface-container-high' : ''
        } ${row.isMain ? 'bg-surface-container/40' : ''}`}
      >
        {/* Name + badges */}
        <div className="px-4 py-2.5 flex items-center gap-2 min-w-0">
          {canExpand ? (
            open ? (
              <ChevronDown className="w-3.5 h-3.5 text-outline shrink-0" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-outline shrink-0" />
            )
          ) : (
            <span className="w-3.5 shrink-0" />
          )}
          {row.detached ? (
            <Folder className="w-3.5 h-3.5 text-error shrink-0" />
          ) : (
            <GitBranch className="w-3.5 h-3.5 text-outline shrink-0" />
          )}
          <span className={`truncate ${row.isMain ? 'text-on-surface font-bold' : 'text-on-surface'}`} title={row.name}>
            {row.name}
          </span>
          {row.isMain && (
            <span className="px-1.5 py-0.5 rounded text-[9px] uppercase font-bold bg-secondary/20 text-secondary shrink-0">
              main
            </span>
          )}
          {row.detached && (
            <span className="px-1.5 py-0.5 rounded text-[9px] uppercase font-bold bg-surface-container-high text-outline shrink-0">
              detached
            </span>
          )}
          {row.worktree && !row.isMain && (
            <span
              className="px-1.5 py-0.5 rounded text-[9px] uppercase font-bold bg-primary/15 text-primary shrink-0"
              title={row.worktree}
            >
              worktree
            </span>
          )}
          {row.dirty && (
            <span
              className="flex items-center gap-1 text-[9px] uppercase font-bold text-tertiary shrink-0"
              title="Uncommitted changes in this worktree"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-tertiary animate-pulse" /> dirty
            </span>
          )}
        </div>

        {/* Ahead */}
        <div className="px-2 py-2.5 text-right">
          {row.ahead > 0 ? (
            <span className="text-secondary font-bold">+{row.ahead}</span>
          ) : row.isMain ? (
            <span className="text-outline">—</span>
          ) : (
            <span className="text-outline inline-flex items-center gap-1 justify-end">
              <Check className="w-3 h-3" />0
            </span>
          )}
        </div>

        {/* Behind */}
        <div className="px-2 py-2.5 text-right">
          {row.behind > 0 ? (
            <span className="text-on-surface-variant">-{row.behind}</span>
          ) : (
            <span className="text-outline">—</span>
          )}
        </div>

        {/* Merge-base */}
        <div className="px-2 py-2.5 text-outline">{row.isMain ? '—' : row.mergeBase || '—'}</div>

        {/* Last commit */}
        <div className="px-4 py-2.5 min-w-0">
          <div className="truncate text-on-surface-variant" title={row.subject}>
            {row.subject}
          </div>
          <div className="text-[10px] text-outline">
            {row.head} · {row.relativeDate}
          </div>
        </div>

        {/* Actions: copy the git name; prune a fully-merged, clean worktree/branch */}
        <div className="px-2 py-2.5 flex justify-end items-center gap-1.5">
          <button
            onClick={(e) => {
              e.stopPropagation();
              copyName();
            }}
            title={copied ? 'Copied!' : `Copy "${row.ref}"`}
            className="p-1 rounded text-outline hover:text-on-surface hover:bg-surface-container-high transition-colors"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-secondary" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
          {mergeable && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onMerge();
              }}
              disabled={merging}
              title={`Merge ${row.branch} into ${base}`}
              className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold uppercase border border-primary/40 text-primary hover:bg-primary/10 transition-colors disabled:opacity-50"
            >
              <GitMerge className="w-3 h-3" />
              {merging ? '…' : 'Merge'}
            </button>
          )}
          {retirable && (
            <>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onCheckoutMain();
                }}
                disabled={busy}
                title={`Check out ${base} in the working tree`}
                className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold uppercase border border-primary/40 text-primary hover:bg-primary/10 transition-colors disabled:opacity-50"
              >
                <LogIn className="w-3 h-3" />
                {busy ? '…' : base}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRetire();
                }}
                disabled={busy}
                title={`Check out ${base}, then delete ${row.branch}`}
                className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold uppercase border border-error/30 text-error hover:bg-error/10 transition-colors disabled:opacity-50"
              >
                <Trash2 className="w-3 h-3" />
                Delete
              </button>
            </>
          )}
          {prunable && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onPrune();
              }}
              disabled={pruning}
              title={
                row.worktree
                  ? 'Remove this worktree (fully merged, no changes)'
                  : 'Delete this branch (fully merged into the base)'
              }
              className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold uppercase border border-error/30 text-error hover:bg-error/10 transition-colors disabled:opacity-50"
            >
              <Trash2 className="w-3 h-3" />
              {pruning ? '…' : 'Prune'}
            </button>
          )}
        </div>
      </div>

      {/* Expanded: unique (ahead) commits */}
      {open && canExpand && (
        <div className="bg-[#0d0e12] px-4 py-3 border-t border-outline-variant/60">
          <div className="text-[9px] text-outline font-bold uppercase mb-2">
            {row.ahead} commit{row.ahead > 1 ? 's' : ''} not on {base}
            {row.unique.length < row.ahead ? ` (showing first ${row.unique.length})` : ''}
          </div>
          <div className="space-y-1">
            {row.unique.map((c) => (
              <div key={c.hash} className="flex items-baseline gap-2 text-[11px]">
                <span className="text-secondary font-bold shrink-0">{c.hash}</span>
                <span className="text-on-surface-variant truncate" title={c.subject}>
                  {c.subject}
                </span>
                <span className="text-outline text-[10px] shrink-0 ml-auto">{c.relativeDate}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
