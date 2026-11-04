import { SHAPE_PATH, SHAPE_STROKE, closedEyes, faceParts, markOf, type FacePart, type Mark } from "~/lib/agentmark";

interface Props {
  // the agent's stored mark and color; seed picks one when they are empty
  mark?: string;
  color?: string;
  seed: string;
  // the starting character: an unpicked shape follows its field
  character?: string;
  size?: number;
  // a small dot on the corner: the agent is working, or finished unseen
  status?: "running" | "done" | null;
  title?: string;
  // the agent is working out its answer: it looks up, sways, and thought dots rise
  thinking?: boolean;
}

// AgentMark draws an office agent's logo: its shape in its color with a
// small face, eyes closed at rest. It stands for the agent in the side list, the agent card,
// the settings and the chat header.
export function AgentMark({ mark, color, seed, character, size = 22, status, title, thinking }: Props) {
  const m = markOf(mark, color, seed, character);
  return <MarkSvg m={m} size={size} status={status} title={title} thinking={thinking} />;
}

const INK = "#000";

function Parts({ parts }: { parts: FacePart[] }) {
  return parts.map((p, i) =>
    p.kind === "circle" ? <circle key={i} cx={p.cx} cy={p.cy} r={p.r} fill={INK} />
      : <path key={i} d={p.d} fill="none" stroke={INK} strokeWidth={p.stroke} strokeLinecap="round" strokeLinejoin="round" />,
  );
}

// Both faces are drawn; the stylesheet shows the closed one until the agent
// works or the pointer is on it, then opens the eyes and sets them moving.
export function MarkSvg({ m, size = 22, status, title, awake, thinking }: { m: Mark; size?: number; status?: "running" | "done" | null; title?: string; awake?: boolean; thinking?: boolean }) {
  return (
    <span className={`agent-mark${status ? ` ${status}` : ""}${awake ? " awake" : ""}${thinking ? " pondering" : ""}`} style={{ width: size, height: size }} title={title} aria-hidden={title ? undefined : true}>
      <svg viewBox="0 0 32 32" width={size} height={size} shapeRendering="geometricPrecision">
        <path d={SHAPE_PATH[m.shape]} fill={m.color} stroke={m.color} strokeWidth={SHAPE_STROKE} strokeLinejoin="round" />
        <g className="mark-closed"><Parts parts={closedEyes(m.shape)} /></g>
        <g className="mark-open"><g className="mark-blink"><Parts parts={faceParts(m.shape, m.face)} /></g></g>
      </svg>
      {status && <span className="agent-mark-dot" />}
      {thinking && <span className="mark-thought"><i /><i /><i /></span>}
    </span>
  );
}
