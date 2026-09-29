import { describe, expect, it } from "vitest";
import { ALL_CATEGORIES, Campaign, buildRecipients, categoryOfLead, clearable, contentFor, deleteBlocker, groupByCategory, sentToday } from "../campaign";

const lead = (id: string, name: string, phone: string, serviceType: string, extra: any = {}) => ({ id, name, phone, serviceType, status: "Interested", ...extra });
const media = { key: "draft:x", name: "promo.mp4", type: "video/mp4", size: 1000, kind: "video" as const };

describe("campaign content per category", () => {
  it("finds the category of a lead", () => {
    expect(categoryOfLead(lead("1", "A", "0300", "Retail POS"))).toBe("Software Development");
    expect(categoryOfLead(lead("2", "B", "0300", "Meta Ads (Facebook + Instagram)"))).toBe("Digital Marketing");
    expect(categoryOfLead(lead("3", "C", "0300", "", { ai: { category: "Creative Services" } }))).toBe("Creative Services");
    expect(categoryOfLead(lead("4", "D", "0300", "", {}))).toBe("Other");
  });
  it("each lead gets the message, link and media of its own category", () => {
    const content = {
      [ALL_CATEGORIES]: { link: "https://digitaltarget.pk" },
      "Software Development": { text: "Salam {name}! {service} ka demo dekhein.", media },
      "Digital Marketing": { link: "https://youtu.be/ads" },
    };
    const r = buildRecipients(
      [lead("1", "Ali Khan", "03001112222", "Retail POS"), lead("2", "Sara Ahmed", "03214445555", "Meta Ads (Facebook + Instagram)"), lead("3", "Zain", "03337778888", "Video Editing")],
      new Set(), {}, { lang: "en", templateMode: "auto", templateKey: "lead_followup", content }
    );
    const [sw, ads, creative] = r;
    expect(sw.text).toContain("Ali! Retail POS ka demo dekhein.");
    expect(sw.text).toContain("https://digitaltarget.pk");
    expect(sw.media?.name).toBe("promo.mp4");
    expect(ads.text).toContain("https://youtu.be/ads");
    expect(ads.text).not.toContain("digitaltarget.pk");
    expect(ads.media).toBeUndefined();
    expect(ads.text).not.toBe(sw.text);
    expect(creative.category).toBe("Creative Services");
    expect(creative.text).toContain("https://digitaltarget.pk");
    expect(groupByCategory(r).map((g) => g.category).sort()).toEqual(["Creative Services", "Digital Marketing", "Software Development"]);
  });
  it("without custom text the automatic template of the service is used", () => {
    const [a, b] = buildRecipients([lead("1", "Ali", "03001112222", "Retail POS"), lead("2", "Sara", "03214445555", "SEO")], new Set(), {}, { lang: "en", templateMode: "auto", templateKey: "lead_followup" });
    expect(a.text).not.toBe(b.text);
  });
  it("greets by first name (not the title) and never leaves an empty service", () => {
    const [r] = buildRecipients([lead("1", "Dr. Sana Clinic", "03111222333", "")], new Set(), {}, { lang: "en", templateMode: "auto", templateKey: "lead_followup" });
    expect(r.text).toContain("Sana");
    expect(r.text).not.toMatch(/Dr\./);
    expect(r.text).not.toMatch(/about\s*\./);
  });
  it("merges the all-categories entry", () => {
    expect(contentFor({ [ALL_CATEGORIES]: { link: "L", media }, X: { link: "M" } }, "X")).toMatchObject({ link: "M", media });
  });
});

describe("deleting campaigns", () => {
  const camp = (status: Campaign["status"], sentAt?: string): Campaign => ({
    id: status, name: status, status, lang: "en", templateMode: "auto", templateKey: "", delaySec: 60, dailyLimit: 50, consent: true,
    recipients: sentAt ? [{ leadId: "1", name: "A", phone: "1", line: "", templateKey: "", text: "", status: "sent", sentAt }] : [],
    alerts: [], createdAt: "2026-09-01", createdBy: "",
  });
  it("only a running campaign is protected; the daily count survives deletion", () => {
    expect(deleteBlocker(camp("running"))).toMatch(/Pause/);
    expect(deleteBlocker(camp("completed", "2026-09-29T09:00:00Z"))).toBe("");
    expect(deleteBlocker(camp("paused"))).toBe("");
    // the separate counter keeps today's total even when no campaign is left
    expect(sentToday([], "2026-09-29", 7)).toBe(7);
    expect(sentToday([camp("completed", "2026-09-29T09:00:00Z")], "2026-09-29", 0)).toBe(1);
    expect(sentToday([camp("completed", "2026-09-29T09:00:00Z")], "2026-09-29", 5)).toBe(5);
  });
  it("clears every finished campaign", () => {
    const list = [camp("completed", "2026-09-20T09:00:00Z"), camp("stopped"), camp("paused"), camp("running"), camp("completed", "2026-09-29T09:00:00Z")];
    expect(clearable(list).map((c) => c.status)).toEqual(["completed", "stopped", "completed"]);
  });
});
