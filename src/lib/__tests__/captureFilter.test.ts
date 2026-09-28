import { describe, expect, it } from "vitest";
import { assessChat, blockEntry, DEFAULT_FILTER, labelLevel } from "../captureFilter";
import { adsSignal } from "../leadAnalysis";

const L = (...t: string[]) => t.map((text, i) => ({ text, fromMe: i % 2 === 1 }));
const f = (p = {}) => ({ ...DEFAULT_FILTER, ...p });

describe("capture filter", () => {
  it("detects Facebook ad leads", () => {
    expect(adsSignal(L("Hello! Can I get more info on this?"))).toBe(true);
    expect(adsSignal(L("Aap ka ad dekha facebook par"))).toBe(true);
    expect(adsSignal(L("POS ka rate kya hai"))).toBe(false);
    expect(adsSignal(L("hi"), { ad: true })).toBe(true);
  });
  it("skips courier / OTP / bank and chats with no business signal", () => {
    expect(assessChat({ name: "TCS" }, L("Your parcel CN 12345 is out for delivery, rider will call"), {}, f()).excluded).toMatch(/Courier/);
    expect(assessChat({ name: "HBL" }, L("Your OTP is 4432. Do not share this code"), {}, f()).excluded).toMatch(/Courier/);
    expect(assessChat({ name: "Ammi" }, L("khana kha liya? shaam ko aa jana"), {}, f()).excluded).toMatch(/personal/);
  });
  it("keeps real leads and analyses them", () => {
    const a = assessChat({ name: "Ali" }, L("restaurant software ka price kya hai? demo chahiye"), {}, f());
    expect(a.excluded).toBeNull();
    expect(a.group).toBe("Software Development");
    expect(["Hot", "Warm"]).toContain(a.level);
  });
  it("a courier word inside a real sale is not excluded", () => {
    expect(assessChat({ name: "Ali" }, L("courier wali app banwani hai, price batayein"), {}, f()).excluded).toBeNull();
  });
  it("source, group and level filters", () => {
    const ad = L("Hello! Can I get more info on this?", "ji batayein", "Meta ads ka rate kitna hai");
    expect(assessChat({ name: "Sara" }, ad, {}, f({ source: "ads" })).excluded).toBeNull();
    expect(assessChat({ name: "Sara" }, ad, {}, f({ source: "organic" })).excluded).toMatch(/Ads lead hai/);
    expect(assessChat({ name: "Sara" }, ad, {}, f({ group: "Software Development" })).excluded).toMatch(/Category/);
    expect(assessChat({ name: "Sara" }, L("website ka price?"), {}, f({ levels: { Hot: false, Warm: false, Cold: false } })).excluded).toMatch(/Interest/);
  });
  it("saved contacts, labels and the never-capture list", () => {
    const chat = L("logo design ka rate kya hai");
    expect(assessChat({ name: "Bilal", saved: true }, chat, {}, f({ excludeSaved: true })).excluded).toMatch(/saved/);
    expect(assessChat({ name: "Bilal", labels: ["Family"] }, chat, {}, f({ excludeLabels: ["family"] })).excluded).toMatch(/Family/i);
    expect(assessChat({ name: "Bilal", labels: ["Hot lead"] }, chat, {}, f({ onlyLabels: ["Client"] })).excluded).toMatch(/labels/);
    const block = [blockEntry({ name: "Bilal", phone: "03001234567" })];
    expect(assessChat({ name: "Bilal", phone: "923001234567" }, chat, {}, f(), block).excluded).toMatch(/kabhi capture/);
  });
  it("a WhatsApp label sets the interest level", () => {
    expect(labelLevel(["Hot lead"])).toBe("Hot");
    expect(labelLevel(["Follow up"])).toBe("Warm");
    expect(labelLevel(["Cold"])).toBe("Cold");
    expect(labelLevel(["Family"])).toBeNull();
    const a = assessChat({ name: "X", labels: ["Cold"] }, L("website ka price?"), {}, f());
    expect(a.level).toBe("Cold");
    expect(a.levelBy).toBe("label");
  });
});
