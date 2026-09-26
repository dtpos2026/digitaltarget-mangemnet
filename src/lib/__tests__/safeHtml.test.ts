import { describe, expect, it } from "vitest";
import { escapeHtml, sanitizeHtml, writeSafeDocument } from "../safeHtml";

describe("safeHtml", () => {
  it("escapes user text", () => {
    expect(escapeHtml(`<img src=x onerror="alert(1)">&'`)).toBe("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;&#39;");
  });

  it("strips scripts and event handlers but keeps styling and data images", () => {
    const out = sanitizeHtml(
      `<style>.a{color:red}</style><div style="padding:4px"><b>Ali</b><img src="data:image/png;base64,AAAA"><img src=x onerror="alert(1)"><script>alert(2)</script></div>`
    );
    expect(out).toContain("<style>.a{color:red}</style>");
    expect(out).toContain('style="padding:4px"');
    expect(out).toContain('src="data:image/png;base64,AAAA"');
    expect(out).not.toContain("onerror");
    expect(out).not.toContain("<script");
  });

  it("writes a sanitised full document keeping head styles", () => {
    const frame = document.createElement("iframe");
    document.body.appendChild(frame);
    const w = frame.contentWindow as Window;
    writeSafeDocument(w, `<html><head><title>Invoice</title><style>body{margin:0}</style></head><body><h1 onclick="x()">INV</h1><script>alert(1)</script></body></html>`);
    const html = w.document.documentElement.outerHTML;
    expect(html).toContain("<title>Invoice</title>");
    expect(html).toContain("body{margin:0}");
    expect(html).toContain("<h1>INV</h1>");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onclick");
  });
});
