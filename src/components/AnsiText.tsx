import { Fragment, type CSSProperties } from "react";

// Basic SGR (Select Graphic Rendition) colors mapped to theme-friendly hex.
const FG: Record<number, string> = {
  30: "#4b5263",
  31: "#e06c75", // red
  32: "#98c379", // green
  33: "#e5c07b", // yellow
  34: "#61afef", // blue
  35: "#c678dd", // magenta
  36: "#56b6c2", // cyan
  37: "#c8ccd4", // white
  90: "#6b7280",
  91: "#ff7b86",
  92: "#b5e08e",
  93: "#f0d399",
  94: "#8cc4ff",
  95: "#d99aec",
  96: "#79d0db",
  97: "#ffffff",
};

interface SgrState {
  color?: string;
  bold?: boolean;
  dim?: boolean;
}

/** Apply one SGR escape's numeric codes to the running style state. */
function applyCodes(state: SgrState, codes: number[]): SgrState {
  let next = { ...state };
  for (const code of codes) {
    if (code === 0) next = {};
    else if (code === 1) next.bold = true;
    else if (code === 2) next.dim = true;
    else if (code === 22) {
      next.bold = false;
      next.dim = false;
    } else if (code === 39) next.color = undefined;
    else if (FG[code]) next.color = FG[code];
  }
  return next;
}

function toStyle(state: SgrState): CSSProperties {
  return {
    color: state.color,
    fontWeight: state.bold ? 700 : undefined,
    opacity: state.dim ? 0.6 : undefined,
  };
}

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[([0-9;]*)m/g;

/** Render a string containing ANSI SGR color escapes as styled <span>s. */
export function AnsiText({ text }: { text: string }) {
  const parts: { text: string; style: CSSProperties }[] = [];
  let state: SgrState = {};
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  ANSI_RE.lastIndex = 0;
  while ((match = ANSI_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ text: text.slice(lastIndex, match.index), style: toStyle(state) });
    }
    const codes = match[1] === "" ? [0] : match[1].split(";").map(Number);
    state = applyCodes(state, codes);
    lastIndex = ANSI_RE.lastIndex;
  }
  if (lastIndex < text.length) {
    parts.push({ text: text.slice(lastIndex), style: toStyle(state) });
  }

  return (
    <>
      {parts.map((p, i) => (
        <span key={i} style={p.style}>
          {p.text}
        </span>
      ))}
      {parts.length === 0 && <Fragment>{text}</Fragment>}
    </>
  );
}
