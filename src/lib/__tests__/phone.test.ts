import { describe, expect, it } from "vitest";
import { formatLocalPhone, leadPhones, normalizePhone, waLink } from "../phone";

describe("normalizePhone", () => {
  it.each([
    ["03451873354", "923451873354"],
    ["0345-1873354", "923451873354"],
    ["+92 345 1873354", "923451873354"],
    ["923451873354", "923451873354"],
    ["00923451873354", "923451873354"],
    ["3451873354", "923451873354"],
    ["+1 (415) 555-2671", "14155552671"],
    ["", ""],
    ["abc", ""],
    ["12345", ""],
  ])("%s → %s", (input, out) => {
    expect(normalizePhone(input)).toBe(out);
  });
});

describe("helpers", () => {
  it("formats Pakistani numbers locally", () => {
    expect(formatLocalPhone("923451873354")).toBe("03451873354");
    expect(formatLocalPhone("14155552671")).toBe("+14155552671");
  });

  it("builds wa.me links in international format", () => {
    expect(waLink("0345 1873354", "Salam")).toBe("https://wa.me/923451873354?text=Salam");
    expect(waLink("")).toBeNull();
  });

  it("collects unique lead numbers", () => {
    expect(leadPhones({ phone: "03451873354", whatsapp: "+923451873354" })).toEqual(["923451873354"]);
    expect(leadPhones({ phone: "03001112233", whatsapp: "03451873354" })).toEqual(["923451873354", "923001112233"]);
  });
});
