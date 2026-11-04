// An agent's question with set answers. Any model can write one, tools or
// not, as a block at the end of its reply (see persona.Identity):
//
//   ```ask
//   Nasıl bir konu istiyorsun?
//   - Birinci seçenek
//   - İkinci seçenek
//   ```
export type Ask = { question: string; options: string[] };

const FENCE = /(?:^|\n)```ask[ \t]*(?:\n([\s\S]*?))?(\n```[ \t]*\s*)?$/;

// splitAsk takes the block off a reply. While a reply is still being written
// the block is held back until it closes, so it never flashes up as code.
export function splitAsk(text: string): { body: string; ask: Ask | null } {
  const m = FENCE.exec(text);
  if (!m) return { body: text, ask: null };
  const body = text.slice(0, m.index).trimEnd();
  if (!m[2]) return { body, ask: null };
  const lines = (m[1] ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  const options = lines.filter((l) => /^[-*]\s+/.test(l)).map((l) => l.replace(/^[-*]\s+/, ""));
  const question = lines.filter((l) => !/^[-*]\s+/.test(l)).join(" ");
  if (!question || options.length < 2) return { body: text, ask: null };
  return { body, ask: { question, options } };
}
