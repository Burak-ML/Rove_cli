import { markColor } from "~/lib/agentmark";

type Status = "running" | "done" | "error" | null;

interface Props {
  // the agent's stored color; seed picks one when it is empty
  color?: string;
  seed: string;
  size?: number;
  // a working agent looks ahead; one whose last run failed shows crossed eyes;
  // a finished one it has not been opened since keeps a small dot on the corner
  status?: Status;
  title?: string;
  // the agent is working out its answer: it looks up, sways, and thought dots rise
  thinking?: boolean;
  // the daemon cannot be reached: the robot goes grey and is struck through
  offline?: boolean;
}

// AgentMark draws an office agent's logo: the Rove robot in its color. It
// stands for the agent in the side list, the agent card, the settings and the
// chat header.
export function AgentMark({ color, seed, size = 22, status, title, thinking, offline }: Props) {
  return <MarkSvg color={markColor(color, seed)} size={size} status={status} title={title} thinking={thinking} offline={offline} />;
}

const LINE = "#16151D";
const GLOW = "#50E7F4";
const OFF_BODY = "#62626E";

// The robot on a 128×128 grid, from the Kayra robot SVG set. The eyes are
// separate groups so the stylesheet can switch between them: leaning at rest,
// upright while the agent works or the pointer is on it.
function Robot({ color, offline }: { color: string; offline?: boolean }) {
  const body = offline ? OFF_BODY : color;
  return (
    <>
      <path d="M46 39 L34 17 M82 39 L94 17" fill="none" stroke="#17151D" strokeWidth={8} strokeLinecap="round" />
      <path d="M46 39 L34 17 M82 39 L94 17" fill="none" stroke="#F1E3D3" strokeWidth={3.4} strokeLinecap="round" />
      <circle cx={33} cy={16} r={8.8} fill="#211B21" />
      <circle cx={95} cy={16} r={8.8} fill="#211B21" />
      <circle cx={33} cy={16} r={5.6} fill="#63E9F2" />
      <circle cx={95} cy={16} r={5.6} fill="#63E9F2" />
      <circle cx={31.3} cy={14.2} r={1.9} fill="white" />
      <circle cx={93.3} cy={14.2} r={1.9} fill="white" />
      <rect x={13} y={57} width={13} height={27} rx={6} fill={body} stroke={LINE} strokeWidth={4} />
      <rect x={102} y={57} width={13} height={27} rx={6} fill={body} stroke={LINE} strokeWidth={4} />
      <rect x={19} y={32} width={90} height={76} rx={21} fill={body} stroke={LINE} strokeWidth={4.4} />
      <path d="M31 42 Q36 37 48 37 H85" fill="none" stroke="white" opacity={0.5} strokeWidth={4} strokeLinecap="round" />
      <path d="M34 101 H89" stroke="#211923" opacity={0.17} strokeWidth={4} strokeLinecap="round" />
      <rect x={30} y={48} width={68} height={46} rx={11} fill="#19161D" />
      <path d="M39 54 H78" stroke="#F8F3F0" opacity={0.06} strokeWidth={3} strokeLinecap="round" />
      {offline ? (
        <>
          <g stroke="#A9ADBA" strokeWidth={5.5} strokeLinecap="round">
            <path d="M44 74 H57" />
            <path d="M73 74 H86" />
          </g>
          <path d="M78 85 L119 114" stroke="#111111" strokeWidth={8} strokeLinecap="round" />
          <path d="M79 85 L120 114" stroke="#A8A9B0" strokeWidth={4.5} strokeLinecap="round" />
        </>
      ) : (
        <>
          <g className="mark-idle" fill={GLOW}>
            <rect x={44} y={60} width={12} height={17} rx={5} transform="rotate(-34 50 68.5)" />
            <rect x={73} y={60} width={12} height={17} rx={5} transform="rotate(-34 79 68.5)" />
          </g>
          <g className="mark-open">
            <g className="mark-blink" fill={GLOW}>
              <rect x={45} y={65} width={12} height={17} rx={5} />
              <rect x={74} y={65} width={12} height={17} rx={5} />
            </g>
          </g>
          <g className="mark-error" stroke={GLOW} strokeWidth={5.6} strokeLinecap="round" fill="none">
            <path d="M45 65 L56 80 M56 65 L45 80" />
            <path d="M74 65 L85 80 M85 65 L74 80" />
          </g>
        </>
      )}
    </>
  );
}

export function MarkSvg({ color, size = 22, status, title, awake, thinking, offline }: { color: string; size?: number; status?: Status; title?: string; awake?: boolean; thinking?: boolean; offline?: boolean }) {
  const job = offline ? null : status;
  const pondering = thinking && !offline;
  return (
    <span className={`agent-mark${job ? ` ${job}` : ""}${awake ? " awake" : ""}${pondering ? " pondering" : ""}${offline ? " offline" : ""}`} style={{ width: size, height: size }} title={title} aria-hidden={title ? undefined : true}>
      <svg viewBox="0 0 128 128" width={size} height={size} shapeRendering="geometricPrecision">
        <Robot color={color} offline={offline} />
      </svg>
      {(job === "running" || job === "done") && <span className="agent-mark-dot" />}
      {pondering && <span className="mark-thought"><i /><i /><i /></span>}
    </span>
  );
}
