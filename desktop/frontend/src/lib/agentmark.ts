// An office agent's logo: the Rove robot in the agent's color. The color is
// stored on the agent as a hex; an agent without one gets one picked from its
// id, so it keeps the same one everywhere.

// the colors a new agent picks from; any color saved before stays as it is
export const MARK_COLORS = [
  "#ffbf2f", "#ff557e", "#e7dbce", "#9865ef", "#ff5666",
  "#ff9848", "#48b5f7", "#6e84f6", "#ff79b1",
] as const;

// the muted colors agents were saved with before, each to the one that took
// its place
const OLD_COLORS: Record<string, string> = {
  "#e5735f": "#ef3340", "#e3a64a": "#ffb020", "#9cc461": "#a3e635", "#5cc79a": "#45c463", "#43b3a8": "#14c8b8",
  "#5aa3e0": "#2f7bff", "#7f95b5": "#8a4dff", "#dd7393": "#ff5fa2", "#cfae82": "#ff8a3d", "#9aa1ad": "#b8c0cc",
};

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// defaultColor is the color an agent gets before anyone picks one.
export function defaultColor(seed: string): string {
  return MARK_COLORS[(hash(seed || "agent") >>> 16) % MARK_COLORS.length];
}

// markColor reads a stored color, falling back to the agent's id.
export function markColor(color: string | undefined, seed: string): string {
  const c = (color ?? "").toLowerCase();
  return OLD_COLORS[c] ?? (/^#[0-9a-f]{6}$/.test(c) ? c : defaultColor(seed));
}
