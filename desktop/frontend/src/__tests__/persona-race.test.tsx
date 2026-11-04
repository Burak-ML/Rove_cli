import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { usePersona } from "../hooks/usePersona";

const waiting = new Map<string, (v: unknown) => void>();
vi.mock("../lib/rpc", () => ({
  rpc: vi.fn((method: string, params: { sessionId: string }) => {
    if (method !== "persona.get") return Promise.resolve(null);
    return new Promise((res) => waiting.set(params.sessionId, res));
  }),
}));

function Who({ id }: { id: string }) {
  const { view } = usePersona(id);
  return <p>{view ? (view as unknown as { name: string }).name : "—"}</p>;
}

describe("usePersona", () => {
  afterEach(cleanup);

  it("an older chat answering late does not put its agent on the open chat", async () => {
    const { rerender } = render(<Who id="red" />);
    rerender(<Who id="yellow" />);
    rerender(<Who id="red" />);
    await waitFor(() => expect(waiting.has("yellow")).toBe(true));
    await act(async () => { waiting.get("red")!({ name: "Kırmızı" }); });
    await act(async () => { waiting.get("yellow")!({ name: "Sarı" }); });
    expect(screen.getByText("Kırmızı")).toBeTruthy();
    expect(screen.queryByText("Sarı")).toBeNull();
  });
});
