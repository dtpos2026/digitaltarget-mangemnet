import React from "react";
import { fmtMoney } from "@/lib/db";
import { invoiceView } from "@/lib/invoice";
import { BrandMark } from "@/components/app/BrandMark";

// Inline styles only: the same markup is printed (sanitised copy in a popup)
// and rasterised to PDF / PNG, so it cannot depend on the app stylesheet.
const BRAND = "#3D096D";
const BRAND_2 = "#5B21B6";
const TINT = "#F5F0FC";
const INK = "#1F1633";
const MUTED = "#6B6280";

interface Props {
  inv: any;
  client?: any;
  project?: any;
  settings: any;
  qr?: string;
}

const rs = (n: number) => `Rs ${fmtMoney(n)}`;

function Logo({ settings, size = 46 }: { settings: any; size?: number }) {
  if (settings?.logo?.data) {
    return <img src={settings.logo.data} alt="logo" style={{ maxHeight: size + 6, maxWidth: 170, objectFit: "contain", background: "#fff", borderRadius: 8, padding: 4 }} />;
  }
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#fff" }}>
      <BrandMark size={size} color="#fff" />
      <div style={{ fontFamily: "Poppins, Inter, Arial, sans-serif", fontWeight: 800, fontSize: size * 0.4, lineHeight: 1.02, letterSpacing: 1 }}>
        DIGITAL<br />TARGET
      </div>
    </div>
  );
}

export function InvoiceA4({ inv, client, project, settings, qr }: Props) {
  const v = invoiceView(inv);
  const company = settings?.companyName || "Digital Target";
  const statusColor = v.status === "Paid" ? "#059669" : v.status === "Partial" ? "#D97706" : "#DC2626";
  const signData = inv.sign?.data || settings?.signature?.data || "";
  const bankQRData = inv.bankQR?.data || settings?.bankQR?.data || "";
  const terms = inv.terms ?? settings?.invoiceTerms ?? "";
  const cell: React.CSSProperties = { padding: "10px 12px", borderBottom: "1px solid #ECE7F5", fontSize: 12.5, verticalAlign: "top" };
  // background on each th (not the tr) so app table styles cannot override it
  const head: React.CSSProperties = { padding: "10px 12px", fontSize: 11, textTransform: "uppercase", letterSpacing: 1, color: "#fff", background: BRAND, textAlign: "left", fontWeight: 700, borderBottom: "none" };
  const row = (label: string, value: string, strong = false, color = INK): React.ReactNode => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16, padding: "5px 0", fontSize: strong ? 14 : 12.5, fontWeight: strong ? 800 : 500, color }}>
      <span>{label}</span><span style={{ whiteSpace: "nowrap" }}>{value}</span>
    </div>
  );

  return (
    <div style={{ width: "210mm", minHeight: "297mm", background: "#fff", color: INK, fontFamily: "Inter, 'Segoe UI', Arial, sans-serif", position: "relative", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {v.status === "Paid" && (
        <div style={{ position: "absolute", top: "44%", left: "50%", transform: "translate(-50%,-50%) rotate(-24deg)", fontSize: 110, fontWeight: 900, color: "rgba(5,150,105,.07)", letterSpacing: 12, pointerEvents: "none" }}>PAID</div>
      )}

      {/* Header band */}
      <div style={{ background: `linear-gradient(120deg, ${BRAND} 0%, ${BRAND_2} 100%)`, color: "#fff", padding: "26px 34px 22px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 20 }}>
        <Logo settings={settings} />
        <div style={{ textAlign: "right" }}>
          <div style={{ fontFamily: "Poppins, Inter, Arial, sans-serif", fontSize: 34, fontWeight: 800, letterSpacing: 6 }}>INVOICE</div>
          <div style={{ fontSize: 13, opacity: 0.9, marginTop: 2 }}>{v.number}</div>
          <div style={{ display: "inline-block", marginTop: 8, background: "#fff", color: statusColor, borderRadius: 999, padding: "3px 12px", fontSize: 11, fontWeight: 800, letterSpacing: 1 }}>{v.status.toUpperCase()}</div>
        </div>
      </div>

      <div style={{ padding: "22px 34px 0", flex: 1 }}>
        {/* Parties + meta */}
        <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1.1fr 0.9fr", gap: 18 }}>
          <div>
            <div style={{ fontSize: 10, letterSpacing: 1.5, color: BRAND_2, fontWeight: 800, marginBottom: 6 }}>FROM</div>
            <div style={{ fontWeight: 800, fontSize: 14 }}>{company}</div>
            <div style={{ fontSize: 12, color: MUTED, lineHeight: 1.55, whiteSpace: "pre-line" }}>
              {[settings?.companyAddress, settings?.phone && `Phone: ${settings.phone}`, settings?.companyEmail, settings?.companyWebsite, settings?.taxNumber && `NTN: ${settings.taxNumber}`].filter(Boolean).join("\n")}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 10, letterSpacing: 1.5, color: BRAND_2, fontWeight: 800, marginBottom: 6 }}>BILL TO</div>
            <div style={{ fontWeight: 800, fontSize: 14 }}>{client?.name || "—"}</div>
            <div style={{ fontSize: 12, color: MUTED, lineHeight: 1.55, whiteSpace: "pre-line" }}>
              {[client?.business, client?.phone, client?.email, client?.address, client?.ref].filter(Boolean).join("\n")}
            </div>
            {project?.title && <div style={{ fontSize: 12, marginTop: 6 }}><span style={{ color: MUTED }}>Project: </span><b>{project.title}</b></div>}
          </div>
          <div style={{ background: TINT, borderRadius: 12, padding: "10px 14px", fontSize: 12, lineHeight: 1.9 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: MUTED }}>Invoice date</span><b>{v.date || "—"}</b></div>
            <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: MUTED }}>Due date</span><b>{inv.dueDate || "On receipt"}</b></div>
            {inv.paymentMethod && <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: MUTED }}>Payment</span><b>{inv.paymentMethod}</b></div>}
          </div>
        </div>

        {/* Items */}
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 22, borderRadius: 12, overflow: "hidden" }}>
          <thead>
            <tr style={{ background: BRAND }}>
              <th style={{ ...head, width: 36 }}>#</th>
              <th style={head}>Description</th>
              <th style={{ ...head, textAlign: "center", width: 60 }}>Qty</th>
              <th style={{ ...head, textAlign: "right", width: 110 }}>Rate</th>
              <th style={{ ...head, textAlign: "right", width: 120 }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {v.items.map((it, i) => (
              <tr key={i} style={{ background: i % 2 ? "#FBF9FE" : "#fff" }}>
                <td style={{ ...cell, color: MUTED }}>{i + 1}</td>
                <td style={{ ...cell, fontWeight: 600 }}>{it.desc}</td>
                <td style={{ ...cell, textAlign: "center" }}>{it.qty}</td>
                <td style={{ ...cell, textAlign: "right" }}>{fmtMoney(it.price)}</td>
                <td style={{ ...cell, textAlign: "right", fontWeight: 700 }}>{fmtMoney(it.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Payment info + totals */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 290px", gap: 24, marginTop: 18, alignItems: "start" }}>
          <div>
            {(settings?.bankDetails || bankQRData || qr) && (
              <div style={{ border: "1px solid #ECE7F5", borderRadius: 12, padding: 12, display: "flex", gap: 14, alignItems: "center" }}>
                {bankQRData && <img src={bankQRData} alt="bank qr" style={{ width: 86, height: 86, objectFit: "contain" }} />}
                <div style={{ flex: 1, fontSize: 12, lineHeight: 1.6 }}>
                  <div style={{ fontSize: 10, letterSpacing: 1.5, color: BRAND_2, fontWeight: 800 }}>PAYMENT DETAILS</div>
                  <div style={{ whiteSpace: "pre-line", color: INK }}>{settings?.bankDetails || "Scan the QR to pay"}</div>
                </div>
                {qr && (
                  <div style={{ textAlign: "center" }}>
                    <img src={qr} alt="verify" style={{ width: 70, height: 70 }} />
                    <div style={{ fontSize: 9, color: MUTED }}>Scan to verify</div>
                  </div>
                )}
              </div>
            )}
            {inv.notes && (
              <div style={{ marginTop: 12, fontSize: 12 }}>
                <div style={{ fontSize: 10, letterSpacing: 1.5, color: BRAND_2, fontWeight: 800 }}>NOTES</div>
                <div style={{ whiteSpace: "pre-line", marginTop: 4 }}>{inv.notes}</div>
              </div>
            )}
          </div>
          <div style={{ border: "1px solid #ECE7F5", borderRadius: 14, overflow: "hidden" }}>
            <div style={{ padding: "10px 16px" }}>
              {row("Subtotal", rs(v.subtotal))}
              {v.discountAmount > 0 && row(v.discountLabel, `- ${rs(v.discountAmount)}`)}
              {v.taxAmount > 0 && row(`Tax (${v.taxRate}%)`, rs(v.taxAmount))}
            </div>
            <div style={{ background: BRAND, color: "#fff", padding: "10px 16px" }}>{row("Total", rs(v.grandTotal), true, "#fff")}</div>
            <div style={{ padding: "8px 16px 10px" }}>
              {row("Paid", rs(v.paid), false, "#059669")}
              {row("Balance Due", rs(v.due), true, v.due > 0 ? "#DC2626" : "#059669")}
            </div>
          </div>
        </div>

        {/* Terms + signature */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 230px", gap: 24, marginTop: 22, alignItems: "end" }}>
          <div style={{ fontSize: 11, color: MUTED, whiteSpace: "pre-line", lineHeight: 1.6 }}>
            {terms && (<><div style={{ fontSize: 10, letterSpacing: 1.5, color: BRAND_2, fontWeight: 800, marginBottom: 4 }}>TERMS &amp; CONDITIONS</div>{terms}</>)}
          </div>
          <div style={{ textAlign: "center" }}>
            {signData && <img src={signData} alt="signature" style={{ maxWidth: 200, maxHeight: 60, objectFit: "contain" }} />}
            <div style={{ borderTop: `2px solid ${BRAND}`, marginTop: signData ? 4 : 50, paddingTop: 6, fontSize: 12, fontWeight: 700 }}>{settings?.authorizedName || "Authorized Signatory"}</div>
            <div style={{ fontSize: 11, color: MUTED }}>{settings?.authorizedDesignation || company}</div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div style={{ marginTop: 26, background: TINT, borderTop: `3px solid ${BRAND}`, padding: "12px 34px", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11, color: MUTED }}>
        <span style={{ fontWeight: 700, color: BRAND }}>Thank you for your business!</span>
        <span>{settings?.footer || company}</span>
      </div>
    </div>
  );
}

export function InvoicePOS({ inv, client, project, settings, qr }: Props) {
  const v = invoiceView(inv);
  const line: React.CSSProperties = { display: "flex", justifyContent: "space-between", gap: 8 };
  return (
    <div style={{ width: "80mm", padding: "5mm 4mm", background: "#fff", color: "#000", fontFamily: "Inter, Arial, sans-serif", fontSize: 11 }}>
      <div style={{ textAlign: "center" }}>
        {settings?.logo?.data
          ? <img src={settings.logo.data} alt="logo" style={{ maxWidth: "36mm", maxHeight: "14mm", objectFit: "contain" }} />
          : <div style={{ display: "inline-flex", alignItems: "center", gap: 6, color: BRAND }}><BrandMark size={22} color={BRAND} /><b style={{ fontSize: 13, letterSpacing: 1 }}>DIGITAL TARGET</b></div>}
        <div style={{ fontSize: 10, color: "#555", marginTop: 3 }}>{settings?.phone || ""}</div>
      </div>
      <div style={{ borderTop: `2px solid ${BRAND}`, margin: "6px 0" }} />
      <div style={{ lineHeight: 1.6 }}>
        <div style={line}><span>Invoice</span><b>{v.number}</b></div>
        <div style={line}><span>Date</span><span>{v.date}</span></div>
        <div style={line}><span>Client</span><b>{client?.name || ""}</b></div>
        {project?.title && <div style={line}><span>Project</span><span>{project.title}</span></div>}
      </div>
      <div style={{ borderTop: "1px dashed #999", margin: "6px 0" }} />
      {v.items.map((it, i) => (
        <div key={i} style={{ padding: "3px 0" }}>
          <div style={{ fontWeight: 600 }}>{it.desc}</div>
          <div style={line}><span style={{ color: "#555" }}>{it.qty} × {fmtMoney(it.price)}</span><b>{fmtMoney(it.total)}</b></div>
        </div>
      ))}
      <div style={{ borderTop: "1px dashed #999", margin: "6px 0" }} />
      <div style={line}><span>Subtotal</span><span>{fmtMoney(v.subtotal)}</span></div>
      {v.discountAmount > 0 && <div style={line}><span>{v.discountLabel}</span><span>-{fmtMoney(v.discountAmount)}</span></div>}
      {v.taxAmount > 0 && <div style={line}><span>Tax ({v.taxRate}%)</span><span>{fmtMoney(v.taxAmount)}</span></div>}
      <div style={{ ...line, background: BRAND, color: "#fff", padding: "4px 6px", borderRadius: 4, margin: "4px 0", fontSize: 13, fontWeight: 800 }}><span>TOTAL</span><span>Rs {fmtMoney(v.grandTotal)}</span></div>
      <div style={line}><span>Paid</span><span>{fmtMoney(v.paid)}</span></div>
      <div style={{ ...line, fontWeight: 800 }}><span>Balance</span><span>{fmtMoney(v.due)}</span></div>
      <div style={{ ...line, marginTop: 4 }}><span>Status</span><b>{v.status}</b></div>
      {qr && <div style={{ textAlign: "center", marginTop: 6 }}><img src={qr} alt="qr" style={{ width: 100, height: 100 }} /><div style={{ fontSize: 9, color: "#777" }}>Scan to verify</div></div>}
      <div style={{ textAlign: "center", marginTop: 6, fontWeight: 800, color: BRAND }}>Thank you!</div>
      <div style={{ textAlign: "center", fontSize: 9, color: "#666" }}>{settings?.footer || "Digital Target"}</div>
    </div>
  );
}
