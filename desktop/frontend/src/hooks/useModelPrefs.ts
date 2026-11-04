import { useCallback, useEffect, useState } from "react";

// How someone keeps their model list short, on this computer: models switched
// off in the Models window, and providers folded away in the picker.
export type ModelPrefs = { hidden: string[]; folded: string[] };

const KEY = "rove.models.prefs";
const EVENT = "rove:model-prefs";

export const modelKey = (m: { provider: string; model: string }) => `${m.provider}/${m.model}`;

function load(): ModelPrefs {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) || "{}") as Partial<ModelPrefs>;
    const list = (x: unknown) => (Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : []);
    return { hidden: list(p.hidden), folded: list(p.folded) };
  } catch {
    return { hidden: [], folded: [] };
  }
}

// useModelPrefs is shared by every picker open at once: terminal panes too.
export function useModelPrefs() {
  const [prefs, setPrefs] = useState<ModelPrefs>(load);
  useEffect(() => {
    const on = () => setPrefs(load());
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  const save = useCallback((next: ModelPrefs) => {
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private */ }
    setPrefs(next);
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return { prefs, save };
}
