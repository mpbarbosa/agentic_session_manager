import { useEffect, useState } from 'react';
import { Commit } from '../types';
import type { CommitDetail } from '../../shared/types.ts';
import {
  Play,
  FileText,
  Download,
  X,
  PlusSquare,
  MinusSquare,
  Edit,
} from 'lucide-react';
import { AnsiText } from './AnsiText';

interface HistoryViewProps {
  commits: Commit[];
  repoName: string;
  repoPath: string;
  branch: string;
  /** Fetch the full detail (per-file stats + diff) for a commit. */
  onLoadCommit: (hash: string) => Promise<CommitDetail | null>;
  /** Check out a commit into the working tree (guarded + confirmed in the parent). */
  onCheckout: (hash: string) => void;
  /** Re-run the git log with the given limit / all-branches flags. */
  onQueryLog: (opts: { limit: number; all: boolean }) => void;
  /** True while a log query is in flight. */
  loading: boolean;
  searchQuery: string;
}

export default function HistoryView({
  commits,
  repoName,
  repoPath,
  branch,
  onLoadCommit,
  onCheckout,
  onQueryLog,
  loading,
  searchQuery
}: HistoryViewProps) {
  const [selectedCommit, setSelectedCommit] = useState<Commit | null>(commits[0] || null);
  const [detail, setDetail] = useState<CommitDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  // Log controls: styleMode is client-side row density; limit + allBranches drive a refetch.
  const [styleMode, setStyleMode] = useState<'oneline' | 'full' | 'medium'>('oneline');
  const [allBranches, setAllBranches] = useState(true);
  const [limit, setLimit] = useState('100');

  const runQuery = () => onQueryLog({ limit: Math.max(1, Number(limit) || 100), all: allBranches });

  // Load the selected commit's full detail (files + diff) from the server.
  useEffect(() => {
    if (!selectedCommit) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    setDetail(null);
    onLoadCommit(selectedCommit.hash)
      .then((d) => !cancelled && setDetail(d))
      .catch(() => !cancelled && setDetail(null))
      .finally(() => !cancelled && setDetailLoading(false));
    return () => {
      cancelled = true;
    };
  }, [selectedCommit, onLoadCommit]);

  // Filter commits based on search query
  const filteredCommits = commits.filter(commit => {
    const query = searchQuery.toLowerCase();
    return (
      commit.hash.toLowerCase().includes(query) ||
      commit.message.toLowerCase().includes(query) ||
      commit.author.name.toLowerCase().includes(query)
    );
  });

  return (
    <div className="flex-1 flex overflow-hidden bg-surface-container-lowest">
      
      {/* MAIN CONTAINER: Git History list & filters */}
      <div className="flex-1 flex flex-col overflow-hidden relative">
        
        {/* Filters and Header Bar */}
        <div className="bg-surface-container-low border-b border-outline-variant p-4 flex flex-col gap-3 shrink-0 select-none">
          <div className="flex items-center gap-3">
            <span className="font-sans text-lg font-bold text-on-surface">Git History</span>
            {repoName && (
              <span className="px-2 py-0.5 bg-surface-container-high rounded text-[10px] font-mono text-outline font-semibold">
                {repoName}
              </span>
            )}
          </div>

          {/* Style Controls */}
          <div className="flex flex-wrap items-center gap-6 bg-surface-container-lowest p-3 border border-outline-variant rounded-lg text-xs font-mono">
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-outline font-bold uppercase">Style:</span>
              <select 
                value={styleMode}
                onChange={(e) => setStyleMode(e.target.value as any)}
                className="bg-surface border-none text-secondary p-0 focus:ring-0 cursor-pointer font-bold"
              >
                <option value="oneline">oneline</option>
                <option value="full">full</option>
                <option value="medium">medium</option>
              </select>
            </div>
            
            <div className="h-4 w-px bg-outline-variant hidden sm:block"></div>

            <div className="flex items-center gap-2">
              <input 
                type="checkbox"
                id="all-branches"
                checked={allBranches}
                onChange={(e) => setAllBranches(e.target.checked)}
                className="rounded border-outline-variant bg-surface text-primary focus:ring-primary h-3.5 w-3.5 cursor-pointer"
              />
              <label htmlFor="all-branches" className="text-on-surface-variant cursor-pointer select-none">--all</label>
            </div>

            <div className="h-4 w-px bg-outline-variant hidden sm:block"></div>

            <div className="flex items-center gap-2">
              <span className="text-[10px] text-outline font-bold uppercase">Limit:</span>
              <input
                type="text"
                inputMode="numeric"
                value={limit}
                onChange={(e) => setLimit(e.target.value.replace(/[^0-9]/g, ''))}
                onKeyDown={(e) => e.key === 'Enter' && runQuery()}
                className="w-12 bg-transparent border-none p-0 text-on-surface focus:ring-0 font-bold"
              />
            </div>

            <div className="flex-1"></div>

            <button
              onClick={runQuery}
              disabled={loading}
              className="bg-secondary-container text-on-secondary-container px-4 py-1 rounded font-semibold hover:opacity-95 transition-all flex items-center gap-1 disabled:opacity-60"
            >
              <Play className="w-3.5 h-3.5" />
              {loading ? 'Running…' : 'Run'}
            </button>
          </div>
        </div>

        {/* Commit Log Table List Area */}
        <div className="flex-1 overflow-y-auto p-4 font-mono text-xs select-none">
          <div className="max-w-5xl mx-auto space-y-1">
            {filteredCommits.map((commit, index) => {
              const isSelected = selectedCommit?.hash === commit.hash;
              
              // Custom visual colors and structures based on commit positions to clone the mockup exactly
              let graphLineStyle = "git-graph-line h-full top-1/2";
              let dotColor = "bg-primary shadow-[0_0_8px_rgba(173,198,255,0.5)]";
              
              if (index === 0) {
                graphLineStyle = "git-graph-line h-full top-1/2";
                dotColor = "bg-[#adc6ff] shadow-[0_0_10px_rgba(173,198,255,0.6)]";
              } else if (index === 1) {
                graphLineStyle = "git-graph-line h-full";
                dotColor = "bg-outline";
              } else if (index === 2) {
                graphLineStyle = "git-graph-line h-full";
                dotColor = "bg-tertiary shadow-[0_0_8px_rgba(255,185,95,0.5)]";
              } else if (index === 3) {
                graphLineStyle = "git-graph-line h-full";
                dotColor = "bg-outline";
              } else {
                graphLineStyle = "git-graph-line h-full";
                dotColor = "bg-secondary shadow-[0_0_8px_rgba(78,222,163,0.5)]";
              }

              return (
                <div 
                  key={commit.hash}
                  onClick={() => setSelectedCommit(commit)}
                  className={`group flex items-center min-h-[44px] px-4 hover:bg-surface-container-high rounded cursor-pointer transition-all ${
                    isSelected 
                      ? 'bg-surface-container border-l-4 border-primary' 
                      : 'border-l-4 border-transparent'
                  }`}
                >
                  {/* Visual Git Node Tree Column */}
                  <div className="w-16 flex justify-center relative self-stretch">
                    {/* Vertical connector between successive commits */}
                    {index < filteredCommits.length - 1 && (
                      <div className={graphLineStyle}></div>
                    )}

                    {/* Node Dot */}
                    <div className={`w-2.5 h-2.5 rounded-full mt-4 z-10 shrink-0 ${dotColor}`}></div>
                  </div>

                  {/* Hash */}
                  <div className={`w-20 font-bold shrink-0 ${isSelected ? 'text-primary' : 'text-outline'}`}>
                    {commit.hash}
                  </div>

                  {/* Description message and labels */}
                  <div className="flex-1 flex flex-wrap items-center gap-3 pr-4">
                    <span className={`line-clamp-1 truncate ${isSelected ? 'text-on-surface font-semibold' : 'text-on-surface-variant'}`}>
                      {commit.message}
                    </span>

                    {/* Author (medium + full styles) */}
                    {styleMode !== 'oneline' && commit.author.name && (
                      <span className="text-[10px] text-outline shrink-0">
                        — {commit.author.name}
                        {styleMode === 'full' && commit.author.email ? ` <${commit.author.email}>` : ''}
                      </span>
                    )}

                    {/* Branch and tags list */}
                    {commit.tags && commit.tags.map(tag => {
                      const isHead = tag.includes('HEAD');
                      const isMain = tag === 'main';
                      return (
                        <span 
                          key={tag}
                          className={`px-1.5 py-0.5 text-[9px] font-bold rounded ${
                            isHead ? 'bg-secondary text-on-secondary-fixed' :
                            isMain ? 'bg-primary-container text-on-primary-container' : 'border border-outline-variant text-outline'
                          }`}
                        >
                          {tag}
                        </span>
                      );
                    })}

                    {/* Body (full style only) */}
                    {styleMode === 'full' && commit.body && (
                      <pre className="w-full mt-1 text-[10px] text-on-surface-variant/80 font-mono whitespace-pre-wrap line-clamp-4">
                        {commit.body}
                      </pre>
                    )}
                  </div>

                  {/* Date relative */}
                  <div className="w-28 text-right text-outline shrink-0">
                    {commit.relativeTime}
                  </div>
                </div>
              );
            })}
            
            {filteredCommits.length === 0 && (
              <div className="text-center py-12 text-outline">
                No commits found matching "{searchQuery}"
              </div>
            )}
          </div>
        </div>

        {/* Console Status Footer */}
        <footer className="bg-surface-container-low border-t border-outline-variant h-12 flex items-center justify-between px-6 shrink-0 font-mono text-[11px] text-outline select-none">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-secondary animate-pulse"></span>
              <span className="font-bold">CONNECTED</span>
            </div>
            <div className="flex items-center gap-2">
              <span>{repoPath || '—'}</span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span>UTF-8</span>
            <div className="w-px h-4 bg-outline-variant"></div>
            <span>Git: {branch || '—'}</span>
          </div>
        </footer>
      </div>

      {/* RIGHT SIDEBAR: Inspector Panel for Commit Details */}
      {selectedCommit && (
        <aside className="w-[320px] bg-surface-container border-l border-outline-variant flex flex-col shrink-0 select-none">

          <div className="p-4 border-b border-outline-variant flex justify-between items-center bg-surface-container-high">
            <span className="font-sans font-bold text-sm text-on-surface">Commit Details</span>
            <button
              onClick={() => setSelectedCommit(null)}
              className="text-outline hover:text-on-surface transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-4 overflow-y-auto flex-1 space-y-5">

            {/* Author + subject */}
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <img
                  alt={selectedCommit.author.name}
                  className="w-10 h-10 rounded-full border border-outline-variant object-cover"
                  src={selectedCommit.author.avatar}
                />
                <div className="min-w-0">
                  <div className="font-sans font-bold text-xs text-on-surface truncate">{selectedCommit.author.name}</div>
                  <div className="text-[10px] text-outline font-mono truncate">
                    {detail?.authorEmail || selectedCommit.author.email || '—'}
                  </div>
                </div>
              </div>

              <p className="text-[11px] text-on-surface font-sans leading-snug">{selectedCommit.message}</p>
              {detail?.body && (
                <pre className="text-[10px] text-on-surface-variant font-mono whitespace-pre-wrap leading-relaxed bg-surface-container-lowest border border-outline-variant rounded-lg p-2.5">
                  {detail.body.trim()}
                </pre>
              )}

              <div className="bg-surface-container-lowest p-3 border border-outline-variant rounded-lg space-y-2 font-mono text-[11px]">
                <div className="flex justify-between items-center gap-2">
                  <span className="text-outline font-bold text-[9px] tracking-wider uppercase">HASH</span>
                  <span className="text-primary font-bold truncate" title={detail?.hash ?? selectedCommit.hash}>
                    {detail ? detail.hash.slice(0, 12) : selectedCommit.hash}
                  </span>
                </div>
                <div className="flex justify-between items-center gap-2">
                  <span className="text-outline font-bold text-[9px] tracking-wider uppercase">DATE</span>
                  <span className="text-on-surface-variant truncate">{selectedCommit.date}</span>
                </div>
              </div>
            </div>

            {/* Changes list with real per-file stats */}
            <div className="space-y-2 font-mono">
              <span className="text-outline font-bold text-[9px] tracking-wider uppercase block">
                CHANGES {detail ? `(${detail.files.length})` : detailLoading ? '(loading…)' : ''}
              </span>
              {detailLoading && <div className="text-[11px] text-outline px-2 py-1">Loading commit diff…</div>}
              {detail && detail.files.length === 0 && !detailLoading && (
                <div className="text-[11px] text-outline px-2 py-1">No file changes (merge or empty commit).</div>
              )}
              <div className="space-y-1">
                {detail?.files.map((file) => {
                  const isAdd = file.status === 'A';
                  const isDel = file.status === 'D';
                  return (
                    <div
                      key={file.path}
                      onClick={() => setShowDiff(true)}
                      className="flex items-center justify-between p-2 hover:bg-surface-container-high rounded cursor-pointer group"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {isAdd && <PlusSquare className="w-3.5 h-3.5 text-secondary shrink-0" />}
                        {isDel && <MinusSquare className="w-3.5 h-3.5 text-error shrink-0" />}
                        {!isAdd && !isDel && <Edit className="w-3.5 h-3.5 text-tertiary shrink-0" />}
                        <span className="truncate text-[11px] text-on-surface" title={file.path}>{file.path}</span>
                      </div>
                      <span className="text-[10px] font-bold shrink-0 flex gap-1.5">
                        {file.additions > 0 && <span className="text-secondary">+{file.additions}</span>}
                        {file.deletions > 0 && <span className="text-error">-{file.deletions}</span>}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

          </div>

          {/* Diff & Checkout Buttons */}
          <div className="p-4 border-t border-outline-variant bg-surface-container-high grid grid-cols-2 gap-2 shrink-0">
            <button
              onClick={() => setShowDiff(true)}
              disabled={!detail || detail.files.length === 0}
              className="flex flex-col items-center justify-center gap-1.5 p-3 border border-outline-variant rounded-lg hover:border-primary hover:text-primary transition-all font-mono text-[10px] font-bold text-on-surface disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-outline-variant disabled:hover:text-on-surface"
            >
              <FileText className="w-4 h-4 text-outline" />
              <span>DIFF</span>
            </button>
            <button
              onClick={() => onCheckout(selectedCommit.hash)}
              className="flex flex-col items-center justify-center gap-1.5 p-3 border border-outline-variant rounded-lg hover:border-secondary hover:text-secondary transition-all font-mono text-[10px] font-bold text-on-surface"
            >
              <Download className="w-4 h-4 text-outline" />
              <span>CHECKOUT</span>
            </button>
          </div>

        </aside>
      )}

      {/* Commit diff modal — renders the selected commit's real per-file diff. */}
      {showDiff && detail && (
        <div className="fixed inset-0 bg-[#0d0e12]/90 backdrop-blur-md flex items-center justify-center p-6 z-50">
          <div className="bg-surface-container border border-outline-variant rounded-2xl max-w-4xl w-full h-[85vh] overflow-hidden flex flex-col">
            <div className="p-4 border-b border-outline-variant flex justify-between items-center bg-surface-container-high">
              <span className="font-sans font-bold text-on-surface flex items-center gap-2 min-w-0">
                <FileText className="w-5 h-5 text-primary shrink-0" />
                <span className="truncate">{detail.shortHash} — {detail.subject}</span>
              </span>
              <button
                onClick={() => setShowDiff(false)}
                className="p-1.5 text-outline hover:text-on-surface hover:bg-surface-container rounded-full shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-auto bg-[#0d0e12] font-mono text-[11px] leading-relaxed">
              {detail.files.map((file) => (
                <div key={file.path} className="border-b border-outline-variant/40">
                  <div className="sticky top-0 bg-surface-container-high px-4 py-1.5 text-on-surface font-bold flex items-center justify-between">
                    <span className="truncate">{file.path}</span>
                    <span className="shrink-0 flex gap-2">
                      {file.additions > 0 && <span className="text-secondary">+{file.additions}</span>}
                      {file.deletions > 0 && <span className="text-error">-{file.deletions}</span>}
                    </span>
                  </div>
                  <div className="px-3 py-2">
                    {file.diff.length === 0 && <span className="text-outline px-1">(no textual diff)</span>}
                    {file.diff.map((line, i) => (
                      <div
                        key={i}
                        className={`whitespace-pre-wrap break-all px-1 ${
                          line.type === 'added'
                            ? 'text-secondary bg-secondary/5'
                            : line.type === 'removed'
                              ? 'text-error bg-error/5'
                              : 'text-on-surface-variant'
                        }`}
                      >
                        <AnsiText text={`${line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}${line.text}`} />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
