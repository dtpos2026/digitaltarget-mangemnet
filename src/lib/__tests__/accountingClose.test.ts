import { describe, expect, it } from "vitest";
import { clearableEntries, dayArchiveKey, entriesToCloseDay, isDayArchive, walletEffect } from "../accountingClose";
import { activeOnly, recordsToArchive } from "../closing";

const acc = [
  { id: "A1", date: "2026-09-10", type: "IN", amount: 5000 },
  { id: "A2", date: "2026-09-30", type: "OUT", amount: 1000 },
  { id: "A3", date: "2026-10-01", type: "OUT", amount: 300 },
  { id: "A4", date: "2026-08-20", type: "IN", amount: 900, archivedMonth: "2026-08" },
  { id: "A5", date: "2026-10-01", type: "IN", amount: 50, archivedMonth: dayArchiveKey("2026-10-01") },
];

describe("accounting close", () => {
  it("month close archives every open entry up to the month end", () => {
    expect(recordsToArchive({ accounting: acc }, "2026-09").accounting).toEqual(["A1", "A2"]);
  });
  it("day close takes open entries up to that day only", () => {
    expect(entriesToCloseDay(acc, "2026-09-30").map((a) => a.id)).toEqual(["A1", "A2"]);
    expect(entriesToCloseDay(acc, "2026-10-01").map((a) => a.id)).toEqual(["A1", "A2", "A3"]);
    expect(isDayArchive(dayArchiveKey("2026-10-01"))).toBe(true);
    expect(activeOnly(acc).map((a) => a.id)).toEqual(["A1", "A2", "A3"]);
  });
  it("only entries of closed months (with a snapshot) can be cleared", () => {
    expect(clearableEntries(acc, new Set(["2026-08"])).map((a) => a.id)).toEqual(["A4"]);
    expect(clearableEntries(acc, new Set(["2026-08", "2026-10"])).map((a) => a.id)).toEqual(["A4", "A5"]);
  });
  it("wallet effect", () => {
    expect(walletEffect(acc[0])).toBe(5000);
    expect(walletEffect(acc[1])).toBe(-1000);
  });
});
