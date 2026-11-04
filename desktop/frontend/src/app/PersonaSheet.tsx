import type { Feature } from "~/lib/types";
import { usePrefs } from "~/hooks/usePrefs";
import { t } from "~/lib/i18n";

// The feature toggles of Settings → Agent.
export function FeatureToggles({
  features, value, onChange,
}: {
  features: Feature[];
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const { lang } = usePrefs();
  const on = new Set(value);
  const toggle = (k: string) => {
    const next = new Set(on);
    if (next.has(k)) next.delete(k); else next.add(k);
    onChange(features.map((f) => f.key).filter((x) => next.has(x)));
  };
  return (
    <div className="feat-groups">
      {(["tools", "behavior"] as const).map((g) => (
        <div key={g}>
          <div className="section-label feat-label">{t(g === "tools" ? "personaTools" : "personaBehavior", lang)}</div>
          <div className="feat-grid">
            {features.filter((f) => f.group === g).map((f) => (
              <label key={f.key} className={`feat${on.has(f.key) ? " on" : ""}`} title={f.rule ?? (f.tools ?? []).join(", ")}>
                <input type="checkbox" checked={on.has(f.key)} onChange={() => toggle(f.key)} />
                <span>
                  <strong>{f.name}</strong>
                  <span>{f.desc}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
