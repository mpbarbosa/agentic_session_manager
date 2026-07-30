import { useCallback, useEffect, useRef, useState } from 'react';
import type { PipelineEvent, PipelineStep, StepStatus, TestRunner } from '../../shared/types.ts';
import {
  cancelPipeline,
  fetchTestRunners,
  fetchDeployRunners,
  pipelineStreamUrl,
  startPipeline,
} from '../api';
import { AnsiText } from './AnsiText';
import {
  Play,
  RotateCw,
  Check,
  Download,
  X,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  Square,
} from 'lucide-react';

interface ReleaseViewProps {
  repoId: string;
  worktree: string | null;
  /** Called after a successful run so the parent can refresh Changes/History. */
  onRefresh: () => void;
}

const STEPS: { key: PipelineStep; label: string }[] = [
  { key: 'tests', label: 'Tests' },
  { key: 'commit', label: 'Commit' },
  { key: 'merge', label: 'Merge' },
  { key: 'bump', label: 'Bump' },
  { key: 'push', label: 'Push' },
  { key: 'deploy', label: 'Deploy' },
];

const emptySteps = (): Record<PipelineStep, StepStatus> => ({
  tests: 'pending',
  commit: 'pending',
  merge: 'pending',
  bump: 'pending',
  push: 'pending',
  deploy: 'pending',
});

export default function ReleaseView({ repoId, worktree, onRefresh }: ReleaseViewProps) {
  const [runners, setRunners] = useState<TestRunner[]>([]);
  const [command, setCommand] = useState('');
  const [push, setPush] = useState(true);
  const [deployEnabled, setDeployEnabled] = useState(false);
  const [deployCommand, setDeployCommand] = useState('');
  const [deployRunners, setDeployRunners] = useState<TestRunner[]>([]);

  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<Record<PipelineStep, StepStatus>>(emptySteps);
  const [details, setDetails] = useState<Partial<Record<PipelineStep, string>>>({});
  const [log, setLog] = useState('');
  const [error, setError] = useState<string | null>(null);

  const esRef = useRef<EventSource | null>(null);
  const jobRef = useRef<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true); // follow the tail unless the user scrolls up

  const where = worktree ? worktree.split('/').filter(Boolean).pop() ?? 'main' : 'main';

  // Keep the console pinned to the newest output.
  useEffect(() => {
    const el = logRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [log]);

  // Detect test + deploy runners on repo change; default each command to the strongest candidate.
  useEffect(() => {
    if (!repoId) return;
    let cancelled = false;
    fetchTestRunners(repoId)
      .then((rs) => {
        if (cancelled) return;
        setRunners(rs);
        setCommand((c) => c || rs[0]?.command || '');
      })
      .catch((err) => !cancelled && setError((err as Error).message));
    fetchDeployRunners(repoId)
      .then((ds) => {
        if (cancelled) return;
        setDeployRunners(ds);
        setDeployCommand((c) => c || ds[0]?.command || '');
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [repoId]);

  // Tear down the stream on unmount / repo change.
  useEffect(() => {
    return () => {
      esRef.current?.close();
      esRef.current = null;
    };
  }, [repoId]);

  const run = useCallback(async () => {
    const cmd = command.trim();
    if (!cmd || !repoId) return;
    const deploy = deployEnabled ? deployCommand.trim() : '';
    if (
      !window.confirm(
        `Run the release pipeline?\n\n` +
          `1. Tests (in ${where}):  ${cmd}\n` +
          `2. AI commit in the worktree\n` +
          `3. Merge into main\n` +
          `4. Bump package.json in main (Claude decides major/minor/patch)\n` +
          `5. ${push ? 'Push main to origin' : '(skip push)'}\n` +
          `6. ${deploy ? `Deploy from main:  ${deploy}` : '(skip deploy)'}\n\n` +
          `Steps 1 and 6 execute their commands locally.`,
      )
    ) {
      return;
    }
    setRunning(true);
    setError(null);
    setSteps(emptySteps());
    setDetails({});
    setLog('');
    try {
      const jobId = await startPipeline(repoId, { command: cmd, push, worktree, deploy });
      jobRef.current = jobId;
      const es = new EventSource(pipelineStreamUrl(repoId, jobId));
      esRef.current = es;
      es.onmessage = (e) => {
        const ev = JSON.parse(e.data) as PipelineEvent;
        if (ev.type === 'log') setLog((l) => l + ev.text);
        else if (ev.type === 'step') {
          setSteps((s) => ({ ...s, [ev.step]: ev.status }));
          if (ev.detail) setDetails((d) => ({ ...d, [ev.step]: ev.detail }));
        } else if (ev.type === 'error') setError(ev.message);
        else if (ev.type === 'done') {
          setRunning(false);
          if (ev.ok) onRefresh();
        }
      };
      es.addEventListener('end', () => {
        es.close();
        esRef.current = null;
        setRunning(false);
      });
      es.onerror = () => {
        es.close();
        esRef.current = null;
        setRunning(false);
      };
    } catch (err) {
      setError((err as Error).message);
      setRunning(false);
    }
  }, [command, push, deployEnabled, deployCommand, worktree, repoId, where, onRefresh]);

  const stop = useCallback(() => {
    if (jobRef.current) void cancelPipeline(repoId, jobRef.current).catch(() => {});
  }, [repoId]);

  const downloadLog = () => {
    if (!log) return;
    const blob = new Blob([log.replace(/\x1b\[[0-9;]*m/g, '')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'pipeline.log';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex-1 flex overflow-hidden bg-surface-container-lowest font-sans select-none">
      {/* MAIN CONTAINER: Ribbon, Stages, Logs console */}
      <div className="flex-1 flex flex-col overflow-y-auto p-6 space-y-4">
        {/* Target Banner */}
        <div className="bg-secondary-container/10 border border-secondary/30 rounded-lg p-3 flex justify-between items-center text-xs font-mono shrink-0">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-secondary" />
            <span className="text-secondary font-bold">
              Tests run in <span className="text-on-surface">{where}</span>; commit → merge → bump → push → deploy land on main
            </span>
          </div>
          <span className="text-outline">
            {runners.length ? `${runners.length} runner${runners.length > 1 ? 's' : ''} detected` : 'no runner detected'}
          </span>
        </div>

        {/* Release Action Ribbon Form */}
        <section className="bg-surface-container-low border border-outline-variant rounded-lg p-4 shrink-0 shadow-sm">
          <div className="flex flex-wrap items-end gap-4">
            {/* Runner Select */}
            <div className="flex flex-col gap-1 text-xs">
              <label className="text-outline font-bold text-[9px] uppercase font-mono px-1">Runner</label>
              <div className="relative">
                <select
                  value={runners.find((r) => r.command === command)?.id ?? ''}
                  onChange={(e) => {
                    const r = runners.find((x) => x.id === e.target.value);
                    if (r) setCommand(r.command);
                  }}
                  disabled={running}
                  className="bg-surface-container-lowest border border-outline-variant rounded px-3 py-1.5 min-w-[170px] text-xs font-mono text-on-surface focus:border-primary focus:ring-0 cursor-pointer disabled:opacity-60"
                >
                  {runners.length === 0 && <option value="">no test runner detected</option>}
                  {runners.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                  {command && !runners.some((r) => r.command === command) && (
                    <option value="">custom</option>
                  )}
                </select>
              </div>
            </div>

            {/* Custom Command Input */}
            <div className="flex-1 flex flex-col gap-1 text-xs min-w-[240px]">
              <label className="text-outline font-bold text-[9px] uppercase font-mono px-1">Custom Command</label>
              <div className="flex items-center bg-surface-container-lowest border border-outline-variant rounded px-3 py-1.5 focus-within:border-primary transition-colors">
                <span className="text-secondary font-mono mr-2 font-bold">$</span>
                <input
                  type="text"
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  disabled={running}
                  spellCheck={false}
                  placeholder="test command, e.g. bash scripts/docker-test.sh"
                  className="bg-transparent border-none focus:ring-0 text-xs font-mono p-0 w-full focus:outline-none disabled:opacity-60"
                />
              </div>
            </div>

            {/* Push Checkbox */}
            <div className="flex items-center gap-2 pb-2 px-1">
              <input
                type="checkbox"
                id="push-origin-checkbox"
                checked={push}
                onChange={(e) => setPush(e.target.checked)}
                disabled={running}
                className="rounded border-outline-variant bg-surface text-primary focus:ring-primary h-4 w-4 cursor-pointer"
              />
              <label htmlFor="push-origin-checkbox" className="text-xs text-on-surface font-mono cursor-pointer select-none">
                Push to origin
              </label>
            </div>

            {/* Pipeline Trigger / Stop Button */}
            {running ? (
              <button
                onClick={stop}
                className="bg-error/90 text-on-surface px-5 py-2.5 rounded-lg font-mono text-xs font-bold flex items-center gap-2 hover:opacity-95 active:scale-95 transition-all shadow-lg"
              >
                <Square className="w-4 h-4" />
                <span>Stop</span>
              </button>
            ) : (
              <button
                onClick={() => void run()}
                disabled={!command.trim() || !repoId}
                className="bg-primary text-on-primary-container px-5 py-2.5 rounded-lg font-mono text-xs font-bold flex items-center gap-2 hover:opacity-95 active:scale-95 transition-all shadow-lg shadow-primary/5 disabled:opacity-60"
              >
                <Play className="w-4 h-4" />
                <span>Run Pipeline</span>
              </button>
            )}
          </div>

          {/* Deploy row — opt-in command that runs from main after push */}
          <div className="mt-4 pt-4 border-t border-outline-variant flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 px-1 shrink-0 cursor-pointer">
              <input
                type="checkbox"
                checked={deployEnabled}
                onChange={(e) => setDeployEnabled(e.target.checked)}
                disabled={running}
                className="rounded border-outline-variant bg-surface text-primary focus:ring-primary h-4 w-4 cursor-pointer"
              />
              <span className="text-xs text-on-surface font-mono select-none">Deploy after push</span>
            </label>

            {/* Detected deploy runner */}
            <div className="flex flex-col gap-1 text-xs shrink-0">
              <label className="text-outline font-bold text-[9px] uppercase font-mono px-1">Detected</label>
              <select
                value={deployRunners.find((r) => r.command === deployCommand)?.id ?? ''}
                onChange={(e) => {
                  const r = deployRunners.find((x) => x.id === e.target.value);
                  if (r) setDeployCommand(r.command);
                }}
                disabled={running || !deployEnabled}
                className="bg-surface-container-lowest border border-outline-variant rounded px-3 py-1.5 min-w-[160px] text-xs font-mono text-on-surface focus:border-primary focus:ring-0 cursor-pointer disabled:opacity-60"
              >
                {deployRunners.length === 0 && <option value="">no deploy command detected</option>}
                {deployRunners.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
                {deployCommand && !deployRunners.some((r) => r.command === deployCommand) && (
                  <option value="">custom</option>
                )}
              </select>
            </div>

            <div className="flex-1 flex flex-col gap-1 text-xs min-w-[240px]">
              <label className="text-outline font-bold text-[9px] uppercase font-mono px-1">
                Deploy command (runs in main)
              </label>
              <div
                className={`flex items-center bg-surface-container-lowest border border-outline-variant rounded px-3 py-1.5 focus-within:border-primary transition-colors ${
                  deployEnabled ? '' : 'opacity-50'
                }`}
              >
                <span className="text-tertiary font-mono mr-2 font-bold">$</span>
                <input
                  type="text"
                  value={deployCommand}
                  onChange={(e) => setDeployCommand(e.target.value)}
                  disabled={running || !deployEnabled}
                  spellCheck={false}
                  placeholder="e.g. npm run deploy · bash scripts/deploy.sh"
                  className="bg-transparent border-none focus:ring-0 text-xs font-mono p-0 w-full focus:outline-none disabled:opacity-60"
                />
              </div>
            </div>
          </div>
        </section>

        {/* Pipeline Stages Display Progress Bar */}
        <section className="bg-surface-container-low border border-outline-variant rounded-lg p-5 shrink-0 relative">
          <h2 className="text-[10px] text-outline font-mono font-bold uppercase mb-6">
            Pipeline Strategy: tests → commit → merge → bump → push → deploy
          </h2>

          <div className="relative flex justify-between items-center max-w-4xl mx-auto px-6">
            {/* Background progress bar line */}
            <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-outline-variant -translate-y-4 z-0"></div>

            {STEPS.map(({ key, label }) => {
              const status = steps[key];
              const isSuccess = status === 'ok';
              const isRunning = status === 'running';
              const isFailed = status === 'failed';
              const isSkipped = status === 'skipped';

              return (
                <div key={key} className="relative z-10 flex flex-col items-center gap-2">
                  <div
                    className={`w-8 h-8 rounded-full border-4 border-surface flex items-center justify-center transition-all ${
                      isSuccess
                        ? 'bg-secondary text-on-secondary shadow-[0_0_15px_rgba(78,222,163,0.35)]'
                        : isRunning
                          ? 'bg-primary text-on-primary animate-pulse shadow-[0_0_15px_rgba(59,130,246,0.35)]'
                          : isFailed
                            ? 'bg-error text-on-surface shadow-[0_0_15px_rgba(239,68,68,0.35)]'
                            : 'bg-surface-container-highest border-surface-container'
                    }`}
                  >
                    {isSuccess ? (
                      <Check className="w-4 h-4 stroke-[3px]" />
                    ) : isRunning ? (
                      <RotateCw className="w-3.5 h-3.5 animate-spin" />
                    ) : isFailed ? (
                      <X className="w-4 h-4 stroke-[3px]" />
                    ) : isSkipped ? (
                      <div className="w-3 h-0.5 bg-outline/55 rounded-full" />
                    ) : (
                      <div className="w-1.5 h-1.5 bg-outline/55 rounded-full" />
                    )}
                  </div>

                  <span
                    className={`text-[11px] font-mono font-bold ${
                      isSuccess
                        ? 'text-secondary'
                        : isRunning
                          ? 'text-primary'
                          : isFailed
                            ? 'text-error'
                            : 'text-on-surface-variant'
                    }`}
                  >
                    {label}
                  </span>
                  {details[key] && (
                    <span className="text-[9px] font-mono text-outline max-w-[120px] truncate" title={details[key]}>
                      {details[key]}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {error && (
          <div className="bg-error/10 border border-error/30 rounded-lg p-3 flex items-center gap-2 text-xs font-mono text-error shrink-0">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Terminal Logs Feed Console */}
        <section className="flex-1 bg-surface-container-lowest border border-outline-variant rounded-lg font-mono text-[11px] overflow-hidden flex flex-col min-h-[250px]">
          <div className="bg-surface-container-high px-4 py-2 border-b border-outline-variant flex items-center justify-between shrink-0 select-none">
            <div className="flex items-center gap-3">
              <div className="flex gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-error/30"></div>
                <div className="w-2.5 h-2.5 rounded-full bg-tertiary/30"></div>
                <div className="w-2.5 h-2.5 rounded-full bg-secondary/30"></div>
              </div>
              <span className="text-outline text-[10px] uppercase tracking-wider font-bold">Runner Output</span>
            </div>

            <div className="flex items-center gap-3 text-outline">
              <Download
                className={`w-3.5 h-3.5 ${log ? 'cursor-pointer hover:text-on-surface' : 'opacity-40'}`}
                onClick={downloadLog}
              />
              <X
                className={`w-3.5 h-3.5 ${log ? 'cursor-pointer hover:text-on-surface' : 'opacity-40'}`}
                onClick={() => !running && setLog('')}
              />
            </div>
          </div>

          <div
            ref={logRef}
            onScroll={(e) => {
              const el = e.currentTarget;
              stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
            }}
            className="p-4 overflow-y-auto flex-1 bg-[#0d0e12] leading-relaxed text-on-surface-variant whitespace-pre-wrap break-words"
          >
            {log ? (
              <AnsiText text={log} />
            ) : (
              <span className="text-outline">
                {running ? 'Waiting for runner output…' : 'Run the pipeline to stream output here.'}
              </span>
            )}
            {running && <span className="terminal-cursor" />}
          </div>
        </section>
      </div>

      {/* RIGHT SIDEBAR: Release metadata inspector panel */}
      <aside className="w-[320px] bg-surface-container border-l border-outline-variant p-4 flex flex-col gap-4 shrink-0">
        <h3 className="font-mono text-[10px] font-bold text-outline uppercase tracking-wider">Session Metadata</h3>

        <div className="space-y-3">
          {/* Environment / active worktree */}
          <div className="bg-surface-container-lowest border border-outline-variant p-3 rounded-lg">
            <div className="text-[9px] text-outline font-mono font-bold uppercase mb-1">Test Environment</div>
            <div className="flex items-center gap-2">
              <span
                className={`w-2 h-2 rounded-full ${running ? 'bg-primary animate-pulse' : 'bg-secondary'}`}
              ></span>
              <span className="text-xs text-on-surface font-semibold font-mono truncate">{where}</span>
            </div>
          </div>

          {/* Version bump (from the real bump step) */}
          <div className="bg-surface-container-lowest border border-outline-variant p-3 rounded-lg font-mono">
            <div className="text-[9px] text-outline font-bold uppercase mb-1">Version Bump</div>
            {details.bump ? (
              <div className="text-lg text-primary font-bold">{details.bump}</div>
            ) : (
              <div className="text-sm text-outline">Decided by Claude on bump</div>
            )}
          </div>

          {/* Step details as they land */}
          <div className="bg-surface-container-lowest border border-outline-variant p-3 rounded-lg font-mono">
            <div className="text-[9px] text-outline font-bold uppercase mb-2">Step Detail</div>
            <div className="space-y-1.5">
              {STEPS.map(({ key, label }) => (
                <div key={key} className="flex items-center justify-between gap-2 text-[10px]">
                  <span className="text-outline">{label}</span>
                  <span
                    className={`truncate max-w-[170px] text-right ${
                      steps[key] === 'ok'
                        ? 'text-secondary'
                        : steps[key] === 'failed'
                          ? 'text-error'
                          : steps[key] === 'running'
                            ? 'text-primary'
                            : 'text-on-surface-variant'
                    }`}
                    title={details[key] ?? steps[key]}
                  >
                    {details[key] ?? steps[key]}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Hint / status footer */}
        <div className="mt-auto">
          <div className="bg-primary-container/10 border border-primary/20 p-3.5 rounded-lg space-y-2">
            <div className="flex items-center gap-1.5 text-primary text-xs font-bold font-mono">
              <Sparkles className="w-4 h-4 text-primary" />
              <span>Pipeline</span>
            </div>
            <p className="text-[11px] text-on-surface-variant leading-relaxed font-mono">
              The bump step sends the merged diff to Claude, which picks major/minor/patch and writes the
              version into main&apos;s package.json.
            </p>
          </div>
        </div>
      </aside>
    </div>
  );
}
