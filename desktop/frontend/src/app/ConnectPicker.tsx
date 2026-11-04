import { useCallback, useEffect, useMemo, useState } from "react";
import { rpc } from "~/lib/rpc";
import { toast } from "~/lib/toast";
import { openExternal } from "~/lib/platform";
import { t, type Lang } from "~/lib/i18n";
import type { Provider } from "~/lib/types";

// One entry of the daemon's connection catalog, with what it found here.
export type Connection = {
  id: string;
  name: string;
  kind: "agent" | "api" | "local";
  blurb: string;
  bin?: string;
  install?: string;
  login?: string;
  logout?: string;
  baseUrl?: string;
  needKey?: boolean;
  keyUrl?: string;
  docs?: string;
  models?: string[];
  free?: boolean;
  onDevice?: boolean;
  fullOnly?: boolean;
  tokenCmd?: string;
  tokenSaved?: boolean;
  browserLogin?: boolean;
  installed?: boolean;
  version?: string;
  loggedIn?: boolean;
  account?: string;
};

interface Props {
  lang: Lang;
  providers: Provider[];
  onDone: () => void | Promise<void>;
  onClose: () => void;
  // what the button that leaves the list says, when not Cancel
  closeLabel?: string;
  // for an agent, which may not write: what needs full access is not offered
  forAgent?: boolean;
}

// an agent system that brings its own providers sits with what runs here
const groupOf = (c: Connection) => (c.onDevice ? "local" : c.kind);

const GROUPS: { kind: Connection["kind"]; key: string }[] = [
  { kind: "agent", key: "conGroupAgent" },
  { kind: "api", key: "conGroupApi" },
  { kind: "local", key: "conGroupLocal" },
];

// ConnectPicker is "add a provider" as a list of the systems a user can
// connect their own account to: agent systems on this computer (Claude Code,
// Codex, Antigravity, Hermes, OpenCode) that sign in through the browser, model APIs
// that take a key, and local servers. It says what is installed and signed
// in, opens the terminal for an install or a sign-in, and the browser for a
// key page.
export function ConnectPicker({ lang, providers, onDone, onClose, closeLabel, forAgent }: Props) {
  const [list, setList] = useState<Connection[] | null>(null);
  const [query, setQuery] = useState("");
  const [pick, setPick] = useState<Connection | null>(null);
  const [custom, setCustom] = useState(false);
  const [checking, setChecking] = useState(false);

  const load = useCallback(async () => {
    setChecking(true);
    try {
      const l = await rpc<Connection[]>("connect.catalog");
      setList(l ?? []);
      setPick((p) => (p ? (l ?? []).find((x) => x.id === p.id) ?? p : p));
    } catch (e) {
      toast(e instanceof Error ? e.message : "catalog failed", "err");
      setList([]);
    } finally {
      setChecking(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // back from the terminal or the browser: look again
  useEffect(() => {
    const onFocus = () => { if (pick?.kind === "agent") void load(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [pick, load]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (list ?? []).filter((c) => !(forAgent && c.fullOnly) && (!q || `${c.name} ${c.blurb} ${c.id}`.toLowerCase().includes(q)));
  }, [list, query, forAgent]);

  const connected = (c: Connection) =>
    providers.some((p) => (c.kind === "agent" ? p.kind === "agent-cli" && p.baseUrl.startsWith(`agent://${c.id}?`) : p.baseUrl === c.baseUrl));

  return (
    <div className="con">
      {custom ? (
        <CustomSetup lang={lang} providers={providers} onBack={() => setCustom(false)} onDone={onDone} />
      ) : !pick ? (
        <>
          <div className="con-top">
            <input autoFocus className="con-search" value={query} placeholder={t("conSearch", lang)} onChange={(e) => setQuery(e.target.value)} />
            <button type="button" className="ghost" onClick={onClose}>{closeLabel ?? t("cancel", lang)}</button>
          </div>
          {list === null && <div className="map-muted">{t("conChecking", lang)}</div>}
          {GROUPS.map((g) => {
            const items = shown.filter((c) => groupOf(c) === g.kind);
            if (items.length === 0) return null;
            return (
              <section key={g.kind} className="con-group">
                <div className="section-label">{t(g.key, lang)}</div>
                <div className="con-grid">
                  {items.map((c) => (
                    <button key={c.id} type="button" className={`con-card ${c.kind}`} onClick={() => setPick(c)}>
                      <span className="con-body">
                        <strong>{c.name}</strong>
                        <span className="con-state">
                          {connected(c) ? <em className="ok">{t("conConnected", lang)}</em>
                            : c.free ? <em className={c.installed ? "ok" : "warn"}>{t(c.installed ? "conFree" : "conFreeInstall", lang)}</em>
                            : c.kind === "agent" ? (c.installed ? (c.loggedIn === false ? <em className="warn">{t("conNotSignedIn", lang)}</em> : <em className="ok">{t("conInstalled", lang)}</em>) : <em>{t("conNotInstalled", lang)}</em>)
                            : c.needKey ? <em>{t("conNeedsKey", lang)}</em> : <em>{t("conNoKey", lang)}</em>}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            );
          })}
          {list !== null && (
            <section className="con-group">
              <div className="section-label">{t("conGroupCustom", lang)}</div>
              <div className="con-grid">
                <button type="button" className="con-card" onClick={() => setCustom(true)}>
                  <span className="con-body">
                    <strong>{t("conCustomName", lang)}</strong>
                    <span className="con-state"><em>{t("conCustomHint", lang)}</em></span>
                  </span>
                </button>
              </div>
            </section>
          )}
        </>
      ) : pick.kind === "agent" ? (
        <AgentSetup c={pick} lang={lang} current={providers.find((p) => p.kind === "agent-cli" && p.baseUrl.startsWith(`agent://${pick.id}?`))} checking={checking} onRecheck={() => void load()} onBack={() => setPick(null)} onDone={onDone} />
      ) : (
        <ApiSetup c={pick} lang={lang} existed={connected(pick)} onBack={() => setPick(null)} onDone={onDone} />
      )}
    </div>
  );
}

function AgentSetup({ c, lang, current, checking, onRecheck, onBack, onDone }: {
  c: Connection; lang: Lang; current?: Provider; checking: boolean; onRecheck: () => void; onBack: () => void; onDone: () => void | Promise<void>;
}) {
  // connecting again keeps the access it has
  const [access, setAccess] = useState<"edits" | "full">(c.fullOnly || current?.baseUrl.includes("access=full") ? "full" : "edits");
  const needsSignIn = c.installed && c.loggedIn === false;
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState("");
  // an install running in a terminal: until when to keep looking for it
  const [installing, setInstalling] = useState(0);
  // a browser sign-in under way: the address in case no browser opened, and
  // whether the old account is still signed in
  const [waiting, setWaiting] = useState<{ url: string; was: boolean; until: number } | null>(null);

  // the program finishes the sign-in by itself: look until it has
  useEffect(() => {
    if (!waiting) return;
    if (c.loggedIn === false && waiting.was) { setWaiting({ ...waiting, was: false }); return; }
    if ((c.loggedIn === true && !waiting.was) || Date.now() > waiting.until) { setWaiting(null); return; }
    const id = window.setTimeout(onRecheck, 2000);
    return () => window.clearTimeout(id);
  }, [waiting, c, onRecheck]);

  // the install finishes in its own window: look until the program is here
  useEffect(() => {
    if (!installing || c.installed || Date.now() > installing) return;
    const id = window.setTimeout(onRecheck, 3000);
    return () => window.clearTimeout(id);
  }, [installing, c, onRecheck]);

  const browser = async (s: "login" | "switch" | "logout") => {
    try {
      const r = await rpc<{ url?: string }>("connect.browser", { id: c.id, step: s });
      if (s === "logout") { onRecheck(); return; }
      setWaiting({ url: r.url ?? "", was: s === "switch", until: Date.now() + 5 * 60_000 });
    } catch (e) {
      toast(e instanceof Error ? e.message : "failed", "err");
    }
  };
  const saveToken = async (value: string) => {
    try {
      await rpc("connect.token", { id: c.id, token: value });
      setToken("");
      onRecheck();
    } catch (e) {
      toast(e instanceof Error ? e.message : "failed", "err");
    }
  };
  const step = async (s: "install" | "login" | "logout" | "switch" | "token") => {
    const opened = { install: "conInstallOpened", login: "conLoginOpened", logout: "conSignOutOpened", switch: "conSwitchOpened", token: "conTokenOpened" } as const;
    try {
      await rpc("connect.terminal", { id: c.id, step: s });
      toast(t(opened[s], lang), "ok");
      if (s === "install") setInstalling(Date.now() + 10 * 60_000);
    } catch (e) {
      toast(e instanceof Error ? e.message : "failed", "err");
    }
  };
  const add = async () => {
    setBusy(true);
    try {
      await rpc("connect.add", { id: c.id, access });
      toast(`${c.name}: ${t("conAdded", lang)}`, "ok");
      await onDone();
    } catch (e) {
      toast(e instanceof Error ? e.message : "failed", "err");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="con-setup">
      <button type="button" className="ghost con-back" onClick={onBack}>← {t("conBack", lang)}</button>
      <div className="con-head">
        <div>
          <h3>{c.name}</h3>
          <p>{c.blurb}</p>
        </div>
      </div>

      <ol className="con-steps">
        <li className={c.installed ? "done" : "now"}>
          <div className="con-step-main">
            <strong>{t("conStepInstall", lang)}</strong>
            <span>{c.installed ? `${t("conInstalled", lang)}${c.version ? ` · ${c.version}` : ""}` : c.install ? <code>{c.install}</code> : t("conInstallDocs", lang)}</span>
          </div>
          {!c.installed && (c.install
            ? <button type="button" onClick={() => void step("install")}>{t("conRunInTerminal", lang)}</button>
            : c.docs && <button type="button" onClick={() => openExternal(c.docs!)}>{t("conOpenDocs", lang)} ↗</button>)}
        </li>
        <li className={!c.installed ? "" : c.loggedIn === true || c.free ? "done" : "now"}>
          <div className="con-step-main">
            <strong>{t("conStepLogin", lang)}</strong>
            <span>
              {c.tokenSaved ? t("conTokenSaved", lang)
                : waiting ? t("conBrowserWaiting", lang)
                : c.loggedIn === true ? `${t("conSignedIn", lang)}${c.account ? ` · ${c.account}` : ""}`
                : c.free ? t("conFreeHint", lang)
                : c.tokenCmd ? t("conTokenHint", lang)
                : c.browserLogin ? t("conBrowserHint", lang)
                : c.loggedIn === false ? t("conSignInHint", lang)
                : t("conSignInUnknown", lang)}
            </span>
            {waiting?.url && <button type="button" className="con-link" onClick={() => openExternal(waiting.url)}>{t("conBrowserOpen", lang)} ↗</button>}
            {c.installed && c.tokenCmd && !c.tokenSaved && c.loggedIn !== true && (
              <div className="con-key">
                <input type="password" autoComplete="off" aria-label={t("conTokenLabel", lang)} placeholder={t("conTokenLabel", lang)} value={token} onChange={(e) => setToken(e.target.value)} />
                <button type="button" disabled={!token.trim()} onClick={() => void saveToken(token)}>{t("conTokenSave", lang)}</button>
              </div>
            )}
          </div>
          {c.installed && c.tokenCmd && !c.tokenSaved && c.loggedIn !== true && <button type="button" onClick={() => void step("token")}>{t("conTokenMake", lang)} ↗</button>}
          {c.installed && c.tokenSaved && <button type="button" className="ghost" onClick={() => void saveToken("")}>{t("conTokenRemove", lang)}</button>}
          {c.installed && !c.tokenCmd && c.loggedIn !== true && (c.browserLogin
            ? <button type="button" disabled={Boolean(waiting)} onClick={() => void browser("login")}>{t("conBrowserSignIn", lang)} ↗</button>
            : <button type="button" onClick={() => void step("login")}>{t("conSignIn", lang)} ↗</button>)}
          {/* the account is the one the program on this computer is signed
              in to: another account means signing out of it first */}
          {c.installed && c.loggedIn === true && !c.tokenSaved && c.logout && (
            <span className="con-step-btns">
              <button type="button" onClick={() => void (c.browserLogin ? browser("switch") : step("switch"))}>{t("conSwitch", lang)} ↗</button>
              <button type="button" className="ghost" onClick={() => void (c.browserLogin ? browser("logout") : step("logout"))}>{t("conSignOut", lang)}</button>
            </span>
          )}
        </li>
        <li className={c.installed ? "now" : ""}>
          <div className="con-step-main">
            <strong>{t("conStepAccess", lang)}</strong>
            {!c.fullOnly && (
              <div className="seg con-access" role="radiogroup">
                {(["edits", "full"] as const).map((a) => (
                  <button key={a} type="button" role="radio" aria-checked={access === a} className={access === a ? "on" : ""} onClick={() => setAccess(a)}>
                    {t(a === "edits" ? "conAccessEdits" : "conAccessFull", lang)}
                  </button>
                ))}
              </div>
            )}
            <span className="con-hint">{t(c.fullOnly ? "conAccessFullOnly" : access === "edits" ? "conAccessEditsHint" : "conAccessFullHint", lang)}</span>
          </div>
        </li>
      </ol>

      <div className="con-actions">
        <button type="button" className="ghost" disabled={checking} onClick={onRecheck}>{checking ? t("conChecking", lang) : `↻ ${t("conRecheck", lang)}`}</button>
        {c.docs && <button type="button" className="ghost" onClick={() => openExternal(c.docs!)}>{t("conOpenDocs", lang)} ↗</button>}
        <button type="button" className="primary" disabled={!c.installed || needsSignIn || busy} title={needsSignIn ? t("conSignInFirst", lang) : undefined} onClick={() => void add()}>
          {busy ? "…" : t(current ? "conUpdate" : "conConnect", lang)}
        </button>
      </div>
    </div>
  );
}

function ApiSetup({ c, lang, existed, onBack, onDone }: { c: Connection; lang: Lang; existed: boolean; onBack: () => void; onDone: () => void | Promise<void> }) {
  const [key, setKey] = useState("");
  const [base, setBase] = useState(c.baseUrl ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const save = async () => {
    setBusy(true);
    setErr("");
    try {
      const secretId = c.needKey ? `${c.id}-key` : "";
      if (key.trim()) await rpc("secret.put", { id: secretId, value: key.trim() });
      // Anthropic signs its model list differently from the rest
      const kind = c.id === "anthropic" ? "anthropic" : "openai-compat";
      const r = await rpc<Provider & { modelsError?: string }>("provider.upsert", { name: c.name, kind, baseUrl: base.trim(), secretId, models: [] });
      if (r.modelsError) {
        // a key that does not work must not show as connected
        if (!existed) await rpc("provider.delete", { id: r.id }).catch(() => {});
        setErr(`${t("provModelsFailed", lang)}: ${r.modelsError}`);
        return;
      }
      toast(`${c.name}: ${r.models?.length ?? 0} ${t("provModelsAdded", lang)}`, "ok");
      await onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="con-setup">
      <button type="button" className="ghost con-back" onClick={onBack}>← {t("conBack", lang)}</button>
      <div className="con-head">
        <div>
          <h3>{c.name}</h3>
          <p>{c.blurb}</p>
        </div>
      </div>
      <div className="form-stack">
        <label>{t("providerBaseUrl", lang)}</label>
        <input value={base} onChange={(e) => setBase(e.target.value)} />
        {c.needKey && (
          <>
            <label>{t("providerApiKey", lang)}</label>
            <div className="con-key">
              <input type="password" autoComplete="off" placeholder="sk-…" value={key} onChange={(e) => setKey(e.target.value)} />
              {c.keyUrl && <button type="button" onClick={() => openExternal(c.keyUrl!)}>{t("conGetKey", lang)} ↗</button>}
            </div>
            <span className="con-hint">{t("conKeyHint", lang)}</span>
          </>
        )}
        {err && <div className="prov-err">{err}</div>}
        <div className="con-actions">
          {c.docs && <button type="button" className="ghost" onClick={() => openExternal(c.docs!)}>{t("conOpenDocs", lang)} ↗</button>}
          <button type="button" className="primary" disabled={busy || (c.needKey && !key.trim())} onClick={() => void save()}>
            {busy ? t("provFetching", lang) : t("conConnect", lang)}
          </button>
        </div>
      </div>
    </div>
  );
}

// CustomSetup adds any OpenAI-compatible address. Its models are read from the
// address itself; a model id is only for a server that does not list them.
function CustomSetup({ lang, providers, onBack, onDone }: { lang: Lang; providers: Provider[]; onBack: () => void; onDone: () => void | Promise<void> }) {
  const [name, setName] = useState("");
  const [base, setBase] = useState("");
  const [key, setKey] = useState("");
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const save = async () => {
    const title = name.trim();
    setBusy(true);
    setErr("");
    try {
      const secretId = `${title}-key`;
      if (key.trim()) await rpc("secret.put", { id: secretId, value: key.trim() });
      const models = model.split(/[,\n]/).map((m) => m.trim()).filter(Boolean);
      const r = await rpc<Provider & { modelsError?: string }>("provider.upsert", { name: title, kind: "openai-compat", baseUrl: base.trim(), secretId, models });
      if (r.modelsError) {
        if (!providers.some((p) => p.name === title)) await rpc("provider.delete", { id: r.id }).catch(() => {});
        setErr(`${t("provModelsFailed", lang)}: ${r.modelsError}`);
        return;
      }
      toast(`${title}: ${r.models?.length ?? 0} ${t("provModelsAdded", lang)}`, "ok");
      await onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="con-setup">
      <button type="button" className="ghost con-back" onClick={onBack}>← {t("conBack", lang)}</button>
      <div className="con-head">
        <div>
          <h3>{t("conCustomName", lang)}</h3>
          <p>{t("conCustomLead", lang)}</p>
        </div>
      </div>
      <div className="form-stack">
        <label>{t("fieldName", lang)}</label>
        <input autoFocus placeholder="my-provider" value={name} onChange={(e) => setName(e.target.value)} />
        <label>{t("providerBaseUrl", lang)}</label>
        <input placeholder="https://api.example.com/v1" value={base} onChange={(e) => setBase(e.target.value)} />
        <label>{t("providerApiKey", lang)}</label>
        <input type="password" autoComplete="off" placeholder="sk-…" value={key} onChange={(e) => setKey(e.target.value)} />
        <label>{t("provModelId", lang)}</label>
        <input placeholder={t("provModelsPlaceholder", lang)} value={model} onChange={(e) => setModel(e.target.value)} />
        {err && <div className="prov-err">{err}</div>}
        <div className="con-actions">
          <button type="button" className="primary" disabled={busy || !name.trim() || !base.trim()} onClick={() => void save()}>
            {busy ? t("provFetching", lang) : t("conConnect", lang)}
          </button>
        </div>
      </div>
    </div>
  );
}
