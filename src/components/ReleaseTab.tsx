import { useCallback, useEffect, useRef, useState } from "react";
import type { PipelineEvent, PipelineStep, StepStatus, TestRunner } from "../../shared/types.ts";
import {
  cancelPipeline,
  fetchTestRunners,
  pipelineStreamUrl,
  startPipeline,
} from "../api.ts";
import { AnsiText } from "./AnsiText.tsx";

const STEPS: { key: PipelineStep; label: string }[] = [
  { key: "tests", label: "Tests" },
  { key: "commit", label: "Commit" },
  { key: "merge", label: "Merge" },
  { key: "bump", label: "Bump" },
  { key: "push", label: "Push" },
];

const STATUS_ICON: Record<StepStatus, string> = {
  pending: "•",
  running: "▶",
  ok: "✓",
  failed: "✗",
  skipped: "–",
};

const emptySteps = (): Record<PipelineStep, StepStatus> => ({
  tests: "pending",
  commit: "pending",
  merge: "pending",
  bump: "pending",
  push: "pending",
});

export function ReleaseTab({
  repoId,
  reloadKey,
  worktree,
  onRefresh,
}: {
  repoId: string;
  reloadKey: number;
  worktree: string | null;
  onRefresh: () => void;
}) {
  const [runners, setRunners] = useState<TestRunner[]>([]);
  const [command, setCommand] = useState("");
  const [push, setPush] = useState(true);

  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<Record<PipelineStep, StepStatus>>(emptySteps);
  const [log, setLog] = useState("");
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const jobRef = useRef<string | null>(null);
  const logRef = useRef<HTMLPreElement>(null);
  const stickRef = useRef(true); // follow the tail unless the user scrolls up

  // Keep the console pinned to the newest output (git steps land after the test log).
  useEffect(() => {
    const el = logRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [log]);

  // Detect runners on repo change; default the command to the strongest candidate.
  useEffect(() => {
    let cancelled = false;
    fetchTestRunners(repoId)
      .then((rs) => {
        if (cancelled) return;
        setRunners(rs);
        setCommand((c) => c || rs[0]?.command || "");
      })
      .catch((err) => !cancelled && setError((err as Error).message));
    return () => {
      cancelled = true;
    };
  }, [repoId, reloadKey]);

  // Tear down the stream on unmount / repo change.
  useEffect(() => {
    return () => {
      esRef.current?.close();
      esRef.current = null;
    };
  }, [repoId]);

  const run = useCallback(async () => {
    const cmd = command.trim();
    if (!cmd) return;
    const where = worktree ? worktree.split("/").pop() : "main";
    if (
      !window.confirm(
        `Run the release pipeline?\n\n` +
          `1. Tests (in ${where}):  ${cmd}\n` +
          `2. AI commit in the worktree\n` +
          `3. Merge into main\n` +
          `4. Bump package.json in main (Claude decides major/minor/patch)\n` +
          `5. ${push ? "Push main to origin" : "(skip push)"}\n\n` +
          `Step 1 executes this command locally.`,
      )
    ) {
      return;
    }
    setRunning(true);
    setError(null);
    setSteps(emptySteps());
    setLog("");
    try {
      const jobId = await startPipeline(repoId, { command: cmd, push, worktree });
      jobRef.current = jobId;
      const es = new EventSource(pipelineStreamUrl(repoId, jobId));
      esRef.current = es;
      es.onmessage = (e) => {
        const ev = JSON.parse(e.data) as PipelineEvent;
        if (ev.type === "log") setLog((l) => l + ev.text);
        else if (ev.type === "step") setSteps((s) => ({ ...s, [ev.step]: ev.status }));
        else if (ev.type === "error") setError(ev.message);
        else if (ev.type === "done") {
          setRunning(false);
          if (ev.ok) onRefresh();
        }
      };
      es.addEventListener("end", () => {
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
  }, [command, push, worktree, repoId, onRefresh]);

  const stop = useCallback(() => {
    if (jobRef.current) void cancelPipeline(repoId, jobRef.current).catch(() => {});
  }, [repoId]);

  return (
    <div className="release">
      <div className="release__setup">
        <label className="release__row">
          <span className="muted">runner</span>
          <select
            value={runners.find((r) => r.command === command)?.id ?? ""}
            onChange={(e) => {
              const r = runners.find((x) => x.id === e.target.value);
              if (r) setCommand(r.command);
            }}
            disabled={running}
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
        </label>
        <input
          className="release__cmd"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder="test command, e.g. bash scripts/docker-test.sh"
          disabled={running}
          spellCheck={false}
        />
        <label className="release__push">
          <input
            type="checkbox"
            checked={push}
            onChange={(e) => setPush(e.target.checked)}
            disabled={running}
          />
          push to origin
        </label>
        {running ? (
          <button className="btn btn--sm" onClick={stop}>
            Stop
          </button>
        ) : (
          <button className="btn btn--sm btn--primary" onClick={() => void run()} disabled={!command.trim()}>
            Run pipeline
          </button>
        )}
      </div>

      <div className="release__steps">
        {STEPS.map(({ key, label }) => (
          <span key={key} className={`release__step release__step--${steps[key]}`}>
            <span className="release__stepicon">{STATUS_ICON[steps[key]]}</span> {label}
          </span>
        ))}
      </div>

      {error && <div className="banner banner--error">{error}</div>}

      {(log || running) && (
        <pre
          ref={logRef}
          className="graph-output release__log"
          onScroll={(e) => {
            const el = e.currentTarget;
            stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
          }}
        >
          <AnsiText text={log} />
        </pre>
      )}
    </div>
  );
}
