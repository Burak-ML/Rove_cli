import { useCallback, useEffect, useRef, useState } from "react";
import { rpc } from "~/lib/rpc";
import type {
  Agent, AgentProfile, Goal, InstalledSkill, Message,
  Provider, Session, Workspace,
} from "~/lib/types";

export function useAgents() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const reload = useCallback(async () => {
    try { setAgents((await rpc<Agent[]>("agent.list")) ?? []); } catch { setAgents((prev) => prev); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  return { agents, reload };
}

export function useSessions(workspaceId?: string) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loaded, setLoaded] = useState(false);
  const reload = useCallback(async () => {
    try {
      setSessions((await rpc<Session[]>("session.list", { workspaceId: workspaceId ?? "" })) ?? []);
    } catch {
      setSessions([]);
    } finally {
      setLoaded(true);
    }
  }, [workspaceId]);
  useEffect(() => { setLoaded(false); void reload(); }, [reload]);
  return { sessions, reload, loaded };
}

export function useHistory(sessionId: string | null) {
  const [messages, setMessages] = useState<Message[]>([]);
  // Only the latest read may land: an older one (another chat's, or one
  // overtaken by a newer read) answering late would put back a past state.
  const gen = useRef(0);
  // messages added from events while a read is on its way; the daemon may
  // have answered it before they were stored
  const added = useRef<Message[] | null>(null);
  const reload = useCallback(async () => {
    const my = ++gen.current;
    if (!sessionId) { setMessages([]); return; }
    const mine: Message[] = [];
    added.current = mine;
    try {
      const got = (await rpc<Message[]>("session.history", { sessionId })) ?? [];
      if (my !== gen.current) return;
      const have = new Set(got.map((m) => m.id));
      setMessages([...got, ...mine.filter((m) => !have.has(m.id))]);
    } catch { /* keep */ } finally {
      if (added.current === mine) added.current = null;
    }
  }, [sessionId]);
  // push adds one message the daemon announced, so a running reply does not
  // read the whole chat back after every tool call
  const push = useCallback((m: Message) => {
    if (!sessionId || m.sessionId !== sessionId) return;
    added.current?.push(m);
    setMessages((cur) => (cur.some((x) => x.id === m.id) ? cur : [...cur, m]));
  }, [sessionId]);
  useEffect(() => { void reload(); }, [reload]);
  return { messages, reload, push };
}

export function useGoals() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const reload = useCallback(async () => {
    try { setGoals((await rpc<Goal[]>("goal.list")) ?? []); } catch { /* keep */ }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  return { goals, reload };
}

export function useWorkspaces() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const reload = useCallback(async () => {
    try { setWorkspaces((await rpc<Workspace[]>("workspace.list")) ?? []); } catch { /* keep */ }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  return { workspaces, reload };
}

export function useSkills() {
  const [skills, setSkills] = useState<InstalledSkill[]>([]);
  const reload = useCallback(async () => {
    try { setSkills((await rpc<InstalledSkill[]>("skill.list")) ?? []); } catch { /* keep */ }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  return { skills, reload };
}

// providersChanged tells every list of providers and models (the chat's
// model picker among them) to read them again.
export function providersChanged() {
  window.dispatchEvent(new Event("rove:providers"));
}

export function useProviders() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const load = useCallback(async () => {
    try { setProviders((await rpc<Provider[]>("provider.list")) ?? []); } catch { /* keep */ }
  }, []);
  useEffect(() => {
    void load();
    const on = () => void load();
    window.addEventListener("rove:providers", on);
    return () => window.removeEventListener("rove:providers", on);
  }, [load]);
  // after a change: this list and every other one read again
  const reload = useCallback(async () => {
    await load();
    providersChanged();
  }, [load]);
  return { providers, reload };
}

export function useProfiles() {
  const [profiles, setProfiles] = useState<AgentProfile[]>([]);
  // the daemon has answered at least once, so an empty list means no agents
  const [loaded, setLoaded] = useState(false);
  const reload = useCallback(async () => {
    try {
      setProfiles(await rpc<AgentProfile[]>("profile.list") ?? []);
      setLoaded(true);
    } catch { /* keep */ }
  }, []);
  useEffect(() => {
    void reload();
    // Every caller of this hook has its own copy of `profiles`; a save in
    // one (e.g. Settings → Profiles) would otherwise leave others (e.g. the
    // sidebar's Agents tab) showing a stale list until they happen to remount.
    const on = () => void reload();
    window.addEventListener("rove:profiles", on);
    return () => window.removeEventListener("rove:profiles", on);
  }, [reload]);
  return { profiles, loaded, reload };
}
