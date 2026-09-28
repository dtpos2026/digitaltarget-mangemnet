import { describe, expect, it } from "vitest";
import { roleKind, suggestAssignee, taskKind } from "../assignAI";

const today = new Date("2026-09-28T10:00:00");
const team = [
  { id: "T1", name: "Hamza", role: "Graphic Designer" },
  { id: "T3", name: "Fatima", role: "Video Editor" },
  { id: "T4", name: "Usman", role: "Developer" },
  { id: "T2", name: "Ahmed", role: "Sales / Lead Manager" },
];
const rich = { accounting: [{ type: "IN", category: "Invoice Paid", amount: 300000, date: "2026-09-02" }, { type: "OUT", category: "Team Salary", amount: 50000, date: "2026-09-03" }] };

describe("assignment suggestions", () => {
  it("maps roles and task types", () => {
    expect(roleKind("Video Editor")).toBe("video");
    expect(taskKind("5 reels edit karni hain")).toBe("video");
    expect(taskKind("logo design")).toBe("designer");
    expect(taskKind("website bug fix")).toBe("developer");
  });
  it("gives video editing to the video editor", () => {
    const s = suggestAssignee({ team, assignments: [], ...rich }, { title: "Medicare reels", category: "Video Editing", cost: 5000 }, today);
    expect(s).toMatchObject({ who: "member", memberId: "T3" });
    expect(s.reason).toMatch(/Fatima/);
  });
  it("prefers a free member of the right role over a busy one", () => {
    const busy = [1, 2, 3].map((i) => ({ id: "a" + i, memberId: "T1", status: "In Progress" }));
    const s = suggestAssignee({ team: [...team, { id: "T5", name: "Sara", role: "Designer" }], assignments: busy, ...rich }, { title: "post design", cost: 2000 }, today);
    expect(s.memberId).toBe("T5");
  });
  it("tight budget and no urgency → do it yourself", () => {
    const poor = { accounting: [{ type: "IN", category: "Invoice Paid", amount: 20000, date: "2026-09-02" }, { type: "OUT", category: "Team Salary", amount: 30000, date: "2026-09-03" }] };
    const busy = [1, 2].map((i) => ({ id: "a" + i, memberId: "T3", status: "In Progress" }));
    const s = suggestAssignee({ team, assignments: busy, ...poor }, { title: "reel edit", deadline: "2026-10-10T18:00", cost: 5000 }, today);
    expect(s.who).toBe("self");
    expect(s.reason).toMatch(/budget kam/);
  });
});
