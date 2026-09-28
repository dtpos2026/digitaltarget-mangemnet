import { describe, expect, it } from "vitest";
import { Campaign, buildRecipients, campaignStats, clampDaily, clampDelay, safetyCheck, sentToday } from "../campaign";

const leads = [
  { id: "1", name: "Bilal Ahmed", phone: "03001234567", serviceType: "Meta Ads (Facebook + Instagram)", status: "Interested" },
  { id: "2", name: "Hassan", phone: "03224445555", serviceType: "Video Editing", status: "New" },
  { id: "3", name: "Dup", phone: "0300-1234567", status: "New" },
  { id: "4", name: "Stopper", phone: "03111222333", status: "New", optOut: true },
  { id: "5", name: "Bad", phone: "12", status: "New" },
  { id: "6", name: "Lost one", phone: "03009998887", status: "Lost" },
  { id: "7", name: "Listed", phone: "03451112222", status: "New" },
];

describe("buildRecipients", () => {
  const r = buildRecipients(leads, new Set(["923451112222"]), {}, { lang: "en", templateMode: "auto", templateKey: "lead_followup" });
  it("personalises by service line and first name", () => {
    expect(r[0].status).toBe("queued");
    expect(r[0].templateKey).toBe("line:Meta Ads (Facebook + Instagram)");
    expect(r[0].text).toContain("Bilal");
    expect(r[0].text).toContain("Facebook / Instagram ads");
    expect(r[1].text).toContain("video editing");
  });
  it("skips duplicates, opt-outs (lead flag and list), invalid numbers and lost leads", () => {
    expect(r.map((x) => x.status)).toEqual(["queued", "queued", "skipped", "skipped", "skipped", "skipped", "skipped"]);
    expect(r[2].reason).toMatch(/Duplicate/);
    expect(r[3].reason).toMatch(/Opt-out/);
    expect(r[4].reason).toMatch(/Number/);
    expect(r[5].reason).toMatch(/Lost/);
    expect(r[6].reason).toMatch(/Opt-out/);
  });
});

const camp = (statuses: string[], extra: Partial<Campaign> = {}): Campaign => ({
  id: "c", name: "t", status: "running", lang: "en", templateMode: "auto", templateKey: "", delaySec: 60, dailyLimit: 50,
  consent: true, alerts: [], createdAt: "", createdBy: "",
  recipients: statuses.map((s, i) => ({ leadId: String(i), name: "", phone: "92300" + i, line: "", templateKey: "", text: "", status: s as never, sentAt: s === "queued" ? undefined : new Date().toISOString() })),
  ...extra,
});

describe("safety", () => {
  it("floors cannot be lowered", () => {
    expect(clampDelay(5)).toBe(30);
    expect(clampDaily(5000)).toBe(200);
  });
  it("pauses at the daily limit", () => {
    expect(safetyCheck(camp(["queued"], { dailyLimit: 10 }), 10)).toMatchObject({ pause: true, alert: { type: "daily_limit" } });
    expect(safetyCheck(camp(["queued"], { dailyLimit: 10 }), 9).pause).toBe(false);
  });
  it("pauses after 3 failures in a row or >30% failures", () => {
    expect(safetyCheck(camp(["sent", "failed", "failed", "failed"]), 0).alert?.type).toBe("consecutive_failures");
    expect(safetyCheck(camp(["sent", "sent", "failed", "sent", "failed", "sent", "failed"]), 0).alert?.type).toBe("failure_rate");
    expect(safetyCheck(camp(["sent", "sent", "sent", "sent", "failed"]), 0).pause).toBe(false);
  });
  it("counts today's sends across campaigns", () => {
    expect(sentToday([camp(["sent", "failed", "queued"]), camp(["sent"])])).toBe(3);
  });
});

describe("stats", () => {
  it("reports sent, replies, interested and converted from lead status", () => {
    const c = camp(["sent", "replied", "failed", "skipped", "queued"]);
    const s = campaignStats(c, [{ id: "0", status: "Interested" }, { id: "1", status: "Converted" }]);
    expect(s).toMatchObject({ selected: 5, sent: 2, replies: 1, failed: 1, skipped: 1, queued: 1, interested: 1, converted: 1, responseRatio: 50 });
  });
});
