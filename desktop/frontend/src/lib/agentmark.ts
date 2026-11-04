// An office agent's logo: a shape, a small face on it and a color. Stored
// on the agent as "shape:face" plus a hex color; an agent without one gets
// a mark picked from its id, so it keeps the same one everywhere.

export const SHAPES = ["squircle", "circle", "hex", "tri", "drop", "diamond", "shield", "octa"] as const;
// faces are a pair of eyes: tall, round, or smiling. They show open while the
// agent works or the pointer is on it; otherwise they are closed, two
// sleeping arcs (see closedEyes). A stored face that is not one of these (the old prompt faces)
// reads as the default.
export const FACES = ["eyes", "dots", "happy"] as const;
export type Shape = (typeof SHAPES)[number];
export type Face = (typeof FACES)[number];

// vivid, told apart at a glance, readable with a dark face on top
export const MARK_COLORS = [
  "#ef3340", "#ffb020", "#a3e635", "#45c463", "#14c8b8",
  "#2f7bff", "#8a4dff", "#ff5fa2", "#ff8a3d", "#b8c0cc",
] as const;

// the muted colors agents were saved with before, each to the one that took
// its place
const OLD_COLORS = ["#e5735f", "#e3a64a", "#9cc461", "#5cc79a", "#43b3a8", "#5aa3e0", "#7f95b5", "#dd7393", "#cfae82", "#9aa1ad"];

export type Mark = { shape: Shape; face: Face; color: string };

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// What an expert looks like before anyone picks: the shape says the field
// (the shield is security's alone), the face is a pair of eyes, the
// color comes from the agent's id so two agents of one field differ.
const SHAPE_FOR: Record<string, Shape> = {
  security: "shield",
  frontend: "squircle", mobile: "squircle", uiux: "squircle",
  "go-backend": "hex", python: "hex",
  architect: "circle",
  database: "octa", "data-ml": "octa",
  devops: "diamond", performance: "diamond",
  qa: "tri", debugger: "tri", reviewer: "tri",
  product: "drop", writer: "drop", marketing: "drop",
};
const FREE_SHAPES = SHAPES.filter((s) => s !== "shield");

// defaultMark is the mark an agent gets before anyone picks one.
export function defaultMark(seed: string, character?: string): Mark {
  const h = hash(seed || "agent");
  return {
    shape: (character && SHAPE_FOR[character]) || FREE_SHAPES[h % FREE_SHAPES.length],
    face: "eyes",
    color: MARK_COLORS[(h >>> 16) % MARK_COLORS.length],
  };
}

// markOf reads a stored mark, filling what is missing or unknown from the
// agent's id and starting character.
export function markOf(stored: string | undefined, color: string | undefined, seed: string, character?: string): Mark {
  const d = defaultMark(seed, character);
  const [s, f] = (stored ?? "").split(":");
  const old = OLD_COLORS.indexOf((color ?? "").toLowerCase());
  return {
    shape: (SHAPES as readonly string[]).includes(s) ? (s as Shape) : d.shape,
    face: (FACES as readonly string[]).includes(f) ? (f as Face) : d.face,
    color: old >= 0 ? MARK_COLORS[old] : /^#[0-9a-f]{6}$/i.test(color ?? "") ? color! : d.color,
  };
}

export const markString = (m: Mark) => `${m.shape}:${m.face}`;

// Shapes on a 32×32 grid: soft and a little tilted, none quite regular. Each
// is drawn inset and stroked thickly in its own color with round joins, which
// is what rounds the corners. "octa" has become a lumpy cloud of circles.
export const SHAPE_STROKE = 6;
export const SHAPE_PATH: Record<Shape, string> = {
  squircle: "M26.1 22.5L9.5 26.1L5.9 9.5L22.5 5.9z",
  circle: "M16 5.5a10.5 10.5 0 1 1 0 21.0a10.5 10.5 0 1 1 0 -21.0z",
  hex: "M26.2 18.5L18.9 26.1L8.7 23.6L5.8 13.5L13.1 5.9L23.3 8.4z",
  tri: "M9.5 6.5L26.0 15.5L9.0 25.5z",
  drop: "M11.5 6.5C16 7 25.5 11.5 25 18c-.3 4.5-4.5 7.5-9.5 7.5C10.5 25.5 7 22 7 17c0-4 1.5-10.8 4.5-10.5z",
  diamond: "M15.0 5.5L26.5 14.0L17.5 26.5L5.5 18.0z",
  shield: "M16 6.5l9 2.5v6.5c0 5-3.6 8.2-9 10c-5.4-1.8-9-5-9-10V9z",
  octa: "M11.5 7.5a5.5 5.5 0 1 1 0 11.0a5.5 5.5 0 1 1 0 -11.0z M19.5 6.5a5 5 0 1 1 0 10a5 5 0 1 1 0 -10z M22.5 13.5a4.5 4.5 0 1 1 0 9.0a4.5 4.5 0 1 1 0 -9.0z M12.5 15.0a5.5 5.5 0 1 1 0 11.0a5.5 5.5 0 1 1 0 -11.0z M17 11a6 6 0 1 1 0 12a6 6 0 1 1 0 -12z",
};

// where the eyes sit: up and to the right of the middle, so the agent looks
// off to one side
const EYE_AT: Record<Shape, [number, number]> = {
  squircle: [17.5, 14], circle: [18, 13.5], hex: [17.5, 14], tri: [16, 14.5],
  drop: [17.5, 15], diamond: [16.5, 14.5], shield: [16.5, 14], octa: [17.5, 14.5],
};
const EYE_GAP = 3.3; // half the distance between the eyes

export type FacePart = { kind: "circle"; cx: number; cy: number; r: number } | { kind: "path"; d: string; stroke: number };

const eyesOf = (shape: Shape) => {
  const [x, y] = EYE_AT[shape];
  return [[x - EYE_GAP, y + 0.7], [x + EYE_GAP, y - 0.7]];
};

// closedEyes is every face at rest: two sleeping arcs where the eyes sit.
export function closedEyes(shape: Shape): FacePart[] {
  return eyesOf(shape).map(([x, y]) => ({ kind: "path", d: `M${x - 2.2} ${y - 0.6} q2.2 2.8 4.4 0`, stroke: 1.9 }));
}

export function faceParts(shape: Shape, face: Face): FacePart[] {
  const eyes = eyesOf(shape);
  switch (face) {
    case "eyes": // thin and leaning
      return eyes.map(([x, y]) => ({ kind: "path", d: `M${x - 0.8} ${y - 1.9} L${x + 0.8} ${y + 1.9}`, stroke: 2.3 }));
    case "dots":
      return eyes.map(([x, y]) => ({ kind: "circle", cx: x, cy: y, r: 1.9 }));
    case "happy":
      return eyes.map(([x, y]) => ({ kind: "path", d: `M${x - 2.2} ${y + 0.8} q2.2 -2.8 4.4 0`, stroke: 1.9 }));
  }
}
