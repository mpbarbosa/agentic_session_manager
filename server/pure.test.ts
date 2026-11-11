import { describe, it, expect } from "vitest";
import {
  uniqueId,
  parseBranchLine,
  parseWorktrees,
  nextVersion,
  bumpVersionInPackageJson,
  authMessage,
  selectTestRunners,
  pickDefaultBranch,
  type RunnerDetectionInput,
  parseLastCommit,
  LAST_COMMIT_SEP,
  LAST_COMMIT_FORMAT,
  worktreePathFromGitdir,
  commonGitDirFromGitFile,
} from "./pure.ts";

describe("uniqueId", () => {
  it("slugifies to lowercase kebab-case", () => {
    expect(uniqueId("My Cool Repo!", new Set())).toBe("my-cool-repo");
  });

  it("falls back to 'repo' when nothing slugifiable", () => {
    expect(uniqueId("!!!", new Set())).toBe("repo");
    expect(uniqueId("", new Set())).toBe("repo");
  });

  it("suffixes -2, -3 … on collision", () => {
    expect(uniqueId("app", new Set(["app"]))).toBe("app-2");
    expect(uniqueId("app", new Set(["app", "app-2"]))).toBe("app-3");
  });
});

describe("parseBranchLine", () => {
  it("parses branch + upstream", () => {
    expect(parseBranchLine("## main...origin/main")).toEqual({
      branch: "main",
      upstream: "origin/main",
      ahead: 0,
      behind: 0,
    });
  });

  it("parses ahead/behind tracking counts", () => {
    expect(parseBranchLine("## main...origin/main [ahead 2, behind 1]")).toEqual({
      branch: "main",
      upstream: "origin/main",
      ahead: 2,
      behind: 1,
    });
    expect(parseBranchLine("## dev...origin/dev [ahead 5]")).toMatchObject({ ahead: 5, behind: 0 });
    expect(parseBranchLine("## dev...origin/dev [behind 3]")).toMatchObject({ ahead: 0, behind: 3 });
  });

  it("handles a branch with no upstream", () => {
    expect(parseBranchLine("## feature/x")).toEqual({
      branch: "feature/x",
      upstream: null,
      ahead: 0,
      behind: 0,
    });
  });

  it("surfaces the real branch on a fresh repo", () => {
    expect(parseBranchLine("## No commits yet on main")).toMatchObject({
      branch: "main",
      upstream: null,
    });
  });
});

describe("parseWorktrees", () => {
  it("parses a single main worktree and strips refs/heads/", () => {
    const [wt] = parseWorktrees("worktree /repo\nHEAD abc123\nbranch refs/heads/main\n");
    expect(wt).toMatchObject({ path: "/repo", head: "abc123", branch: "main", isMain: true });
  });

  it("marks only the first block as main", () => {
    const out = parseWorktrees(
      "worktree /repo\nHEAD a\nbranch refs/heads/main\n\nworktree /repo/wt\nHEAD b\nbranch refs/heads/feat\n",
    );
    expect(out.map((w) => [w.branch, w.isMain])).toEqual([
      ["main", true],
      ["feat", false],
    ]);
  });

  it("captures detached / bare / locked / prunable flags", () => {
    const [det] = parseWorktrees("worktree /a\nHEAD a\ndetached\n");
    expect(det).toMatchObject({ detached: true, branch: null });

    const [locked] = parseWorktrees("worktree /a\nHEAD a\nbranch refs/heads/x\nlocked in use\n");
    expect(locked).toMatchObject({ locked: true, lockedReason: "in use" });

    const [prune] = parseWorktrees("worktree /a\nHEAD a\nprunable gitdir gone\n");
    expect(prune.prunable).toBe(true);
  });

  it("returns [] for empty input", () => {
    expect(parseWorktrees("")).toEqual([]);
  });
});

describe("nextVersion", () => {
  it("bumps patch / minor / major", () => {
    expect(nextVersion("1.2.3", "patch")).toBe("1.2.4");
    expect(nextVersion("1.2.3", "minor")).toBe("1.3.0");
    expect(nextVersion("1.2.3", "major")).toBe("2.0.0");
  });

  it("drops prerelease/build suffixes", () => {
    expect(nextVersion("1.2.3-beta.1", "patch")).toBe("1.2.4");
    expect(nextVersion("0.9.0+build7", "minor")).toBe("0.10.0");
  });

  it("throws on an unparseable version", () => {
    expect(() => nextVersion("not-a-version", "patch")).toThrow();
  });
});

describe("bumpVersionInPackageJson", () => {
  it("replaces only the version field and preserves formatting", () => {
    const raw = '{\n  "name": "x",\n  "version": "1.4.0",\n  "dependencies": { "y": "1.4.0" }\n}\n';
    const { from, to, text } = bumpVersionInPackageJson(raw, "minor");
    expect(from).toBe("1.4.0");
    expect(to).toBe("1.5.0");
    expect(text).toContain('"version": "1.5.0"');
    expect(text).toContain('"y": "1.4.0"'); // dependency version untouched
  });

  it("throws when there is no version field", () => {
    expect(() => bumpVersionInPackageJson('{"name":"x"}', "patch")).toThrow(/no "version" field/);
  });
});

describe("authMessage", () => {
  it("maps HTTP 401 to the credentials hint", () => {
    expect(authMessage({ status: 401, message: "boom" })).toMatch(/No Anthropic credentials/);
  });

  it("maps credential-ish messages to the hint", () => {
    expect(authMessage(new Error("missing ANTHROPIC_API_KEY"))).toMatch(/No Anthropic credentials/);
    expect(authMessage(new Error("no authentication method"))).toMatch(/No Anthropic credentials/);
  });

  it("passes through unrelated errors verbatim", () => {
    expect(authMessage(new Error("network unreachable"))).toBe("network unreachable");
  });
});

describe("selectTestRunners", () => {
  const base: RunnerDetectionInput = {
    dockerScriptFiles: [],
    scripts: {},
    ecoFiles: [],
    makefileHasTest: false,
  };

  it("returns [] when nothing is detectable (the 'no runner detected' case)", () => {
    expect(selectTestRunners(base)).toEqual([]);
  });

  it("detects an npm test script", () => {
    const [r] = selectTestRunners({ ...base, scripts: { test: "vitest run" } });
    expect(r).toMatchObject({ kind: "npm", command: "npm run test", confidence: 60 });
  });

  it("ranks docker scripts highest and sorts by confidence", () => {
    const runners = selectTestRunners({
      ...base,
      dockerScriptFiles: ["scripts/docker-test.sh"],
      scripts: { test: "x", "test:ci": "y" },
      ecoFiles: ["go.mod"],
      makefileHasTest: true,
    });
    expect(runners.map((r) => r.confidence)).toEqual([100, 65, 60, 45, 40]);
    expect(runners[0]).toMatchObject({ command: "bash scripts/docker-test.sh" });
  });

  it("detects a docker-shelling npm script at confidence 90", () => {
    const runners = selectTestRunners({ ...base, scripts: { "test:docker": "docker run ..." } });
    expect(runners.some((r) => r.confidence === 90 && r.command === "npm run test:docker")).toBe(true);
  });

  it("adds one Python runner per present marker file", () => {
    const runners = selectTestRunners({ ...base, ecoFiles: ["pytest.ini", "pyproject.toml"] });
    expect(runners.filter((r) => r.command === "pytest")).toHaveLength(2);
  });
});

describe("pickDefaultBranch", () => {
  it("prefers origin/HEAD", () => {
    expect(pickDefaultBranch("origin/main", new Set(), "x")).toBe("main");
    expect(pickDefaultBranch("origin/develop", new Set(["main"]), "x")).toBe("develop");
  });

  it("falls back to a local main, then master", () => {
    expect(pickDefaultBranch(null, new Set(["main", "master"]), "x")).toBe("main");
    expect(pickDefaultBranch(null, new Set(["master"]), "x")).toBe("master");
  });

  it("falls back to the given fallback when nothing matches", () => {
    expect(pickDefaultBranch(null, new Set(), "feature/z")).toBe("feature/z");
    expect(pickDefaultBranch("", new Set(), "feature/z")).toBe("feature/z");
  });
});

describe("parseLastCommit", () => {
  it("splits the packed git log line into hash, subject, ISO date and relative date", () => {
    const raw = ["abc1234", "fix: the thing", "2026-01-02T03:04:05-03:00", "2 days ago"].join(
      LAST_COMMIT_SEP,
    );
    expect(parseLastCommit(raw)).toEqual({
      lastCommit: "abc1234 fix: the thing",
      lastCommitSubject: "fix: the thing",
      lastCommitDate: "2026-01-02T03:04:05-03:00",
      lastCommitRelative: "2 days ago",
    });
  });

  it("keeps a subject containing the separator-free punctuation git normally emits", () => {
    const raw = ["ff00aa", "feat(api): add --all flag, fix #12", "2026-01-02T00:00:00Z", "1 hour ago"].join(
      LAST_COMMIT_SEP,
    );
    expect(parseLastCommit(raw).lastCommitSubject).toBe("feat(api): add --all flag, fix #12");
  });

  it("yields all nulls for a repo with no commits (git prints nothing)", () => {
    const empty = {
      lastCommit: null,
      lastCommitSubject: null,
      lastCommitDate: null,
      lastCommitRelative: null,
    };
    expect(parseLastCommit(null)).toEqual(empty);
    expect(parseLastCommit("")).toEqual(empty);
  });

  it("survives a truncated line rather than inventing fields", () => {
    expect(parseLastCommit("abc1234")).toEqual({
      lastCommit: "abc1234",
      lastCommitSubject: null,
      lastCommitDate: null,
      lastCommitRelative: null,
    });
  });

  it("uses a format string that matches what it parses", () => {
    expect(LAST_COMMIT_FORMAT.split(LAST_COMMIT_SEP)).toEqual(["%h", "%s", "%cI", "%cr"]);
  });
});

describe("worktreePathFromGitdir", () => {
  it("strips the trailing /.git to yield the worktree directory", () => {
    expect(worktreePathFromGitdir("/home/u/proj/.worktrees/feat/.git\n")).toBe(
      "/home/u/proj/.worktrees/feat",
    );
  });

  it("returns null for empty or pathless contents", () => {
    expect(worktreePathFromGitdir("")).toBeNull();
    expect(worktreePathFromGitdir("   \n")).toBeNull();
    expect(worktreePathFromGitdir(".git")).toBeNull();
  });
});

describe("commonGitDirFromGitFile", () => {
  it("resolves the shared git dir from a linked worktree's .git file", () => {
    expect(commonGitDirFromGitFile("gitdir: /home/u/proj/.git/worktrees/feat\n")).toBe(
      "/home/u/proj/.git",
    );
  });

  it("tolerates extra whitespace and a trailing slash", () => {
    expect(commonGitDirFromGitFile("gitdir:   /home/u/proj/.git/worktrees/feat/  ")).toBe(
      "/home/u/proj/.git",
    );
  });

  it("returns null for a submodule pointer, which is not a worktree", () => {
    expect(commonGitDirFromGitFile("gitdir: ../.git/modules/vendor")).toBeNull();
  });

  it("returns null for anything that is not a gitdir pointer", () => {
    expect(commonGitDirFromGitFile("")).toBeNull();
    expect(commonGitDirFromGitFile("ref: refs/heads/main")).toBeNull();
  });
});
