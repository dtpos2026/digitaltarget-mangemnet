import { describe, expect, it } from "vitest";
import { parseScheduleText } from "../scheduleAI";

const today = new Date("2026-09-28T09:00:00"); // Monday
const ctx = {
  clients: [{ id: "C2", name: "Abdullah Medicare" }, { id: "C1", name: "Karachi Biryani House" }],
  leads: [{ id: "L4", name: "Cafe Aroma" }],
};

describe("parseScheduleText", () => {
  it("the spec example: client, tomorrow, follow-up, renewal note", () => {
    const s = parseScheduleText("Abdullah Medicare se kal follow-up karna hai, package renewal discuss karna hai.", ctx, today);
    expect(s.clientId).toBe("C2");
    expect(s.date).toBe("2026-09-29");
    expect(s.type).toBe("Renewal");
    expect(s.priority).toBe("High");
    expect(s.task).toMatch(/^Renewal — Abdullah Medicare: /);
    expect(s.notes).toContain("package renewal");
  });
  it("time words and lead match", () => {
    const s = parseScheduleText("Cafe Aroma ko parson 3 baje demo dikhana hai", ctx, today);
    expect(s.leadId).toBe("L4");
    expect(s.date).toBe("2026-09-30");
    expect(s.time).toBe("15:00");
    expect(s.type).toBe("Meeting");
    expect(s.reminder).toBe(new Date("2026-09-30T14:30:00").toISOString());
  });
  it("payment reminder, explicit date, urgent", () => {
    const s = parseScheduleText("Karachi Biryani House payment reminder 5 oct urgent", ctx, today);
    expect(s.type).toBe("Payment Reminder");
    expect(s.date).toBe("2026-10-05");
    expect(s.priority).toBe("High");
  });
  it("day names, 24h time, call", () => {
    const s = parseScheduleText("friday 11:30 am call karni hai new client ko", ctx, today);
    expect(s.date).toBe("2026-10-02");
    expect(s.time).toBe("11:30");
    expect(s.type).toBe("Call");
    expect(s.clientId).toBe("");
  });
  it("no date → tomorrow; sham → 17:00", () => {
    const s = parseScheduleText("designer se pending design sham ko check karna", ctx, today);
    expect(s.date).toBe("2026-09-29");
    expect(s.time).toBe("17:00");
    expect(s.type).toBe("Pending Work");
  });
});
