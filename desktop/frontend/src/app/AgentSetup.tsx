import { useEffect, useState } from "react";
import { useProviders } from "~/hooks/useApi";
import { loadPins, savePins } from "~/lib/agents";
import { defaultColor } from "~/lib/agentmark";
import { t, type Lang } from "~/lib/i18n";
import { rpc } from "~/lib/rpc";
import type { AgentProfile } from "~/lib/types";
import { ColorPick } from "./AgentCreate";
import { MarkSvg } from "./AgentMark";
import { ConnectPicker } from "./ConnectPicker";

// what was entered so far, for coming back from another space
const KEY = "rove.agent.setup";
type Progress = { step?: "name" | "color" | "provider"; name?: string; color?: string };

function loadProgress(): Progress {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) || "{}") as Progress;
  } catch {
    return {};
  }
}

// AgentSetup is what the Agent space shows while there are no agents: a name,
// a color, and a provider unless one is connected already. The agent it makes
// is the main one, pinned at the top of the side list.
export function AgentSetup({ lang, onDone }: { lang: Lang; onDone: (p: AgentProfile) => void }) {
  const [saved] = useState(loadProgress);
  const [step, setStep] = useState(saved.step ?? "name");
  const [name, setName] = useState(saved.name ?? "");
  const [color, setColor] = useState(() => saved.color ?? defaultColor(Math.random().toString(36)));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const { providers: allProviders, reload: reloadProviders } = useProviders();
  // the offline stand-in is not something a user connected
  const providers = allProviders.filter((p) => p.kind !== "fake");
  const named = name.trim() !== "";
  useEffect(() => {
    try { sessionStorage.setItem(KEY, JSON.stringify({ step, name, color })); } catch { /* private */ }
  }, [step, name, color]);

  const finish = async () => {
    if (!named || busy) return;
    setBusy(true);
    setErr("");
    try {
      const p = await rpc<AgentProfile>("profile.upsert", { name: name.trim(), color, role: "developer", isLeader: true });
      savePins([p.id, ...loadPins()]);
      try { sessionStorage.removeItem(KEY); } catch { /* private */ }
      window.dispatchEvent(new Event("rove:profiles"));
      window.dispatchEvent(new Event("rove:persona"));
      onDone(p);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const submit = () => {
    if (step === "name") { if (named) setStep("color"); return; }
    if (providers.length > 0) void finish();
    else setStep("provider");
  };

  if (step === "provider") {
    return (
      <div className="agent-setup">
        <div className="agent-setup-form wide">
          <MarkSvg color={color} size={72} awake />
          <h1>{t("ofSetupProviderTitle", lang)}</h1>
          <p>{t("ofSetupProviderLead", lang).replace("{name}", name.trim())}</p>
          {err && <p className="prov-err">{err}</p>}
          <ConnectPicker lang={lang} providers={providers} closeLabel={t("ofSetupSkip", lang)} forAgent onClose={() => void finish()}
            onDone={async () => { await reloadProviders(); await finish(); }} />
          <footer className="agent-setup-foot">
            <button type="button" className="ghost" disabled={busy} onClick={() => setStep("color")}>{t("ofSetupBack", lang)}</button>
          </footer>
        </div>
      </div>
    );
  }

  return (
    <div className="agent-setup">
      <form className="agent-setup-form" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <MarkSvg color={color} size={112} awake={named} />
        {step === "name" ? (
          <>
            <h1>{t("ofSetupNameTitle", lang)}</h1>
            <p>{t("ofSetupNameLead", lang)}</p>
            <input autoFocus aria-label={t("ofName", lang)} value={name} placeholder={t("ofCreateNamePh", lang)} onChange={(e) => setName(e.target.value)} />
            <footer className="agent-setup-foot">
              <button type="submit" className="primary" disabled={!named}>{t("ofSetupNext", lang)}</button>
            </footer>
          </>
        ) : (
          <>
            <h1>{t("ofSetupColorTitle", lang)}</h1>
            <p>{t("ofSetupColorLead", lang).replace("{name}", name.trim())}</p>
            <ColorPick color={color} onPick={setColor} />
            {err && <p className="prov-err">{err}</p>}
            <footer className="agent-setup-foot">
              <button type="button" className="ghost" disabled={busy} onClick={() => setStep("name")}>{t("ofSetupBack", lang)}</button>
              <button type="submit" className="primary" disabled={busy}>{busy ? "…" : t(providers.length > 0 ? "ofSetupDone" : "ofSetupNext", lang)}</button>
            </footer>
          </>
        )}
      </form>
    </div>
  );
}
