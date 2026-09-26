import html2canvas from "html2canvas";

export async function saveElementAsImage(
  element: HTMLElement,
  format: "png" | "jpg",
  filename: string,
  options?: { scale?: number; width?: string }
) {
  const oldWidth = element.style.width;
  if (options?.width) element.style.width = options.width;

  const scale = options?.scale || 2;
  const canvas = await html2canvas(element, {
    scale,
    backgroundColor: "#ffffff",
    useCORS: true,
  });

  if (options?.width) {
    if (oldWidth) element.style.width = oldWidth;
    else element.style.removeProperty("width");
  }

  const ext = format === "jpg" ? "jpg" : "png";
  const mime = format === "jpg" ? "image/jpeg" : "image/png";
  const dataUrl = format === "jpg" ? canvas.toDataURL(mime, 0.95) : canvas.toDataURL(mime);

  const a = document.createElement("a");
  a.download = `${filename}.${ext}`;
  a.href = dataUrl;
  a.click();
}

export function printElementHTML(html: string) {
  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write(`<html><head><title>Print</title><style>
    body{margin:0;font-family:system-ui,sans-serif}
    .r-top{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}
    .r-title{margin:0;font-size:26px;font-weight:900}
    .r-meta{font-size:12px;color:#111}
    .r-box{border:1px solid #111;border-radius:12px;padding:10px;margin-top:10px}
    .r-table{width:100%;border-collapse:collapse}
    .r-table th,.r-table td{border-bottom:1px solid #111;padding:8px;text-align:left}
    .r-total{display:flex;justify-content:flex-end;margin-top:10px}
    .tbox{min-width:70mm;border:1px solid #111;border-radius:12px;padding:10px}
    .nowrapRow{display:flex;justify-content:space-between;gap:10px}
    .nowrapRow *{white-space:nowrap}
    .posCenter{text-align:center}.posHr{border-top:1px dashed #000;margin:6px 0}
    .posSmall{font-size:12px}.posBold{font-weight:900}
    .posTbl{width:100%;border-collapse:collapse}
    .posTbl th{font-size:11px;font-weight:900;border-bottom:1px dashed #000;padding:4px 0}
    .posTbl td{padding:3px 0;font-size:12px}
    .card{border:1px solid #e6eaf2;border-radius:12px;padding:10px}
    .small{font-size:12px;color:#64748b}
    table{width:100%;border-collapse:collapse}
    th,td{border-bottom:1px solid #ddd;padding:8px;text-align:left;font-size:13px}
    th{font-weight:900;font-size:12px}
    @media print{body{margin:0}}
  </style></head><body>`);
  w.document.write(html);
  w.document.write("</body></html>");
  w.document.close();
  setTimeout(() => w.print(), 300);
}
