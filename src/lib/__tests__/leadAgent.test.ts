import { describe, expect, it } from "vitest";
import { detectLanguage, normalizeText } from "../leadAgent";
import { analyzeLead } from "../leadAnalysis";
import { classifyChat } from "../chatClassifier";

const C = (text: string) => ({ text, fromMe: false });
const M = (text: string) => ({ text, fromMe: true });
const today = new Date("2026-10-02T10:00:00");
const lead = (chat: any[], extra: any = {}) => ({ id: "L", name: "Ali Raza", status: "New", source: "WhatsApp", date: "2026-10-02", chat, ...extra });

describe("lead agent", () => {
  it("reads Urdu script", () => {
    expect(normalizeText("مجھے ریسٹورنٹ کے لیے سافٹ ویئر چاہیے، قیمت کیا ہے؟")).toMatch(/restaurant.*software.*chahiye.*price/);
    expect(normalizeText("بجٹ ۵۰ ہزار")).toMatch(/budget 50 hazar/);
    const c = classifyChat([C("السلام علیکم، فیس بک اشتہار چلوانے ہیں، کتنے پیسے لگیں گے؟")]);
    expect(c.line).toBe("Meta Ads (Facebook + Instagram)");
    expect(c.status).toBe("Interested");
    expect(detectLanguage([C("قیمت کیا ہے"), C("price batao bhai")])).toBe("mixed");
  });
  it("Urdu chat → full brief with budget and price stage", () => {
    const ai = analyzeLead(lead([C("السلام علیکم، میرے کلینک کے لیے ویب سائٹ اور فیس بک اشتہار چاہیے، بجٹ ۶۰ ہزار ہے، قیمت بتائیں")]), {}, today);
    const b = ai.brief!;
    expect(b.language).toBe("urdu");
    expect(b.business).toBe("Clinic / Hospital");
    expect(b.budget).toBe(60000);
    expect(b.needs.length).toBeGreaterThanOrEqual(2);
    expect(b.stage).toBe("Comparing price");
    expect(b.priority).not.toBe("P3");
    expect(b.summary).toMatch(/Ali/);
  });
  it("ready-to-buy big business is VIP with concrete next steps", () => {
    const ai = analyzeLead(lead([
      C("Assalam o alaikum, hamari restaurant chain hai 4 branches, sab ke liye POS software aur Meta ads chahiye"),
      M("Ji zaroor, demo dikha dete hain"),
      C("Demo dekh liya, acha hai. Budget 3 lakh hai. Advance kitna bhejna hai? Jaldi start karna hai"),
    ]), {}, today);
    const b = ai.brief!;
    expect(b.vip).toBe(true);
    expect(b.stage).toBe("Ready to buy");
    expect(b.urgency).toBe("urgent");
    expect(b.priority).toBe("P1");
    expect(b.actions.join(" ")).toMatch(/Advance|payment/i);
    expect(ai.nextAction).toMatch(/Advance|payment|jawab/i);
    expect(ai.line).toBe("Restaurant Software / DTPOS");
    expect(b.needs).not.toContain("Custom Software");
    expect(b.summary).toMatch(/^Ali/);
  });
  it("price objection and 'later' are picked up", () => {
    const b = analyzeLead(lead([C("logo ka rate kya hai?"), M("Rs 15,000"), C("ye to bohat mehnga hai, baad mein batata hun")]), {}, today).brief!;
    expect(b.objections).toEqual(expect.arrayContaining(["Qeemat zyada lag rahi hai", "Abhi soch raha hai"]));
    expect(b.urgency).toBe("later");
    expect(b.vip).toBe(false);
  });
  it("skips titles in the name and quotes the original Urdu words", () => {
    const b = analyzeLead(lead([C("السلام علیکم، کلینک کے لیے ویب سائٹ چاہیے، قیمت بتائیں")], { name: "Dr. Hina Clinic" }), {}, today).brief!;
    expect(b.summary).toMatch(/^Hina/);
    expect(b.evidence.join(" ")).toMatch(/[\u0600-\u06ff]/);
  });
  it("not interested / opt-out", () => {
    const b = analyzeLead(lead([C("nahi chahiye shukriya")]), {}, today).brief!;
    expect(b.stage).toBe("Not interested");
    expect(b.priority).toBe("P3");
  });
});
