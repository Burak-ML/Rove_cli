import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useDialog } from "~/hooks/useDialog";
import { modelKey, useModelPrefs } from "~/hooks/useModelPrefs";
import { t, type Lang } from "~/lib/i18n";
import { rpc } from "~/lib/rpc";
import { filterModels, type ModelChoice } from "~/lib/slash";

// ModelsDialog chooses which models the picker offers. Everything starts on;
// a model switched off still works, it just stops taking up the list.
export function ModelsDialog({ lang, onClose }: { lang: Lang; onClose: () => void }) {
  const sheet = useDialog<HTMLDivElement>();
  const { prefs, save } = useModelPrefs();
  const [models, setModels] = useState<ModelChoice[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => { rpc<ModelChoice[]>("model.list").then((l) => setModels(l ?? [])).catch(() => {}); }, []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  const groups = useMemo(() => {
    const g = new Map<string, ModelChoice[]>();
    for (const m of filterModels(models, query)) g.set(m.provider, [...(g.get(m.provider) ?? []), m]);
    return [...g.entries()];
  }, [models, query]);

  const hidden = new Set(prefs.hidden);
  const setShown = (list: ModelChoice[], on: boolean) => {
    const next = new Set(hidden);
    for (const m of list) {
      if (on) next.delete(modelKey(m));
      else next.add(modelKey(m));
    }
    save({ ...prefs, hidden: [...next] });
  };

  return createPortal(
    <div className="modal-backdrop models-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="models-sheet" role="dialog" aria-modal="true" aria-label={t("modelsTitle", lang)} ref={sheet}>
        <header>
          <h2>{t("modelsTitle", lang)}</h2>
          <button type="button" className="tree-icon" title={t("close", lang)} onClick={onClose}>×</button>
        </header>
        <input className="models-search" autoFocus value={query} placeholder={t("modelSearch", lang)} aria-label={t("modelSearch", lang)} onChange={(e) => setQuery(e.target.value)} />
        <div className="models-list">
          {groups.length === 0 && <p className="map-muted">{t("noneYet", lang)}</p>}
          {groups.map(([provider, list]) => {
            const on = list.filter((m) => !hidden.has(modelKey(m))).length;
            return (
              <section key={provider}>
                <div className="models-group">
                  <span>{provider}</span>
                  <button type="button" onClick={() => setShown(list, on < list.length)}>{t(on < list.length ? "modelsAllOn" : "modelsAllOff", lang)}</button>
                </div>
                {list.map((m) => {
                  const shown = !hidden.has(modelKey(m));
                  return (
                    <label key={modelKey(m)} className="models-row">
                      <span>{m.model}</span>
                      <input type="checkbox" role="switch" className="models-switch" checked={shown} onChange={() => setShown([m], !shown)} />
                    </label>
                  );
                })}
              </section>
            );
          })}
        </div>
        <footer>
          <button type="button" onClick={() => { onClose(); window.dispatchEvent(new CustomEvent("rove:open-settings", { detail: "providers" })); }}>{t("modelsAddProvider", lang)}</button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
