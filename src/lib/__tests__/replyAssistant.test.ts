import { describe, expect, it } from "vitest";
import { draftReply, intentOf, qaPairs, suggestKeywords } from "../replyAssistant";

const C = (t: string) => ({ text: t, fromMe: false });
const M = (t: string) => ({ text: t, fromMe: true });

describe("reply assistant", () => {
  it("finds the intent", () => {
    expect(intentOf("POS ka rate kya hai")).toBe("price");
    expect(intentOf("demo dikhao")).toBe("demo");
    expect(intentOf("please mat bhej ab")).toBe("optout");
    expect(intentOf("Assalam o alaikum")).toBe("greeting");
  });
  it("uses catalog prices, never invented ones", () => {
    const d = draftReply([C("meta ads ka rate kitna hai")], { settings: {}, name: "Ali Khan" });
    expect(d.source).toBe("catalog");
    expect(d.text).toMatch(/Rs 17,500/);
    expect(d.text).toMatch(/Rs 700/);
  });
  it("asks what is needed when the service is unknown", () => {
    const d = draftReply([C("price kya hai")], { settings: {} });
    expect(d.source).toBe("default");
    expect(d.text).not.toMatch(/Rs \d/);
  });
  it("prefers a trained answer", () => {
    const kb = [{ id: "k1", keywords: "warranty, guarantee", answer: "{name}, 1 saal support free hai.", createdAt: "" }];
    const d = draftReply([C("warranty milegi?")], { settings: {}, name: "Sara Ahmed", kb });
    expect(d).toMatchObject({ source: "trained", matchedId: "k1" });
    expect(d.text).toBe("Sara, 1 saal support free hai.");
  });
  it("does not draft for opt-out or when we replied last", () => {
    expect(draftReply([C("stop messaging me")], { settings: {} }).text).toBe("");
    expect(draftReply([C("price?"), M("Rs 5000")], { settings: {} }).source).toBe("none");
  });
  it("replies in English to an English message", () => {
    expect(draftReply([C("Hello, can you tell me the price of your services please")], { settings: {}, name: "Tom" }).text).toMatch(/Hi Tom|Hi there/);
  });
  it("learns question → answer pairs", () => {
    const p = qaPairs([C("warranty milegi?"), M("ji 1 saal ki warranty hai"), C("thanks")]);
    expect(p).toEqual([{ q: "warranty milegi?", a: "ji 1 saal ki warranty hai" }]);
    expect(suggestKeywords("warranty milegi kya is software ki?")).toContain("warranty");
  });
});
