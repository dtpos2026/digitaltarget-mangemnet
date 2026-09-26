import { escapeHtml, sanitizeHtml, writeSafeDocument } from "./safeHtml";
import html2canvas from "html2canvas";
import { BRAND_MARK_SVG } from "@/components/app/BrandMark";

// ---------- Branding for every report ----------
// DataContext keeps this in sync with the workspace settings, so report
// builders don't need to pass company details around.
let branding: Record<string, any> = {};
export function setReportBranding(settings: Record<string, any> | undefined) {
  branding = settings || {};
}

const REPORT_CSS = `
  .dtr{width:100%;box-sizing:border-box;background:#fff;color:#1F1633;font-family:Inter,'Segoe UI',Arial,sans-serif;font-size:12.5px;line-height:1.45}
  .dtr *{box-sizing:border-box}
  .dtr-head{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:18px 26px;background:linear-gradient(135deg,#3D096D,#5B21B6);color:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .dtr-logo{display:flex;align-items:center;gap:10px}
  .dtr-logo img{max-height:52px;max-width:170px;object-fit:contain;background:#fff;border-radius:8px;padding:4px}
  .dtr-word{font-weight:800;font-size:17px;line-height:1.02;letter-spacing:1px}
  .dtr-title{text-align:right}
  .dtr-title h1{margin:0;font-size:20px;font-weight:800;letter-spacing:.3px;color:#fff}
  .dtr-title div{font-size:11px;opacity:.85}
  .dtr-bar{height:4px;background:linear-gradient(90deg,#16A34A,#5B21B6);-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .dtr-body{padding:18px 26px}
  .dtr-body h2,.dtr-body h3{color:#3D096D;margin:12px 0 6px}
  .dtr-body hr{border:0;border-top:1px solid #ECE7F5;margin:12px 0}
  .dtr-body table{width:100%;border-collapse:collapse;margin:6px 0 10px}
  .dtr-body th{background:#3D096D;color:#fff;text-align:left;padding:7px 8px;font-size:10.5px;text-transform:uppercase;letter-spacing:.5px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .dtr-body td{border-bottom:1px solid #ECE7F5;padding:7px 8px;font-size:12px;vertical-align:top}
  .dtr-body tr:nth-child(even) td{background:#FAF7FE;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .dtr-body .card{border:1px solid #E4DAF3;border-radius:12px;padding:10px;background:#FAF7FE}
  .dtr-foot{display:flex;justify-content:space-between;gap:12px;padding:10px 26px;border-top:3px solid #3D096D;font-size:10.5px;color:#6B6280}
  .dtr-foot b{color:#3D096D}
  .r-top{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}
  .r-title{margin:0;font-size:26px;font-weight:900}
  .r-meta{font-size:12px;color:#111}
  .r-box{border:1px solid #E4DAF3;border-radius:12px;padding:10px;margin-top:10px}
  .r-total{display:flex;justify-content:flex-end;margin-top:10px}
  .tbox{min-width:70mm;border:1px solid #E4DAF3;border-radius:12px;padding:10px}
  .nowrapRow{display:flex;justify-content:space-between;gap:10px}
  .nowrapRow *{white-space:nowrap}
  .small{font-size:11.5px;color:#6B6280}
`;

function logoHTML() {
  if (branding.logo?.data) return `<img src="${escapeHtml(branding.logo.data)}" alt="logo" />`;
  return `${BRAND_MARK_SVG("#fff", 40)}<div class="dtr-word">DIGITAL<br/>TARGET</div>`;
}

/** Wraps report content in the Digital Target letterhead (header, accent bar, footer). */
export function brandedReport(body: string, title: string, subtitle = "") {
  const company = branding.companyName || "Digital Target";
  const contact = [branding.phone, branding.companyEmail, branding.companyWebsite].filter(Boolean).map(escapeHtml).join(" • ");
  const when = new Date().toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short" });
  return `<div class="dtr">
    <div class="dtr-head">
      <div class="dtr-logo">${logoHTML()}</div>
      <div class="dtr-title"><h1>${escapeHtml(title)}</h1><div>${escapeHtml(subtitle || company)}</div><div>Generated ${escapeHtml(when)}</div></div>
    </div>
    <div class="dtr-bar"></div>
    <div class="dtr-body">${body}</div>
    <div class="dtr-foot"><span><b>${escapeHtml(company)}</b>${contact ? " • " + contact : ""}${branding.companyAddress ? " • " + escapeHtml(branding.companyAddress) : ""}</span><span>${escapeHtml(branding.footer || "AI Software • Digital Marketing • Social Media")}</span></div>
  </div>`;
}

function download(canvas: HTMLCanvasElement, format: "png" | "jpg", filename: string) {
  const dataUrl = format === "jpg" ? canvas.toDataURL("image/jpeg", 0.95) : canvas.toDataURL("image/png");
  const a = document.createElement("a");
  a.download = `${filename}.${format === "jpg" ? "jpg" : "png"}`;
  a.href = dataUrl;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export async function saveElementAsImage(
  element: HTMLElement,
  format: "png" | "jpg",
  filename: string,
  options?: { scale?: number; width?: string }
) {
  const oldWidth = element.style.width;
  if (options?.width) element.style.width = options.width;
  const canvas = await html2canvas(element, { scale: options?.scale || 2, backgroundColor: "#ffffff", useCORS: true });
  if (options?.width) {
    if (oldWidth) element.style.width = oldWidth;
    else element.style.removeProperty("width");
  }
  download(canvas, format, filename);
}

export interface ReportOptions {
  title?: string;
  subtitle?: string;
  /** Content already has its own full design (certificates, cards): no letterhead. */
  bare?: boolean;
  /** Wide tables: landscape page / 1123px image. */
  landscape?: boolean;
  filename?: string;
}

const pageWidth = (o: ReportOptions) => (o.landscape ? 1123 : 794);

/**
 * Saves a report as PNG / JPG. It renders exactly the same letterhead + HTML
 * as the print view, so the image and the printout match.
 */
export async function saveReportImage(html: string, format: "png" | "jpg", opts: ReportOptions = {}) {
  const host = document.createElement("div");
  host.style.cssText = `position:fixed;left:-20000px;top:0;width:${pageWidth(opts)}px;background:#fff`;
  const style = document.createElement("style");
  style.textContent = REPORT_CSS;
  const content = document.createElement("div");
  content.innerHTML = sanitizeHtml(opts.bare ? html : brandedReport(html, opts.title || "Report", opts.subtitle));
  host.append(style, content);
  document.body.appendChild(host);
  try {
    const canvas = await html2canvas(content, { scale: 2, backgroundColor: "#ffffff", useCORS: true, windowWidth: pageWidth(opts) });
    download(canvas, format, opts.filename || (opts.title || "Report").replace(/[^\w-]+/g, "_"));
  } finally {
    host.remove();
  }
}

/**
 * Opens the branded report in a preview window with Print / PDF, PNG and JPG
 * buttons. The buttons are added by this page (not part of the sanitised
 * report), and the image is taken from the same page that prints.
 */
export function printElementHTML(html: string, titleOrOpts: string | ReportOptions = {}) {
  const opts: ReportOptions = typeof titleOrOpts === "string" ? { title: titleOrOpts } : titleOrOpts;
  const title = opts.title || "Report";
  const w = window.open("", "_blank");
  if (!w) return;
  const body = opts.bare ? html : brandedReport(html, title, opts.subtitle);
  writeSafeDocument(w, `<html><head><title>${escapeHtml(title)}</title><style>
    @page{size:A4 ${opts.landscape ? "landscape" : "portrait"};margin:0}
    body{margin:0;background:#EEE9F6;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .dtr-page{width:${pageWidth(opts)}px;margin:56px auto 24px;background:#fff;box-shadow:0 8px 30px rgba(61,9,109,.18)}
    ${REPORT_CSS}
    @media print{body{background:#fff}.dtr-page{margin:0;width:auto;box-shadow:none}.dtr-toolbar{display:none!important}}
  </style></head><body><div class="dtr-page">${body}</div></body></html>`);

  // Toolbar (outside the sanitised content).
  const d = w.document;
  const bar = d.createElement("div");
  bar.className = "dtr-toolbar";
  bar.style.cssText = "position:fixed;top:0;left:0;right:0;display:flex;gap:8px;justify-content:center;align-items:center;padding:10px;background:#3D096D;z-index:10;font-family:Inter,Arial,sans-serif";
  const btn = (label: string, fn: () => void, solid = false) => {
    const b = d.createElement("button");
    b.textContent = label;
    b.style.cssText = `border:0;border-radius:8px;padding:8px 14px;font-weight:700;cursor:pointer;font-size:13px;${solid ? "background:#16A34A;color:#fff" : "background:#fff;color:#3D096D"}`;
    b.onclick = fn;
    bar.appendChild(b);
  };
  const page = () => d.querySelector(".dtr-page") as HTMLElement;
  const image = async (fmt: "png" | "jpg") => {
    const canvas = await html2canvas(page(), { scale: 2, backgroundColor: "#ffffff", useCORS: true });
    const a = d.createElement("a");
    a.download = `${opts.filename || title.replace(/[^\w-]+/g, "_")}.${fmt}`;
    a.href = fmt === "jpg" ? canvas.toDataURL("image/jpeg", 0.95) : canvas.toDataURL("image/png");
    d.body.appendChild(a);
    a.click();
    a.remove();
  };
  btn("🖨 Print / Save PDF", () => w.print(), true);
  btn("PNG", () => image("png"));
  btn("JPG", () => image("jpg"));
  d.body.appendChild(bar);
}
