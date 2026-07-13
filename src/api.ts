import type {
  BrowseResult,
  CheckoutResult,
  Commit,
  CommitDetail,
  CreateWorktreeResult,
  DiffFile,
  GitStatusDetail,
  HealthInfo,
  Repo,
  ReposResponse,
  TestRunner,
  Worktree,
} from "../shared/types.ts";

export function fetchHealth(): Promise<HealthInfo> {
  return request<HealthInfo>("/api/health");
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

export function fetchRepos(): Promise<ReposResponse> {
  return request<ReposResponse>("/api/repos");
}

export function fetchStatus(id: string, worktree?: string | null): Promise<GitStatusDetail> {
  const qs = worktree ? `?worktree=${encodeURIComponent(worktree)}` : "";
  return request<GitStatusDetail>(`/api/repos/${encodeURIComponent(id)}/status${qs}`);
}

export async function fetchDiffs(id: string, worktree?: string | null): Promise<DiffFile[]> {
  const qs = worktree ? `?worktree=${encodeURIComponent(worktree)}` : "";
  const data = await request<{ files: DiffFile[] }>(
    `/api/repos/${encodeURIComponent(id)}/diff${qs}`,
  );
  return data.files;
}

export async function fetchWorktrees(id: string): Promise<Worktree[]> {
  const data = await request<{ worktrees: Worktree[] }>(
    `/api/repos/${encodeURIComponent(id)}/worktrees`,
  );
  return data.worktrees;
}

export async function fetchLog(id: string, limit = 30, all = false): Promise<Commit[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (all) params.set("all", "1");
  const data = await request<{ commits: Commit[] }>(
    `/api/repos/${encodeURIComponent(id)}/log?${params}`,
  );
  return data.commits;
}

export function fetchCommitDetail(
  id: string,
  hash: string,
  worktree?: string | null,
): Promise<CommitDetail> {
  const qs = worktree ? `?worktree=${encodeURIComponent(worktree)}` : "";
  return request<CommitDetail>(
    `/api/repos/${encodeURIComponent(id)}/commit/${encodeURIComponent(hash)}${qs}`,
  );
}

export function checkoutRef(
  id: string,
  ref: string,
  worktree: string | null,
): Promise<CheckoutResult> {
  return request<CheckoutResult>(`/api/repos/${encodeURIComponent(id)}/checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ref, worktree }),
  });
}

export function createWorktree(
  id: string,
  opts: { path: string; branch: string },
): Promise<CreateWorktreeResult> {
  return request<CreateWorktreeResult>(`/api/repos/${encodeURIComponent(id)}/worktrees`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
}

export type GraphStyle = "plain" | "pretty" | "forest";

export interface GraphOptions {
  style: GraphStyle;
  all: boolean;
  decorate: boolean;
  oneline: boolean;
  graph: boolean;
  limit: number;
}

export interface GraphResult {
  command: string;
  text: string;
  available: boolean;
  /** Only meaningful for the "forest" style: whether a git-foresta binary was found. */
  forestAvailable: boolean;
}

export function fetchGraph(
  id: string,
  opts: GraphOptions,
  worktree?: string | null,
): Promise<GraphResult> {
  const params = new URLSearchParams();
  params.set("style", opts.style);
  for (const flag of ["all", "decorate", "oneline", "graph"] as const) {
    if (opts[flag]) params.set(flag, "1");
  }
  params.set("limit", String(opts.limit));
  if (worktree) params.set("worktree", worktree);
  return request<GraphResult>(`/api/repos/${encodeURIComponent(id)}/graph?${params}`);
}

export async function setSelection(id: string | null): Promise<string | null> {
  const data = await request<{ selectedId: string | null }>("/api/selection", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  return data.selectedId;
}

export async function setWorktreeSelection(path: string | null): Promise<string | null> {
  const data = await request<{ selectedWorktree: string | null }>("/api/selection/worktree", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
  return data.selectedWorktree;
}

export interface CommitResult {
  ok: boolean;
  hash: string;
  subject: string;
  message: string;
}

export function commitChanges(
  id: string,
  worktree: string | null,
  message?: string,
): Promise<CommitResult> {
  return request<CommitResult>(`/api/repos/${encodeURIComponent(id)}/commit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ worktree, message }),
  });
}

/** Ask the server for an AI-suggested commit message without committing. */
export async function suggestCommitMessage(
  id: string,
  worktree: string | null,
): Promise<string> {
  const data = await request<{ message: string }>(
    `/api/repos/${encodeURIComponent(id)}/commit/message`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ worktree }),
    },
  );
  return data.message;
}

export interface PushResult {
  ok: boolean;
  branch: string;
  remote: string;
  detail: string;
}

export function pushToOrigin(id: string): Promise<PushResult> {
  return request<PushResult>(`/api/repos/${encodeURIComponent(id)}/push`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
}

export async function fetchTestRunners(id: string): Promise<TestRunner[]> {
  const data = await request<{ runners: TestRunner[] }>(
    `/api/repos/${encodeURIComponent(id)}/test-runners`,
  );
  return data.runners;
}

export async function startPipeline(
  id: string,
  opts: { command: string; push: boolean; worktree: string | null },
): Promise<string> {
  const data = await request<{ jobId: string }>(`/api/repos/${encodeURIComponent(id)}/pipeline`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
  return data.jobId;
}

export function pipelineStreamUrl(id: string, jobId: string): string {
  return `/api/repos/${encodeURIComponent(id)}/pipeline/${encodeURIComponent(jobId)}/stream`;
}

export function cancelPipeline(id: string, jobId: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(
    `/api/repos/${encodeURIComponent(id)}/pipeline/${encodeURIComponent(jobId)}/cancel`,
    { method: "POST" },
  );
}

export interface MergeResult {
  ok: boolean;
  source: string;
  target: string;
  alreadyUpToDate: boolean;
  message: string;
}

export function mergeWorktree(id: string, worktree: string): Promise<MergeResult> {
  return request<MergeResult>(`/api/repos/${encodeURIComponent(id)}/merge-worktree`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ worktree }),
  });
}

// Sync (merge main into) a worktree's branch — the inverse of mergeWorktree.
// Reuses MergeResult; `source` is the main branch, `target` the worktree branch.
export function syncWorktreeFromMain(id: string, worktree: string): Promise<MergeResult> {
  return request<MergeResult>(`/api/repos/${encodeURIComponent(id)}/sync-worktree`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ worktree }),
  });
}

export interface ExecResult {
  command: string;
  cwd: string;
  code: number;
  output: string;
}

/** Run a shell command in the repo/worktree dir (Terminal drawer). */
export function execCommand(
  id: string,
  command: string,
  worktree: string | null,
): Promise<ExecResult> {
  return request<ExecResult>(`/api/repos/${encodeURIComponent(id)}/exec`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ command, worktree }),
  });
}

export function browseDir(dirPath?: string): Promise<BrowseResult> {
  const qs = dirPath ? `?path=${encodeURIComponent(dirPath)}` : "";
  return request<BrowseResult>(`/api/browse${qs}`);
}

export async function addRepo(dirPath: string): Promise<Repo> {
  const data = await request<{ repo: Repo }>("/api/repos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: dirPath }),
  });
  return data.repo;
}
