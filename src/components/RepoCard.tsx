import type { Repo } from "../../shared/types.ts";

interface Props {
  repo: Repo;
  selected: boolean;
  onSelect: () => void;
}

export function RepoCard({ repo, selected, onSelect }: Props) {
  const { status } = repo;
  const stateLabel = !status.available
    ? "unavailable"
    : status.dirtyCount > 0
      ? `${status.dirtyCount} changed`
      : "clean";
  const stateClass = !status.available
    ? "dot--gray"
    : status.dirtyCount > 0
      ? "dot--amber"
      : "dot--green";

  return (
    <button
      type="button"
      className={`repo-card${selected ? " repo-card--selected" : ""}`}
      onClick={onSelect}
      aria-pressed={selected}
    >
      <div className="repo-card__top">
        <span className="repo-card__name">{repo.name}</span>
        <span className={`dot ${stateClass}`} title={stateLabel} />
      </div>

      {repo.description && <p className="repo-card__desc">{repo.description}</p>}

      <dl className="repo-card__meta">
        <div>
          <dt>Branch</dt>
          <dd>{status.branch ?? "—"}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{stateLabel}</dd>
        </div>
        <div>
          <dt>Worktrees</dt>
          <dd>{status.available ? status.worktrees.length : "—"}</dd>
        </div>
      </dl>

      {status.lastCommit && (
        <p className="repo-card__commit" title="Latest commit">
          {status.lastCommit}
        </p>
      )}
      {repo.path && <p className="repo-card__path">{repo.path}</p>}
    </button>
  );
}
