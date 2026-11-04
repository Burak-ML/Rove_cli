import { useEffect, useState } from "react";
import { useDialog } from "~/hooks/useDialog";
import { defaultColor, MARK_COLORS } from "~/lib/agentmark";
import { t, type Lang } from "~/lib/i18n";
import { rpc } from "~/lib/rpc";
import type { AgentProfile } from "~/lib/types";
import { MarkSvg } from "./AgentMark";
import { Icon } from "./Icons";

export function ColorPick({ color, onPick }: { color: string; onPick: (c: string) => void }) {
  return (
    <div className="agent-create-colors">
      {MARK_COLORS.map((c) => (
        <button key={c} type="button" aria-label={c} aria-pressed={color === c} className={color === c ? "on" : ""} onClick={() => onPick(c)}>
          <span style={{ background: c }} />
        </button>
      ))}
    </div>
  );
}

// AgentCreate is how an agent comes to be: a name, which says what it is
// for, and a color. Everything else (prompt, model, permissions) has a working
// default and is changed later in Settings → Agent.
export function AgentCreate({ lang, onClose, onCreated }: {
  lang: Lang;
  onClose: () => void;
  onCreated: (p: AgentProfile) => void | Promise<void>;
}) {
  const sheet = useDialog<HTMLDivElement>();
  const [name, setName] = useState("");
  const [color, setColor] = useState(() => defaultColor(Math.random().toString(36)));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  const create = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setErr("");
    try {
      const p = await rpc<AgentProfile>("profile.upsert", { name: name.trim(), color, role: "developer" });
      window.dispatchEvent(new Event("rove:profiles"));
      window.dispatchEvent(new Event("rove:persona"));
      await onCreated(p);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop agent-create-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="agent-create" role="dialog" aria-modal="true" aria-label={t("ofCreateTitle", lang)} ref={sheet}>
        <header className="agent-create-head">
          <h2>{t("ofCreateTitle", lang)}</h2>
          <button type="button" className="tree-icon" title={t("close", lang)} onClick={onClose}>×</button>
        </header>
        <form className="agent-create-body" onSubmit={(e) => { e.preventDefault(); void create(); }}>
          <MarkSvg color={color} size={96} awake />
          <input autoFocus aria-label={t("ofName", lang)} value={name} placeholder={t("ofCreateNamePh", lang)} onChange={(e) => setName(e.target.value)} />
          <ColorPick color={color} onPick={setColor} />
          {err && <p className="prov-err">{err}</p>}
          <footer className="agent-create-foot">
            <button type="button" className="ghost" onClick={onClose}>{t("cancel", lang)}</button>
            <button type="submit" className="primary" disabled={!name.trim() || busy}>{busy ? "…" : t("ofCreateShort", lang)}</button>
          </footer>
        </form>
      </div>
    </div>
  );
}
