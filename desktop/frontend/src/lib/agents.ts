import { splitAsk } from "./ask";
import { splitContext } from "./attachments";
import type { Message, PersonaBadge, Session } from "./types";

// The catalog characters picked for the sidebar before agents were made in
// the app: lib/office.ts turns them into agents, once.
const KEY = "aether.agents";

export function loadAgents(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "[]") as unknown;
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

// chatsByProfile groups office chats (most recent first, as listed) under
// the office agent — the profile — each one talks to.
export function chatsByProfile(sessions: Session[], badgeFor: (id: string) => PersonaBadge | null): Map<string, Session[]> {
  const out = new Map<string, Session[]>();
  for (const s of sessions) {
    const p = badgeFor(s.id)?.profileId;
    if (!p) continue;
    const list = out.get(p);
    if (list) list.push(s);
    else out.set(p, [s]);
  }
  return out;
}

// The agents pinned above the Agent space's list, in pin order.
const PINS_KEY = "rove.agents.pinned";

export function loadPins(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(PINS_KEY) || "[]") as unknown;
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function savePins(ids: string[]) {
  try { localStorage.setItem(PINS_KEY, JSON.stringify(ids)); } catch { /* private */ }
}

// chatPreview is what an agent's row shows under its name: the first line of
// the last thing said in the chat, without its markdown.
export function chatPreview(messages: Message[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if ((m.role !== "user" && m.role !== "assistant") || m.kind === "summary") continue;
    const asked = splitAsk(m.content);
    const text = m.role === "user" ? splitContext(m.content).text : asked.body || asked.ask?.question || "";
    const line = text.split("\n")
      .map((l) => l.replace(/^[\s#>*-]+/, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*`~]/g, "").trim())
      .find(Boolean);
    if (line) return line;
  }
  return "";
}
