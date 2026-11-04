import { useCallback, useEffect, useRef, useState } from "react";
import { t, type Lang } from "~/lib/i18n";
import { rpc, subscribeEvents } from "~/lib/rpc";
import type { Session, Workspace } from "~/lib/types";
import { Icon } from "./Icons";

const KEY = "rove.code.tabs";

function loadTabs(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "[]") as unknown;
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function saveTabs(ids: string[]) {
  try { localStorage.setItem(KEY, JSON.stringify(ids)); } catch { /* private */ }
}

type Props = {
  lang: Lang;
  session: Session | null;
  // a new session that has no first message yet
  draft: boolean;
  workspace: Workspace | null;
  onSelect: (s: Session) => void;
  onNew: () => void;
};

// SessionTabs heads the Code space: the sessions kept open, like the tabs of
// an editor. Opening a session gives it a tab; closing one only puts it away,
// and the list on the left still has it. The folder the open session works in
// stays in view at the end.
export function SessionTabs({ lang, session, draft, workspace, onSelect, onNew }: Props) {
  const [ids, setIds] = useState<string[]>(loadTabs);
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [running, setRunning] = useState<Set<string>>(new Set());
  const activeRef = useRef<HTMLDivElement | null>(null);

  const reload = useCallback(async () => {
    try { setSessions((await rpc<Session[]>("session.list", { workspaceId: "" })) ?? []); } catch { /* keep */ }
  }, []);

  useEffect(() => {
    void reload();
    const on = () => void reload();
    window.addEventListener("rove:sessions", on);
    const off = subscribeEvents("session.updated", on);
    return () => { window.removeEventListener("rove:sessions", on); off(); };
  }, [reload]);

  useEffect(() => {
    const idOf = (ev: { payload?: unknown }) => (ev.payload as { sessionId?: string } | undefined)?.sessionId;
    const offs = [
      subscribeEvents("run.start", (ev) => { const id = idOf(ev); if (id) setRunning((s) => new Set(s).add(id)); }),
      subscribeEvents("run.done", (ev) => {
        const id = idOf(ev);
        if (id) setRunning((s) => { const n = new Set(s); n.delete(id); return n; });
      }),
    ];
    return () => offs.forEach((off) => off());
  }, []);

  const keep = useCallback((next: string[]) => { setIds(next); saveTabs(next); }, []);

  // what is opened gets a tab
  useEffect(() => {
    if (session && !ids.includes(session.id)) keep([...ids, session.id]);
  }, [session, ids, keep]);

  useEffect(() => { activeRef.current?.scrollIntoView?.({ block: "nearest", inline: "nearest" }); }, [session?.id, draft]);

  const byId = new Map((sessions ?? []).map((s) => [s.id, s]));
  if (session) byId.set(session.id, session);
  // a session deleted since is gone from the tabs too
  const open = ids.flatMap((id) => byId.get(id) ?? []);

  const close = (id: string) => {
    const at = open.findIndex((s) => s.id === id);
    const rest = open.filter((s) => s.id !== id);
    keep(rest.map((s) => s.id));
    if (session?.id !== id) return;
    const next = rest[at] ?? rest[at - 1];
    if (next) onSelect(next);
    else onNew();
  };
  const closeDraft = () => {
    const last = open[open.length - 1];
    if (last) onSelect(last);
  };

  return (
    <div className="session-tabs" lang={lang}>
      <div
        className="session-tabs-list"
        role="tablist"
        aria-label={t("sessions", lang)}
        // a mouse wheel only turns up and down: here that goes along the tabs
        onWheel={(e) => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY; }}
      >
        {open.map((s) => {
          const on = !draft && session?.id === s.id;
          return (
            <div key={s.id} ref={on ? activeRef : undefined} className={`session-tab${on ? " active" : ""}`}>
              <button
                type="button"
                role="tab"
                aria-selected={on}
                title={s.title}
                onClick={() => onSelect(s)}
                onAuxClick={(e) => { if (e.button === 1) close(s.id); }}
              >
                <span className={`session-tab-dot${running.has(s.id) ? " live" : ""}`} />
                <span className="session-tab-title">{s.title || t("chat", lang)}</span>
              </button>
              <button type="button" className="session-tab-x" title={t("close", lang)} onClick={() => close(s.id)}>×</button>
            </div>
          );
        })}
        {draft && (
          <div ref={activeRef} className="session-tab active">
            <button type="button" role="tab" aria-selected>
              <span className="session-tab-dot" />
              <span className="session-tab-title">{t("newSessionTitle", lang)}</span>
            </button>
            {open.length > 0 && <button type="button" className="session-tab-x" title={t("close", lang)} onClick={closeDraft}>×</button>}
          </div>
        )}
      </div>
      {/* the root folder ("/") is no project: nothing worth naming */}
      {workspace && workspace.name && workspace.name !== "/" && workspace.path !== "/" && (
        <span className="session-tabs-ws" title={workspace.path}>
          <Icon name="folder" size={12} />
          {workspace.name}
        </span>
      )}
    </div>
  );
}
