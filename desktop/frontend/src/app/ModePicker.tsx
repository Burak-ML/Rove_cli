import { useEffect, useRef } from "react";
import { t, type Lang } from "~/lib/i18n";
import { CHAT_MODES, type ChatMode } from "~/lib/spaces";
import type { Workspace } from "~/lib/types";
import { Icon } from "./Icons";

// The icon each mode goes by, wherever a mode is named.
export const MODE_ICON: Record<ChatMode, "orchestra" | "terminal"> = {
  orchestra: "orchestra",
  terminal: "terminal",
};

type Props = {
  lang: Lang;
  workspace: Workspace | null;
  // the mode used most recently, marked so the usual pick is one glance away
  last?: ChatMode;
  onPick: (mode: ChatMode) => void;
};

// ModePicker is where a session starts: the mode it will run in is chosen
// here, once. A conversation, a plan and a terminal deck keep different
// state, so the mode stays with the session for good.
export function ModePicker({ lang, workspace, last, onPick }: Props) {
  const first = useRef<HTMLButtonElement | null>(null);

  // 1, 2, 3 pick a mode straight away
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      const n = Number(e.key);
      if (n >= 1 && n <= CHAT_MODES.length) {
        e.preventDefault();
        onPick(CHAT_MODES[n - 1]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onPick]);

  useEffect(() => { first.current?.focus({ preventScroll: true }); }, []);

  return (
    <div className="mode-picker">
      <div className="mode-picker-inner">
        <h1>{t("newSessionTitle", lang)}</h1>
        <div className="mode-list" role="list">
          {CHAT_MODES.map((m, i) => (
            <button key={m} type="button" role="listitem" ref={i === 0 ? first : undefined} className="mode-row" onClick={() => onPick(m)}>
              <Icon name={MODE_ICON[m]} size={18} />
              <span className="mode-row-text">
                <strong>{t(`mode_${m}`, lang)}</strong>
                <span>{t(`modeHint_${m}`, lang)}</span>
              </span>
              {last === m && <span className="mode-row-tag">{t("modeLastUsed", lang)}</span>}
            </button>
          ))}
        </div>
        <p className="mode-picker-note" title={workspace?.path}>
          {workspace ? `${workspace.name} · ` : ""}{t("modeFixedNote", lang)}
        </p>
      </div>
    </div>
  );
}
