import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { defaultMark, markOf, SHAPES, FACES } from "~/lib/agentmark";
import type { AgentProfile } from "~/lib/types";

describe("agent marks", () => {
  it("sleeps with its eyes closed; a working agent is marked so its eyes open", () => {
    const { container } = render(<MarkSvg m={{ shape: "circle", face: "eyes", color: "#14c8b8" }} />);
    expect(container.querySelectorAll(".mark-closed path")).toHaveLength(2);
    expect(container.querySelectorAll(".mark-open path")).toHaveLength(2);
    expect(container.querySelector(".agent-mark")?.className).toBe("agent-mark");
    cleanup();
    const working = render(<MarkSvg m={{ shape: "circle", face: "eyes", color: "#14c8b8" }} status="running" />);
    expect(working.container.querySelector(".agent-mark")?.className).toContain("running");
    cleanup();
  });
  it("an agent keeps the same mark everywhere, and a stored one wins", () => {
    expect(defaultMark("abc")).toEqual(defaultMark("abc"));
    const m = markOf("hex:happy", "#14c8b8", "abc");
    expect(m).toEqual({ shape: "hex", face: "happy", color: "#14c8b8" });
    // a color from the old muted palette reads as the vivid one that replaced it
    expect(markOf("hex:happy", "#43b3a8", "abc").color).toBe("#14c8b8");
    // unknown parts fall back to the seed's
    const d = defaultMark("abc");
    expect(markOf("blob:grin", "red", "abc")).toEqual(d);
    expect(SHAPES).toContain(d.shape);
    expect(FACES).toContain(d.face);
  });
  it("the shape follows the field; the shield is security's alone; the face is a pair of eyes", () => {
    expect(defaultMark("x", "security").shape).toBe("shield");
    expect(defaultMark("x", "frontend").shape).toBe("squircle");
    expect(defaultMark("x", "go-backend").shape).toBe("hex");
    for (let i = 0; i < 50; i++) expect(defaultMark(`agent-${i}`).shape).not.toBe("shield");
    expect(defaultMark("x", "qa").face).toBe("eyes");
    // a picked shape stays, whatever the character
    expect(markOf("drop:happy", "#43b3a8", "x", "security").shape).toBe("drop");
    // an agent saved with an old prompt face gets eyes
    expect(markOf("hex:prompt", "#43b3a8", "x").face).toBe("eyes");
  });
});

const calls: [string, unknown][] = [];
let profiles: AgentProfile[] = [];
vi.mock("../lib/rpc", () => ({
  rpc: vi.fn(async (method: string, params: unknown) => {
    calls.push([method, params]);
    switch (method) {
      case "profile.list": return profiles;
      case "session.history": return [{ id: "m1", role: "user", content: "Ödeme hatası" }, { id: "m2", role: "assistant", content: "\n**Ödeme düzeldi**, test ettim.\nİkinci satır" }];
      case "profile.upsert": return { id: "new", ...(params as object) };
      case "model.list": return [{ provider: "Codex", model: "gpt-6-luna" }, { provider: "Kira", model: "claude-sonnet-5" }];
      case "session.list": return [{ id: "s1", title: "Ödeme hatası", agentId: "a", workspaceId: "w", updatedAt: new Date().toISOString(), space: "office" }];
      case "persona.badges": return { sessions: { s1: { name: "Ayşe", profileId: "p1", characterId: "frontend" } }, default: null };
      case "persona.catalog": return {
        characters: [{ id: "frontend", name: "Frontend Uzmanı", category: "Yazılım", summary: "UI", role: "frontend", features: ["read", "write"], prompt: "You are a senior frontend engineer." }],
        features: [{ key: "read", group: "tools", name: "Dosya okuma", desc: "" }, { key: "write", group: "tools", name: "Dosya yazma", desc: "" }, { key: "shell", group: "tools", name: "Terminal", desc: "" }],
        defaults: ["read", "write", "shell"],
      };
      case "usage.get": return null;
      default: return null;
    }
  }),
  onReconnect: vi.fn(() => () => {}),
  subscribeEvents: vi.fn(() => () => {}),
  hydrateConnection: vi.fn().mockResolvedValue({ token: "t", http: "http://x" }),
  pickFolder: vi.fn(),
}));
vi.mock("../hooks/usePrefs", () => ({ usePrefs: () => ({ lang: "tr", theme: "graphite" }) }));

import { OfficePanel } from "../app/OfficePanel";
import { SessionSidebar } from "../app/SessionSidebar";
import { MarkSvg } from "../app/AgentMark";
import { subscribeEvents } from "../lib/rpc";

const ayse: AgentProfile = { id: "p1", name: "Ayşe", role: "frontend", systemPrompt: "", model: "gpt-6-luna", provider: "Codex", isDefault: false, isLeader: false, characterId: "frontend", mark: "drop:dots", color: "#e5735f" };

describe("Settings → Office", () => {
  beforeEach(() => { calls.length = 0; profiles = []; localStorage.setItem("rove.office.v2", "1"); });
  afterEach(cleanup);

  it("an empty office says how to start", async () => {
    render(<OfficePanel />);
    await screen.findByText("Henüz ajanın yok");
  });

  it("a new agent is a name and a logo; nothing else is asked", async () => {
    render(<OfficePanel intent={{ mode: "new" }} />);
    const dialog = await screen.findByRole("dialog", { name: "Yeni ajan oluştur" });
    const create = within(dialog).getByRole("button", { name: "Oluştur" }) as HTMLButtonElement;
    expect(create.disabled).toBe(true); // no name, no agent
    expect(dialog.textContent).not.toContain("Frontend Uzmanı");
    fireEvent.change(within(dialog).getByLabelText("Ad"), { target: { value: "Siber güvenlik" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "hex" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "#14c8b8" }));
    fireEvent.click(create);
    await waitFor(() => expect(calls.some(([m]) => m === "profile.upsert")).toBe(true));
    const sent = calls.find(([m]) => m === "profile.upsert")![1] as AgentProfile;
    expect(sent).toMatchObject({ name: "Siber güvenlik", color: "#14c8b8", role: "developer" });
    expect(sent.mark).toMatch(/^hex:[a-z]+$/);
    expect(sent.characterId).toBeUndefined();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("editing an agent: own prompt, a model from the list, its own permissions; no character list", async () => {
    profiles = [ayse];
    render(<OfficePanel intent={{ mode: "edit", id: "p1" }} />);
    await screen.findByLabelText("Ad");
    expect(screen.queryByText("Başlangıç karakteri")).toBeNull();
    expect(screen.queryByRole("radio", { name: "Kendi istemim" })).toBeNull();
    fireEvent.change(screen.getByPlaceholderText(/ödeme servisinden/), { target: { value: "Sen ödeme ekibindesin." } });
    const list = await screen.findByRole("listbox", { name: "Model" });
    await waitFor(() => expect(within(list).getByText("gpt-6-luna")).toBeTruthy());
    // the search narrows the list
    fireEvent.change(screen.getByPlaceholderText(/Model ara/), { target: { value: "sonnet" } });
    expect(within(list).queryByText("gpt-6-luna")).toBeNull();
    fireEvent.click(within(list).getByText("claude-sonnet-5"));
    fireEvent.click(screen.getByRole("radio", { name: "Özel izinler" }));
    fireEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    await waitFor(() => expect(calls.some(([m]) => m === "profile.upsert")).toBe(true));
    const sent = calls.find(([m]) => m === "profile.upsert")![1] as AgentProfile;
    // saving lets go of the character it was started from
    expect(sent).toMatchObject({ name: "Ayşe", characterId: "", promptMode: "", systemPrompt: "Sen ödeme ekibindesin.", model: "claude-sonnet-5", provider: "Kira" });
    expect(sent.mark).toMatch(/^[a-z]+:[a-z]+$/);
    expect(sent.color).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("Office side list", () => {
  beforeEach(() => { calls.length = 0; localStorage.setItem("rove.office.v2", "1"); });
  afterEach(cleanup);

  it("lists only the office's agents, with their logos; adding one goes to Settings", async () => {
    profiles = [ayse];
    const office = vi.fn();
    render(
      <SessionSidebar space="office" workspace={null} onSelectWorkspace={vi.fn()} activeSessionId="s1" onSelectSession={vi.fn()} draft={false} draftAgent={null}
        onNewChat={vi.fn()} rpcOk dark onToggleTheme={vi.fn()} onOpenMarket={vi.fn()} onOpenSettings={vi.fn()} onOfficeAgent={office} />,
    );
    const row = await screen.findByTitle("Ayşe");
    expect(row.querySelector(".agent-mark svg")).toBeTruthy();
    // the row is the agent's mark and the last thing said in its chat
    await waitFor(() => expect(row.textContent).toContain("Ödeme düzeldi"));
    expect(row.textContent).not.toContain("**");
    // no catalog picker in the side list any more
    expect(document.querySelector(".agent-picker")).toBeNull();
    fireEvent.click(screen.getByTitle("Ajan ekle"));
    expect(office).toHaveBeenCalledWith({ mode: "new" });
    fireEvent.click(screen.getByTitle("Ajanı düzenle"));
    expect(office).toHaveBeenCalledWith({ mode: "edit", id: "p1" });
  });

  it("the Agent space opens the latest chat, or a first chat with the first agent", async () => {
    profiles = [ayse];
    const select = vi.fn();
    render(
      <SessionSidebar space="office" workspace={null} onSelectWorkspace={vi.fn()} activeSessionId={null} onSelectSession={select} draft={false} draftAgent={null}
        onNewChat={vi.fn()} rpcOk dark onToggleTheme={vi.fn()} onOpenMarket={vi.fn()} onOpenSettings={vi.fn()} onOfficeAgent={vi.fn()} />,
    );
    await waitFor(() => expect(select).toHaveBeenCalledWith(expect.objectContaining({ id: "s1" })));
    expect(document.querySelector(".staff-board-row")).toBeNull();
  });

  it("an agent's logo thinks from the moment its run starts until it ends", async () => {
    profiles = [ayse];
    const on = new Map<string, (ev: { payload?: unknown }) => void>();
    vi.mocked(subscribeEvents).mockImplementation((name: string, fn: (ev: never) => void) => {
      on.set(name, fn as (ev: { payload?: unknown }) => void);
      return () => {};
    });
    render(
      <SessionSidebar space="office" workspace={null} onSelectWorkspace={vi.fn()} activeSessionId="s1" onSelectSession={vi.fn()} draft={false} draftAgent={null}
        onNewChat={vi.fn()} rpcOk dark onToggleTheme={vi.fn()} onOpenMarket={vi.fn()} onOpenSettings={vi.fn()} onOfficeAgent={vi.fn()} />,
    );
    const row = await screen.findByTitle("Ayşe");
    await waitFor(() => expect(on.has("run.start")).toBe(true));
    expect(row.querySelector(".pondering")).toBeNull();
    act(() => on.get("run.start")!({ payload: { sessionId: "s1" } }));
    expect(row.querySelector(".pondering")).toBeTruthy();
    act(() => on.get("run.done")!({ payload: { sessionId: "s1" } }));
    expect(row.querySelector(".pondering")).toBeNull();
    // and the row reads the chat again for its last message
    const reads = calls.filter(([m]) => m === "session.history").length;
    act(() => on.get("run.done")!({ payload: { sessionId: "s1" } }));
    await waitFor(() => expect(calls.filter(([m]) => m === "session.history").length).toBeGreaterThan(reads));
    vi.mocked(subscribeEvents).mockImplementation(() => () => {});
  });

  it("the foot opens the app's menu; there is no account in it", async () => {
    profiles = [];
    const settings = vi.fn();
    render(
      <SessionSidebar space="office" workspace={null} onSelectWorkspace={vi.fn()} activeSessionId={null} onSelectSession={vi.fn()} draft={false} draftAgent={null}
        onNewChat={vi.fn()} rpcOk dark onToggleTheme={vi.fn()} onOpenMarket={vi.fn()} onOpenSettings={settings} onOfficeAgent={vi.fn()} />,
    );
    fireEvent.click(document.querySelector(".side-who")!);
    const menu = await screen.findByRole("menu");
    expect(menu.textContent).toContain("Ayarlar");
    expect(menu.textContent).toMatch(/Rove Code v\d/);
    expect(menu.textContent).not.toMatch(/Pro|Oturumu kapat|Yardım al|Geri bildirim|Değişiklik günlüğü/);
    fireEvent.click(within(menu).getByText("Kullanım"));
    expect(settings).toHaveBeenCalledWith("usage");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("pins an agent above the list, and finds agents from the search button", async () => {
    localStorage.removeItem("rove.agents.pinned");
    profiles = [ayse, { ...ayse, id: "p2", name: "Mert" }];
    render(
      <SessionSidebar space="office" workspace={null} onSelectWorkspace={vi.fn()} activeSessionId={null} onSelectSession={vi.fn()} draft={false} draftAgent={null}
        onNewChat={vi.fn()} rpcOk dark onToggleTheme={vi.fn()} onOpenMarket={vi.fn()} onOpenSettings={vi.fn()} onOfficeAgent={vi.fn()} />,
    );
    const row = await screen.findByTitle("Mert");
    expect(document.querySelector(".agent-pins")).toBeNull();
    fireEvent.click(within(row.closest(".agent-chat-row") as HTMLElement).getByTitle("Üste sabitle"));
    // it leaves the list for the row above it, and stays there
    await waitFor(() => expect(document.querySelector(".agent-pins")?.textContent).toContain("Mert"));
    expect(document.querySelectorAll(".agent-chat-row")).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem("rove.agents.pinned")!)).toEqual(["p2"]);

    // a search looks through every agent, the pinned ones too
    fireEvent.click(screen.getByTitle("Ajan ara…"));
    fireEvent.change(screen.getByPlaceholderText("Ajan ara…"), { target: { value: "mert" } });
    expect(document.querySelector(".agent-pins")).toBeNull();
    expect(Array.from(document.querySelectorAll(".agent-chat-row strong")).map((x) => x.textContent)).toEqual(["Mert"]);
    fireEvent.keyDown(screen.getByPlaceholderText("Ajan ara…"), { key: "Escape" });
    expect(screen.queryByPlaceholderText("Ajan ara…")).toBeNull();
    expect(document.querySelector(".agent-pins")?.textContent).toContain("Mert");
    localStorage.removeItem("rove.agents.pinned");
  });

  // Code: a new session asks which mode it is for
  it("a new Code session is opened in the mode picked from the + menu", async () => {
    profiles = [];
    const newChat = vi.fn();
    render(
      <SessionSidebar space="chat" workspace={null} onSelectWorkspace={vi.fn()} activeSessionId="s1" onSelectSession={vi.fn()} draft={false} draftAgent={null}
        onNewChat={newChat} rpcOk dark onToggleTheme={vi.fn()} onOpenMarket={vi.fn()} onOpenSettings={vi.fn()} chatMode="orchestra" onChatMode={vi.fn()} />,
    );
    fireEvent.click(screen.getByTitle("Yeni oturum"));
    const menu = await screen.findByRole("menu", { name: "Yeni oturum hangi modda?" });
    expect(Array.from(menu.querySelectorAll("[role=menuitem] strong")).map((x) => x.textContent)).toEqual(["Orkestra", "Terminal"]);
    fireEvent.click(Array.from(menu.querySelectorAll("[role=menuitem]")).find((b) => b.textContent?.includes("Terminal"))!);
    expect(newChat).toHaveBeenCalledWith(null, "terminal");
    expect(screen.queryByRole("menu", { name: "Yeni oturum hangi modda?" })).toBeNull();
  });
});
