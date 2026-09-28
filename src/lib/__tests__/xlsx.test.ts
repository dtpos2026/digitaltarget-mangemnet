import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { buildXlsx } from "../xlsx";
import { leadsSheets } from "../leadExport";

describe("xlsx writer", () => {
  it("writes a valid workbook", () => {
    const z = unzipSync(buildXlsx([{ name: "A/B", rows: [["Name", "Amt"], ["Ali & <Co>", 1500], ["", null]] }]));
    expect(Object.keys(z).sort()).toEqual(["[Content_Types].xml", "_rels/.rels", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/workbook.xml", "xl/worksheets/sheet1.xml"]);
    const sheet = strFromU8(z["xl/worksheets/sheet1.xml"]);
    expect(sheet).toContain("Ali &amp; &lt;Co&gt;");
    expect(sheet).toContain('<c r="B2" t="n"><v>1500</v></c>');
    expect(sheet).toContain('ref="A1:B3"');
    expect(strFromU8(z["xl/workbook.xml"])).toContain('name="A B"');
  });
  it("exports leads with analysis", () => {
    const [leads, summary] = leadsSheets([{ name: "Ali", phone: "0300", status: "Interested", ai: { level: "Hot", interest: 80, nextAction: "Demo", leadType: "ads" }, source: "Facebook" }]);
    expect(leads.rows[1].slice(0, 9)).toEqual(["Ali", "0300", "", "", "", "Interested", "High", 80, "Ads lead"]);
    expect(summary.rows[2]).toEqual(["High interest", 1]);
  });
});
