import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { pickFolder, rpc, subscribeEvents } from "~/lib/rpc";
import type { AgentProfile, Message, Session, Workspace } from "~/lib/types";
import { useWorkspaces } from "~/hooks/useApi";
import { usePersonaBadges } from "~/hooks/usePersona";
import { useProfiles } from "~/hooks/useApi";
import { chatPreview, chatsByProfile, loadPins, savePins } from "~/lib/agents";
import { moveOffice } from "~/lib/office";
import { CHAT_MODES, spaceOf, type ChatMode, type Space } from "~/lib/spaces";
import { MODE_ICON } from "./ModePicker";
import { usePrefs } from "~/hooks/usePrefs";
import { t } from "~/lib/i18n";
import { pollWhileVisible } from "~/lib/poll";
import { toast } from "~/lib/toast";
import { APP_VERSION } from "~/lib/version";
import { Icon } from "./Icons";
import { AgentMark } from "./AgentMark";
import type { OfficeIntent } from "./OfficePanel";
import { compact, type UsageSnapshot } from "./UsageCard";

interface Props {
  // Office shows agents (each row is the chat with that agent); Chat shows
  // sessions and the mode switch.
  space: Space;
  workspace: Workspace | null;
  onSelectWorkspace: (ws: Workspace) => void;
  activeSessionId: string | null;
  onSelectSession: (s: Session) => void;
  // true while a new chat is open but not sent yet
  draft: boolean;
  // the agent (catalog character id) the open draft will talk to
  draftAgent: string | null;
  // opens a draft, with an agent or without, and (in Code) in a chosen
  // mode; the session is only created by its first message
  onNewChat: (characterId?: string | null, mode?: ChatMode) => void;
  rpcOk: boolean;
  dark: boolean;
  onToggleTheme: () => void;
  onOpenMarket: () => void;
  onOpenSettings: (section?: "appearance" | "usage") => void;
  // Office: agents are added and edited in Settings → Office
  onOfficeAgent?: (intent: OfficeIntent) => void;
  // Chat only: the mode each session runs in (fixed when it started)
  modeOf?: (s: Session) => ChatMode;
}

// without is s minus id, the same set when id is not in it (no re-render).
function without(s: Set<string>, id: string): Set<string> {
  if (!s.has(id)) return s;
  const next = new Set(s);
  next.delete(id);
  return next;
}

export function ago(iso: string | undefined, lang: string): string {
  if (!iso) return "";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (!Number.isFinite(s) || s < 0) return "";
  const tr = lang === "tr";
  if (s < 60) return tr ? "şimdi" : "now";
  if (s < 3600) return `${Math.floor(s / 60)}${tr ? " dk" : "m"}`;
  if (s < 86400) return `${Math.floor(s / 3600)}${tr ? " sa" : "h"}`;
  return `${Math.floor(s / 86400)}${tr ? " g" : "d"}`;
}

// SessionSidebar is the left rail of a space. In Office it lists agents
// picked from the fixed catalog, each row being the conversation with that
// agent; in Chat it lists sessions by topic, most recent first, each marked
// with the mode it runs in.
export function SessionSidebar({
  space, workspace, onSelectWorkspace, activeSessionId, onSelectSession, draft, draftAgent, onNewChat,
  rpcOk, dark, onToggleTheme, onOpenMarket, onOpenSettings, onOfficeAgent, modeOf,
}: Props) {
  const { lang } = usePrefs();
  const { workspaces, reload: reloadWs } = useWorkspaces();
  const { badgeFor } = usePersonaBadges();
  const { profiles } = useProfiles();
  const [allSessions, setSessions] = useState<Session[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState("");
  // Agent: the search box opens from its button
  const [searching, setSearching] = useState(false);
  const [pins, setPins] = useState<string[]>(loadPins);
  // the last thing said in each agent's latest chat, by that chat and its
  // update time, so a chat is only read again once it has changed
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const previewFor = useRef(new Set<string>());
  const [previewTick, setPreviewTick] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  // Code: + opens a menu below it, and the new session's mode is picked there
  const [newOpen, setNewOpen] = useState(false);
  const newRef = useRef<HTMLDivElement | null>(null);
  const [editing, setEditing] = useState<{ id: string; title: string } | null>(null);
  // Per-session job status, for every session regardless of which one is
  // open: green while it is actively working, red once it finishes and the
  // user has not opened it since.
  const [running, setRunning] = useState<Set<string>>(new Set());
  const [doneUnseen, setDoneUnseen] = useState<Set<string>>(new Set());
  // runs that ended in an error: red until the session runs again
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const [usage, setUsage] = useState<UsageSnapshot | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  // the menu at the foot of the list
  const [footOpen, setFootOpen] = useState(false);
  const footRef = useRef<HTMLDivElement | null>(null);
  const activeIdRef = useRef(activeSessionId);
  useEffect(() => { activeIdRef.current = activeSessionId; }, [activeSessionId]);

  // this space's chats only
  const sessions = useMemo(() => allSessions.filter((s) => spaceOf(s, badgeFor(s.id)) === space), [allSessions, badgeFor, space]);

  const reload = useCallback(async () => {
    try {
      setSessions((await rpc<Session[]>("session.list", { workspaceId: "" })) ?? []);
    } catch { /* keep */ } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    const stop = pollWhileVisible(() => void reload(), 12000);
    const on = () => void reload();
    window.addEventListener("rove:sessions", on);
    // a chat is named after its first message the moment it is sent
    const off = subscribeEvents("session.updated", on);
    // an agent can make a new agent when asked
    const offAgents = subscribeEvents("profile.updated", () => window.dispatchEvent(new Event("rove:profiles")));
    return () => { stop(); window.removeEventListener("rove:sessions", on); off(); offAgents(); };
  }, [reload]);

  useEffect(() => {
    return pollWhileVisible(() => { rpc<UsageSnapshot>("usage.get").then(setUsage).catch(() => {}); }, 30000);
  }, []);

  // the office's old picks become agents, once
  useEffect(() => {
    if (space !== "office") return;
    void moveOffice().then((moved) => { if (moved) void reload(); });
  }, [space, reload]);

  // Job status for every session, wherever the run came from (this pane,
  // another pane, or a context-map relay): blue and pulsing while it works,
  // green once it finished with something to read (until opened), red when
  // it ended in an error (until it runs again).
  useEffect(() => {
    const sessionOf = (ev: { payload?: unknown }) => (ev.payload as { sessionId?: string } | undefined)?.sessionId;
    const markRunning = (ev: { payload?: unknown }) => {
      const sid = sessionOf(ev);
      if (!sid) return;
      setRunning((s) => (s.has(sid) ? s : new Set(s).add(sid)));
      setDoneUnseen((s) => without(s, sid));
      setFailed((s) => without(s, sid));
    };
    const markDone = (ev: { payload?: unknown }) => {
      const sid = sessionOf(ev);
      if (!sid) return;
      setRunning((s) => without(s, sid));
      // its row shows the last thing said: read that chat again
      for (const k of previewFor.current) if (k.startsWith(`${sid}:`)) previewFor.current.delete(k);
      setPreviewTick((n) => n + 1);
      const p = (ev.payload ?? {}) as { error?: string; cancelled?: boolean };
      if (p.error) {
        setFailed((s) => (s.has(sid) ? s : new Set(s).add(sid)));
        return;
      }
      if (p.cancelled || sid === activeIdRef.current) return; // stopped, or already looking at it
      setDoneUnseen((s) => (s.has(sid) ? s : new Set(s).add(sid)));
    };
    const offs = [
      subscribeEvents("run.start", markRunning),
      subscribeEvents("message.delta", markRunning),
      subscribeEvents("tool.start", markRunning),
      subscribeEvents("tool.result", markRunning),
      subscribeEvents("run.done", markDone),
    ];
    return () => offs.forEach((off) => off());
  }, []);

  // Opening a session — from any path (a row here, a new chat, the context
  // map) — marks it seen.
  useEffect(() => {
    if (!activeSessionId) return;
    setDoneUnseen((s) => {
      if (!s.has(activeSessionId)) return s;
      const next = new Set(s);
      next.delete(activeSessionId);
      return next;
    });
  }, [activeSessionId]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
      if (newRef.current && !newRef.current.contains(e.target as Node)) setNewOpen(false);
      if (footRef.current && !footRef.current.contains(e.target as Node)) setFootOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  // with the new-session menu open, 1/2/3 pick a mode and Escape closes it
  useEffect(() => {
    if (!newOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setNewOpen(false); return; }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const n = Number(e.key);
      if (n >= 1 && n <= CHAT_MODES.length) {
        e.preventDefault();
        setNewOpen(false);
        onNewChat(null, CHAT_MODES[n - 1]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [newOpen, onNewChat]);

  const wsById = useMemo(() => new Map(workspaces.map((w) => [w.id, w])), [workspaces]);

  // Code always has something open: the most recent chat, else a new
  // draft. Only when nothing is open — a chat
  // that was just created (by a draft's first message) is not in this list
  // until the next reload, and must not be swapped for another one meanwhile.
  useEffect(() => {
    if (space !== "chat" || !loaded || draft || activeSessionId) return;
    if (sessions.length > 0) onSelectSession(sessions[0]);
  }, [loaded, draft, sessions, activeSessionId, onSelectSession, onNewChat, space]);

  useEffect(() => {
    if (!workspace && workspaces.length > 0) onSelectWorkspace(workspaces[0]);
  }, [workspace, workspaces, onSelectWorkspace]);

  const openFolder = async () => {
    setMenuOpen(false);
    const path = (await pickFolder()).trim();
    if (!path) return;
    const name = path.split(/[/\\]/).filter(Boolean).pop() ?? path;
    try {
      const ws = await rpc<Workspace>("workspace.open", { path, name });
      await reloadWs();
      onSelectWorkspace(ws);
      onNewChat(null);
    } catch (e) {
      toast(e instanceof Error ? e.message : "open failed", "err");
    }
  };

  const commitRename = async () => {
    if (!editing) return;
    const { id, title } = editing;
    setEditing(null);
    if (!title.trim()) return;
    await rpc("session.rename", { id, title: title.trim() }).catch(() => {});
    await reload();
  };

  const remove = async (s: Session) => {
    await rpc("session.delete", { id: s.id }).catch(() => {});
    if (s.id === activeSessionId) {
      // the open chat is gone: move to the next one, or a new draft
      const next = sessions.find((x) => x.id !== s.id);
      if (next) onSelectSession(next);
      else onNewChat(null);
    }
    await reload();
    window.dispatchEvent(new Event("rove:sessions"));
  };

  const footItem = (run: () => void) => { setFootOpen(false); run(); };

  const q = filter.trim().toLocaleLowerCase("tr");
  const list = q
    ? sessions.filter((s) => [s.title, wsById.get(s.workspaceId)?.name ?? ""].some((x) => x.toLocaleLowerCase("tr").includes(q)))
    : sessions;
  // Office: the office's agents, each row being its latest conversation
  const byAgent = chatsByProfile(sessions, badgeFor);
  const openAgent = (id: string) => {
    const latest = byAgent.get(id)?.[0];
    if (latest) onSelectSession(latest);
    else onNewChat(id);
  };
  const activeAgent = profiles.find((p) => (byAgent.get(p.id) ?? []).some((x) => x.id === activeSessionId) || (draft && draftAgent === p.id)) ?? null;
  // Agent too: the latest chat with one of its agents, else a first chat
  // with the first agent
  useEffect(() => {
    if (space !== "office" || !loaded || draft || activeSessionId || profiles.length === 0) return;
    const latest = sessions.find((s) => profiles.some((p) => p.id === badgeFor(s.id)?.profileId));
    if (latest) onSelectSession(latest);
    else if (sessions.length === 0) onNewChat(profiles[0].id);
  }, [space, loaded, draft, activeSessionId, profiles, sessions, badgeFor, onSelectSession, onNewChat]);

  const previewKey = (s: Session) => `${s.id}:${s.updatedAt}`;
  const latestKeys = space === "office" ? profiles.flatMap((p) => byAgent.get(p.id)?.[0] ?? []).map(previewKey).join(" ") : "";

  useEffect(() => {
    for (const key of latestKeys.split(" ").filter(Boolean)) {
      if (previewFor.current.has(key)) continue;
      previewFor.current.add(key);
      const sessionId = key.slice(0, key.indexOf(":"));
      rpc<Message[]>("session.history", { sessionId })
        .then((got) => setPreviews((p) => ({ ...p, [key]: chatPreview(got ?? []) })))
        .catch(() => {});
    }
  }, [latestKeys, previewTick]);

  const previewOf = (s: Session) => previews[previewKey(s)] || s.title || t("chat", lang);
  const jobOf = (id: string) => {
    const chats = byAgent.get(id) ?? [];
    return chats.some((x) => running.has(x.id)) ? "running" : chats.some((x) => doneUnseen.has(x.id)) ? "done" : null;
  };
  const togglePin = (id: string) => {
    const next = pins.includes(id) ? pins.filter((x) => x !== id) : [...pins, id];
    setPins(next);
    savePins(next);
  };
  const closeSearch = () => { setSearching(false); setFilter(""); };
  // a search looks through every agent; otherwise the pinned ones sit above
  // the list instead of in it
  const pinned = q ? [] : pins.map((id) => profiles.find((p) => p.id === id)).filter((p): p is AgentProfile => Boolean(p));
  const agentRows = profiles.filter((p) => {
    if (!q) return !pins.includes(p.id);
    const latest = byAgent.get(p.id)?.[0];
    return [p.name, latest ? previewOf(latest) : ""].some((x) => x.toLocaleLowerCase("tr").includes(q));
  });

  return (
    <aside className={`shell-side panel space-${space}`}>
      <div className="side-head">
        <span className="side-title">{t(space === "office" ? "sideAgents" : "sessions", lang)}</span>
        {space === "chat" ? (
          <div className="side-new" ref={menuRef}>
            <button type="button" className="tree-icon" title={t("openWorkspace", lang)} onClick={() => { setNewOpen(false); setMenuOpen((v) => !v); }}>
              <Icon name="folder" size={14} />
            </button>
            {/* + opens a menu below it: a new session starts by picking its
                mode, which it then keeps */}
            <div className="side-new-mode" ref={newRef}>
              <button type="button" className={`tree-icon${newOpen ? " on" : ""}`} title={t("newSession", lang)} aria-haspopup="menu" aria-expanded={newOpen} onClick={() => { setMenuOpen(false); setNewOpen((v) => !v); }}>
                <Icon name="plus" size={14} />
              </button>
              {newOpen && (
                <div className="pane-menu side-menu new-mode-menu" role="menu" aria-label={t("newSessionMode", lang)}>
                  {CHAT_MODES.map((m) => (
                    <button type="button" role="menuitem" key={m} className="new-mode-item" onClick={() => { setNewOpen(false); onNewChat(null, m); }}>
                      <Icon name={MODE_ICON[m]} size={15} />
                      <strong>{t(`mode_${m}`, lang)}</strong>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {menuOpen && (
              <div className="pane-menu side-menu">
                {workspaces.map((ws) => (
                  <button type="button" key={ws.id} className={ws.id === workspace?.id ? "on" : ""} onClick={() => { setMenuOpen(false); onSelectWorkspace(ws); onNewChat(null); }} title={ws.path}>
                    + {t("newSession", lang)} <span className="term-dim">· {ws.name}</span>
                  </button>
                ))}
                <button type="button" onClick={() => void openFolder()}><Icon name="folder" size={13} /> {t("openWorkspace", lang)}…</button>
              </div>
            )}
          </div>
        ) : (
          <div className="side-round-btns">
            <button type="button" className={`side-round${searching ? " on" : ""}`} title={t("agentSearch", lang)} aria-expanded={searching} onClick={() => { if (searching) closeSearch(); else setSearching(true); }}>
              <Icon name="search" size={15} />
            </button>
            <button type="button" className="side-round" title={t("ofAddInSettings", lang)} onClick={() => onOfficeAgent?.({ mode: "new" })}>
              <Icon name="plus" size={15} />
            </button>
          </div>
        )}
      </div>

      {space === "chat" ? (
        <>
          {sessions.length > 6 && (
            <div className="side-search">
              <input value={filter} placeholder={t("ctxSearch", lang)} onChange={(e) => setFilter(e.target.value)} />
            </div>
          )}
          <div className="tree">
            {list.map((s) => {
              const live = running.has(s.id);
              const job = live ? "running" : failed.has(s.id) ? "error" : doneUnseen.has(s.id) ? "done" : null;
              const ws = wsById.get(s.workspaceId);
              const active = s.id === activeSessionId;
              return (
                <div key={s.id} className={`sess-row${active ? " active" : ""}`}>
                  {editing?.id === s.id ? (
                    <input
                      autoFocus
                      className="tree-rename"
                      value={editing.title}
                      onChange={(e) => setEditing({ id: s.id, title: e.target.value })}
                      onBlur={() => void commitRename()}
                      onKeyDown={(e) => { if (e.key === "Enter") void commitRename(); if (e.key === "Escape") setEditing(null); }}
                    />
                  ) : (
                    <button
                      type="button"
                      className="sess-main"
                      onClick={() => onSelectSession(s)}
                      onDoubleClick={() => setEditing({ id: s.id, title: s.title })}
                      title={s.title}
                    >
                      <span className="sess-line">
                        {modeOf ? (
                          <span className={`sess-mode mode-${modeOf(s)}${active ? " on" : ""}`} title={t(`mode_${modeOf(s)}`, lang)}>
                            <Icon name={MODE_ICON[modeOf(s)]} size={13} />
                          </span>
                        ) : (
                          <span className={`tree-dot${live ? " live" : active ? " on" : ""}`} />
                        )}
                        <span className="sess-title">{s.title || t("chat", lang)}</span>
                        <span className="sess-ago">{ago(s.updatedAt, lang)}</span>
                      </span>
                      {/* the root folder ("/") names nothing: only a real project shows */}
                      {ws?.name && ws.name !== "/" && <span className="sess-ws">{ws.name}</span>}
                    </button>
                  )}
                  {job && <span className={`sess-job ${job}`} role="status" title={t(job === "running" ? "jobRunning" : job === "error" ? "jobError" : "jobDone", lang)} />}
                  <button type="button" className="tree-icon tree-hover" title={t("delete", lang)} onClick={() => void remove(s)}>×</button>
                </div>
              );
            })}
            {loaded && sessions.length === 0 && !workspace && (
              <button type="button" className="tree-empty" onClick={() => void openFolder()}>+ {t("openWorkspace", lang)}</button>
            )}
          </div>
        </>
      ) : (
        <div className="tree office-tree">
          {searching && (
            <div className="side-search">
              <input
                autoFocus
                value={filter}
                placeholder={t("agentSearch", lang)}
                onChange={(e) => setFilter(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Escape") closeSearch(); }}
              />
            </div>
          )}
          {pinned.length > 0 && (
            <div className="agent-pins">
              {pinned.map((p) => (
                <div key={p.id} className={`agent-pin${activeAgent?.id === p.id ? " active" : ""}`}>
                  <button type="button" className="agent-pin-main" onClick={() => openAgent(p.id)} title={p.name}>
                    <AgentMark mark={p.mark} color={p.color} seed={p.id} character={p.characterId} size={48} status={jobOf(p.id)} thinking={jobOf(p.id) === "running"} />
                    <span>{p.name}</span>
                  </button>
                  <button type="button" className="tree-icon agent-unpin" title={t("agentUnpin", lang)} onClick={() => togglePin(p.id)}>×</button>
                </div>
              ))}
            </div>
          )}
          {profiles.length === 0 && (
            <div className="agent-empty">
              <p>{t("ofSideEmpty", lang)}</p>
              <button type="button" className="primary" onClick={() => onOfficeAgent?.({ mode: "new" })}>+ {t("ofAddInSettings", lang)}</button>
            </div>
          )}
          {agentRows.map((p) => {
            const latest = byAgent.get(p.id)?.[0];
            const on = activeAgent?.id === p.id;
            return (
              <div key={p.id} className={`sess-row agent-chat-row${on ? " active" : ""}`}>
                <button type="button" className="agent-row" onClick={() => openAgent(p.id)} title={p.name}>
                  <AgentMark mark={p.mark} color={p.color} seed={p.id} character={p.characterId} size={40} status={jobOf(p.id)} thinking={jobOf(p.id) === "running"} />
                  <span className="agent-row-text">
                    <strong>{p.name}</strong>
                    <span>{latest ? previewOf(latest) : t("agentStart", lang)}</span>
                  </span>
                </button>
                <div className="agent-row-actions">
                  <button type="button" className="tree-icon" title={t(pins.includes(p.id) ? "agentUnpin" : "agentPin", lang)} onClick={() => togglePin(p.id)}>
                    <Icon name="pin" size={13} />
                  </button>
                  <button type="button" className="tree-icon" title={t("ofEditAgent", lang)} onClick={() => onOfficeAgent?.({ mode: "edit", id: p.id })}>
                    <Icon name="sliders" size={13} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* no account here: Rove runs on this computer, so the foot says how it
          is connected and opens the app's own menu */}
      <div className="side-foot" ref={footRef} onKeyDown={(e) => { if (e.key === "Escape") setFootOpen(false); }}>
        {footOpen && (
          <div className="side-foot-menu" role="menu">
            <button type="button" role="menuitem" onClick={() => footItem(() => onOpenSettings())}><Icon name="settings" size={15} /> {t("settings", lang)}</button>
            <button type="button" role="menuitem" onClick={() => footItem(() => onOpenSettings("usage"))}><Icon name="chart" size={15} /> {t("usage", lang)}</button>
            <button type="button" role="menuitem" onClick={() => footItem(() => onOpenSettings())}><Icon name="globe" size={15} /> {t("language", lang)}</button>
            <button type="button" role="menuitem" onClick={() => footItem(onToggleTheme)}><Icon name={dark ? "sun" : "moon"} size={15} /> {t(dark ? "themeLight" : "themeDark", lang)}</button>
            {space === "chat" && (
              <button type="button" role="menuitem" onClick={() => footItem(onOpenMarket)}><Icon name="puzzle" size={15} /> {t("marketplace", lang)}</button>
            )}
            <hr />
            <div className="side-foot-version">Rove Code v{APP_VERSION}</div>
          </div>
        )}
        <button type="button" className="side-who" aria-haspopup="menu" aria-expanded={footOpen} onClick={() => setFootOpen((v) => !v)}>
          <span className="side-plan"><span className={`side-dot${rpcOk ? " ok" : ""}`} />{t(rpcOk ? "connected" : "offline", lang)}<span className="side-caret"><Icon name="chevronDown" size={12} /></span></span>
          <span className="side-usage">{usage ? `${compact(usage.totalTokens)} token · ${usage.calls} ${t("calls", lang)}` : "—"}</span>
        </button>
        <button type="button" className="tree-icon" title={t("settings", lang)} onClick={() => onOpenSettings()}><Icon name="settings" size={16} /></button>
      </div>
    </aside>
  );
}
