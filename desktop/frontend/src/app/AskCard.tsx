import { t, type Lang } from "~/lib/i18n";
import type { Ask } from "~/lib/ask";

const LETTERS = "ABCDEFGH";

// AskCard is an agent's question with set answers. A click answers it; the
// last row hands over to the message box. Once answered it stays as a record.
export function AskCard({ ask, lang, open, onPick, onOther }: {
  ask: Ask;
  lang: Lang;
  // only the latest question can still be answered
  open: boolean;
  onPick: (option: string) => void;
  onOther: () => void;
}) {
  return (
    <div className={`ask-card${open ? "" : " closed"}`}>
      <strong>{ask.question}</strong>
      {ask.options.map((o, i) => (
        <button key={o} type="button" disabled={!open} onClick={() => onPick(o)}>
          <kbd>{LETTERS[i]}</kbd><span>{o}</span>
        </button>
      ))}
      {open && (
        <button type="button" className="other" onClick={onOther}>
          <kbd>{LETTERS[ask.options.length]}</kbd><span>{t("askOther", lang)}</span>
        </button>
      )}
    </div>
  );
}
