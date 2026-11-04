import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { splitAsk } from "../lib/ask";
import { chatPreview } from "../lib/agents";
import { AskCard } from "../app/AskCard";
import type { Message } from "../lib/types";

const reply = "Anladım.\n\n```ask\nNasıl bir konu istiyorsun?\n- Geniş kitle\n- Yeni araçlar\n```\n";

describe("an agent's question", () => {
  afterEach(cleanup);

  it("comes off the end of a reply", () => {
    expect(splitAsk(reply)).toEqual({ body: "Anladım.", ask: { question: "Nasıl bir konu istiyorsun?", options: ["Geniş kitle", "Yeni araçlar"] } });
    expect(splitAsk("```ask\nHangisi?\n- A\n- B\n```").body).toBe("");
  });

  it("is held back while it is still being written", () => {
    expect(splitAsk("Anladım.\n\n```ask\nNasıl bir")).toEqual({ body: "Anladım.", ask: null });
    expect(splitAsk("Anladım.\n\n```ask")).toEqual({ body: "Anladım.", ask: null });
  });

  it("leaves other text alone: code blocks, and a block with no real choice", () => {
    const code = "Şöyle:\n```go\nx := 1\n```";
    expect(splitAsk(code)).toEqual({ body: code, ask: null });
    const one = "```ask\nEmin misin?\n- Evet\n```";
    expect(splitAsk(one)).toEqual({ body: one, ask: null });
  });

  it("shows in the side list as its words, never as a code fence", () => {
    const m = (content: string) => ({ id: "1", sessionId: "s", role: "assistant", content, createdAt: "" }) as Message;
    expect(chatPreview([m(reply)])).toBe("Anladım.");
    expect(chatPreview([m("```ask\nHangisi?\n- A\n- B\n```")])).toBe("Hangisi?");
  });

  it("answers with a click, hands over to the message box, and closes once answered", () => {
    const pick = vi.fn();
    const other = vi.fn();
    const ask = { question: "Hangisi?", options: ["Bir", "İki"] };
    const { rerender } = render(<AskCard ask={ask} lang="tr" open onPick={pick} onOther={other} />);
    fireEvent.click(screen.getByRole("button", { name: /İki/ }));
    expect(pick).toHaveBeenCalledWith("İki");
    fireEvent.click(screen.getByRole("button", { name: /Başka bir şey/ }));
    expect(other).toHaveBeenCalled();
    rerender(<AskCard ask={ask} lang="tr" open={false} onPick={pick} onOther={other} />);
    expect((screen.getByRole("button", { name: /Bir/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: /Başka bir şey/ })).toBeNull();
  });
});
