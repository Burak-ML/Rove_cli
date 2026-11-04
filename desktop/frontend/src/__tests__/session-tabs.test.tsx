import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { SessionTabs } from "../app/SessionTabs";
import type { Session } from "../lib/types";

const s = (id: string, title: string): Session => ({ id, title, agentId: "a", workspaceId: "w", updatedAt: "", space: "chat" });
const a = s("a", "Birinci");
const b = s("b", "İkinci");
let list: Session[] = [];
const on: Record<string, (ev: { payload?: unknown }) => void> = {};
vi.mock("../lib/rpc", () => ({
  rpc: vi.fn(async () => list),
  subscribeEvents: vi.fn((name: string, fn: (ev: { payload?: unknown }) => void) => { on[name] = fn; return () => {}; }),
}));

const props = { lang: "tr" as const, draft: false, workspace: null, onSelect: vi.fn(), onNew: vi.fn() };
const titles = () => Array.from(document.querySelectorAll(".session-tab-title")).map((x) => x.textContent);

describe("session tabs", () => {
  beforeEach(() => { localStorage.removeItem("rove.code.tabs"); list = [a, b]; props.onSelect = vi.fn(); props.onNew = vi.fn(); });
  afterEach(cleanup);

  it("what is opened gets a tab, kept for the next time", async () => {
    const { rerender } = render(<SessionTabs {...props} session={a} />);
    await waitFor(() => expect(titles()).toEqual(["Birinci"]));
    rerender(<SessionTabs {...props} session={b} />);
    await waitFor(() => expect(titles()).toEqual(["Birinci", "İkinci"]));
    expect(document.querySelector(".session-tab.active")?.textContent).toContain("İkinci");
    cleanup();
    render(<SessionTabs {...props} session={null} />);
    await waitFor(() => expect(titles()).toEqual(["Birinci", "İkinci"]));
  });

  it("a click switches; closing the open tab moves to its neighbor, the last one to a new session", async () => {
    localStorage.setItem("rove.code.tabs", JSON.stringify(["a", "b"]));
    render(<SessionTabs {...props} session={a} />);
    await waitFor(() => expect(titles()).toHaveLength(2));
    fireEvent.click(screen.getByRole("tab", { name: /İkinci/ }));
    expect(props.onSelect).toHaveBeenCalledWith(b);
    fireEvent.click(within(document.querySelector(".session-tab.active") as HTMLElement).getByTitle("Kapat"));
    expect(props.onSelect).toHaveBeenLastCalledWith(b);
    cleanup();
    localStorage.setItem("rove.code.tabs", JSON.stringify(["a"]));
    render(<SessionTabs {...props} session={a} />);
    await waitFor(() => expect(titles()).toHaveLength(1));
    fireEvent.click(within(document.querySelector(".session-tab.active") as HTMLElement).getByTitle("Kapat"));
    expect(props.onNew).toHaveBeenCalled();
  });

  it("the mouse wheel moves along the tabs; a trackpad's sideways swipe is left alone", async () => {
    render(<SessionTabs {...props} session={a} />);
    const list = await screen.findByRole("tablist");
    fireEvent.wheel(list, { deltaY: 120 });
    expect(list.scrollLeft).toBe(120);
    fireEvent.wheel(list, { deltaY: -50 });
    expect(list.scrollLeft).toBe(70);
    fireEvent.wheel(list, { deltaX: 40, deltaY: 5 });
    expect(list.scrollLeft).toBe(70);
  });

  it("a draft has a tab of its own, a deleted session loses its tab, a working one shows it", async () => {
    localStorage.setItem("rove.code.tabs", JSON.stringify(["a", "gone"]));
    render(<SessionTabs {...props} session={null} draft />);
    await waitFor(() => expect(titles()).toEqual(["Birinci", "Yeni oturum"]));
    expect(document.querySelector(".session-tab.active")?.textContent).toContain("Yeni oturum");
    act(() => on["run.start"]({ payload: { sessionId: "a" } }));
    expect(document.querySelector(".session-tab-dot.live")).toBeTruthy();
    act(() => on["run.done"]({ payload: { sessionId: "a" } }));
    expect(document.querySelector(".session-tab-dot.live")).toBeNull();
  });
});
