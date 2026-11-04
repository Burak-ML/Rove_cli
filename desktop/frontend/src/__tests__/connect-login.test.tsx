import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ConnectPicker, type Connection } from "../app/ConnectPicker";

const calls: [string, unknown][] = [];
let catalog: Connection[] = [];
vi.mock("../lib/rpc", () => ({
  rpc: vi.fn(async (method: string, params: unknown) => {
    calls.push([method, params]);
    if (method === "connect.catalog") return catalog;
    if (method === "connect.browser") return { url: "https://auth.example/x" };
    return { ok: true };
  }),
}));

const claude: Connection = { id: "claude-code", name: "Claude Code", kind: "agent", blurb: "", tokenCmd: "claude setup-token", installed: true, loggedIn: false };
const codex: Connection = { id: "codex", name: "Codex", kind: "agent", blurb: "", browserLogin: true, installed: true, loggedIn: false };

async function open(c: Connection) {
  catalog = [c];
  render(<ConnectPicker lang="tr" providers={[]} onDone={vi.fn()} onClose={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: new RegExp(c.name) }));
}

describe("what the list shows", () => {
  afterEach(() => { cleanup(); calls.length = 0; });

  const hermes: Connection = { id: "hermes", name: "Hermes Agent", kind: "agent", blurb: "", onDevice: true, installed: true };
  const opencode: Connection = { id: "opencode", name: "OpenCode", kind: "agent", blurb: "", onDevice: true, free: true, install: "curl x | bash", installed: false };
  const kimi: Connection = { id: "kimi", name: "Kimi Code", kind: "agent", blurb: "", fullOnly: true, installed: true, loggedIn: true };

  it("what brings its own providers sits with what runs on this computer", async () => {
    catalog = [claude, hermes, opencode];
    render(<ConnectPicker lang="tr" providers={[]} onDone={vi.fn()} onClose={vi.fn()} />);
    const local = (await screen.findByText("Bu bilgisayarda çalışan")).closest("section")!;
    expect(local.textContent).toContain("Hermes Agent");
    expect(local.textContent).toContain("OpenCode");
    const account = screen.getByText("Hesabınla bağlan").closest("section")!;
    expect(account.textContent).toContain("Claude Code");
    expect(account.textContent).not.toContain("Hermes Agent");
    expect(account.textContent).not.toContain("OpenCode");
  });

  it("a free tool that is not installed says so, and is looked for after its install", async () => {
    await open({ id: "opencode", name: "OpenCode", kind: "agent", blurb: "", free: true, install: "curl x | bash", installed: false });
    expect((screen.getByRole("button", { name: "Bağla" }) as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    catalog = [opencode];
    render(<ConnectPicker lang="tr" providers={[]} onDone={vi.fn()} onClose={vi.fn()} />);
    expect((await screen.findByRole("button", { name: /OpenCode/ })).textContent).toContain("ücretsiz · kurulmalı");
  });

  it("what cannot be limited offers no lesser access, and is not offered for an agent", async () => {
    await open(kimi);
    expect(screen.queryByRole("radio", { name: "Dosya düzenleme" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Bağla" }));
    await waitFor(() => expect(calls).toContainEqual(["connect.add", { id: "kimi", access: "full" }]));
    cleanup();
    catalog = [kimi, claude];
    render(<ConnectPicker lang="tr" providers={[]} forAgent onDone={vi.fn()} onClose={vi.fn()} />);
    await screen.findByRole("button", { name: /Claude Code/ });
    expect(screen.queryByRole("button", { name: /Kimi Code/ })).toBeNull();
  });
});

describe("signing in to an account system", () => {
  afterEach(() => { cleanup(); calls.length = 0; });

  it("Claude Code takes a setup token: made in a terminal, pasted here, kept by the daemon", async () => {
    await open(claude);
    expect(screen.queryByRole("button", { name: /^Giriş/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Token oluştur/ }));
    await waitFor(() => expect(calls).toContainEqual(["connect.terminal", { id: "claude-code", step: "token" }]));
    fireEvent.change(screen.getByLabelText("Setup token"), { target: { value: "test-token" } });
    fireEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    await waitFor(() => expect(calls).toContainEqual(["connect.token", { id: "claude-code", token: "test-token" }]));
  });

  it("a saved token can be removed", async () => {
    await open({ ...claude, loggedIn: true, tokenSaved: true });
    expect(screen.getByText("Token kayıtlı")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Token'ı kaldır" }));
    await waitFor(() => expect(calls).toContainEqual(["connect.token", { id: "claude-code", token: "" }]));
  });

  it("Codex signs in through the browser with no terminal, and says where to go", async () => {
    await open(codex);
    fireEvent.click(screen.getByRole("button", { name: /Tarayıcıda giriş yap/ }));
    await waitFor(() => expect(calls).toContainEqual(["connect.browser", { id: "codex", step: "login" }]));
    expect(await screen.findByText("Tarayıcıda girişin bekleniyor…")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Tarayıcı açılmadıysa/ })).toBeTruthy();
    expect(calls.some(([m]) => m === "connect.terminal")).toBe(false);
  });

  it("a custom provider lives in Add: the model id is optional, the list comes from the address", async () => {
    catalog = [codex];
    render(<ConnectPicker lang="tr" providers={[]} onDone={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: /Özel sağlayıcı/ }));
    const connect = screen.getByRole("button", { name: "Bağla" }) as HTMLButtonElement;
    expect(connect.disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText("my-provider"), { target: { value: "ev" } });
    fireEvent.change(screen.getByPlaceholderText("https://api.example.com/v1"), { target: { value: "http://x/v1" } });
    expect(connect.disabled).toBe(false);
    fireEvent.click(connect);
    await waitFor(() => expect(calls.find(([m]) => m === "provider.upsert")?.[1]).toMatchObject({ name: "ev", baseUrl: "http://x/v1", models: [] }));
  });
});
