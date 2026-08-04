import { describe, expect, it } from "vitest";
import { linkifyText } from "./linkifyText";

describe("linkifyText", () => {
  it("returns a single text segment when there are no URLs", () => {
    expect(linkifyText("Buy-in $20 before week 1.")).toEqual([
      { type: "text", value: "Buy-in $20 before week 1." },
    ]);
  });

  it("linkifies an https URL in a description", () => {
    expect(
      linkifyText(
        "$20 buy in please Venmo https://venmo.com/u/Will-Rowston Before week 1.",
      ),
    ).toEqual([
      { type: "text", value: "$20 buy in please Venmo " },
      {
        type: "url",
        value: "https://venmo.com/u/Will-Rowston",
        href: "https://venmo.com/u/Will-Rowston",
      },
      { type: "text", value: " Before week 1." },
    ]);
  });

  it("keeps trailing punctuation outside the link", () => {
    expect(linkifyText("Pay at https://example.com/pay.")).toEqual([
      { type: "text", value: "Pay at " },
      {
        type: "url",
        value: "https://example.com/pay",
        href: "https://example.com/pay",
      },
      { type: "text", value: "." },
    ]);
  });

  it("linkifies multiple URLs", () => {
    expect(
      linkifyText("Chat http://example.com/chat and pay https://venmo.com/u/x"),
    ).toEqual([
      { type: "text", value: "Chat " },
      {
        type: "url",
        value: "http://example.com/chat",
        href: "http://example.com/chat",
      },
      { type: "text", value: " and pay " },
      {
        type: "url",
        value: "https://venmo.com/u/x",
        href: "https://venmo.com/u/x",
      },
    ]);
  });

  it("does not treat javascript: as a link", () => {
    expect(linkifyText("javascript:alert(1)")).toEqual([
      { type: "text", value: "javascript:alert(1)" },
    ]);
  });

  it("preserves newlines around links", () => {
    expect(
      linkifyText("Line one\nhttps://example.com\nLine three"),
    ).toEqual([
      { type: "text", value: "Line one\n" },
      {
        type: "url",
        value: "https://example.com",
        href: "https://example.com",
      },
      { type: "text", value: "\nLine three" },
    ]);
  });
});
