import React, { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { fmtMoney } from "@/lib/db";
import type { VerifySummary } from "@/lib/invoiceVerify";
import { BrandMark } from "@/components/app/BrandMark";

/** Public page opened by the invoice QR code: /verify/{token}. No login needed. */
export default function VerifyPage({ token }: { token: string }) {
  const [state, setState] = useState<"loading" | "ok" | "missing">("loading");
  const [inv, setInv] = useState<VerifySummary | null>(null);

  useEffect(() => {
    if (!/^[a-f0-9]{32}$/.test(token)) { setState("missing"); return; }
    getDoc(doc(db, "invoiceVerify", token))
      .then((s) => {
        if (s.exists()) { setInv(s.data() as VerifySummary); setState("ok"); } else setState("missing");
      })
      .catch(() => setState("missing"));
  }, [token]);

  const rs = (n: number) => `Rs ${fmtMoney(n)}`;
  const statusCls = inv?.void ? "bad" : inv?.status === "Paid" ? "ok" : inv?.status === "Partial" ? "warn" : "bad";

  return (
    <div className="verifyPage">
      <div className="verifyCard">
        <div className="verifyHead">
          <BrandMark size={30} color="#fff" />
          <div>
            <b>{inv?.company || "DIGITAL TARGET"}</b>
            <span>Invoice verification</span>
          </div>
        </div>

        {state === "loading" && <div className="verifyBody"><div className="waSpinner" style={{ margin: "30px auto" }} /></div>}

        {state === "missing" && (
          <div className="verifyBody verifyCenter">
            <div className="verifySeal bad">✕</div>
            <h2>Invoice not found</h2>
            <p className="small">Yeh QR code kisi valid Digital Target invoice se match nahi karta. Invoice ki tasdeeq ke liye humse rabta karein.</p>
          </div>
        )}

        {state === "ok" && inv && (
          <div className="verifyBody">
            <div className="verifyCenter">
              <div className={`verifySeal ${inv.void ? "bad" : "ok"}`}>{inv.void ? "✕" : "✓"}</div>
              <h2>{inv.void ? "Invoice cancelled" : "Verified invoice"}</h2>
              <p className="small">
                {inv.void
                  ? "Yeh invoice issuer ne cancel kar di hai. Is par payment na karein."
                  : `Yeh invoice ${inv.company} ne issue ki hai aur hamare record se match karti hai.`}
              </p>
            </div>

            <div className="verifyMeta">
              <div><span>Invoice #</span><b>{inv.number}</b></div>
              <div><span>Status</span><b><span className={`badge ${statusCls}`}>{inv.status}</span></b></div>
              <div><span>Billed to</span><b>{inv.clientName || "—"}</b></div>
              <div><span>Date</span><b>{inv.date || "—"}</b></div>
              {inv.dueDate && <div><span>Due date</span><b>{inv.dueDate}</b></div>}
              {inv.paymentMethod && <div><span>Payment method</span><b>{inv.paymentMethod}</b></div>}
            </div>

            <div className="verifyItems">
              {inv.items.map((it, i) => (
                <div key={i} className="verifyItem">
                  <div><b>{it.desc}</b><span className="small">{it.qty} × {fmtMoney(it.price)}</span></div>
                  <b>{fmtMoney(it.total)}</b>
                </div>
              ))}
            </div>

            <div className="verifyTotals">
              <div><span>Subtotal</span><span>{rs(inv.subtotal)}</span></div>
              {inv.discountAmount > 0 && <div><span>Discount</span><span>- {rs(inv.discountAmount)}</span></div>}
              {inv.taxAmount > 0 && <div><span>Tax ({inv.taxRate}%)</span><span>{rs(inv.taxAmount)}</span></div>}
              <div className="grand"><span>Total</span><span>{rs(inv.grandTotal)}</span></div>
              <div><span>Paid</span><span className="paid">{rs(inv.paid)}</span></div>
              <div className="due"><span>Balance due</span><span>{rs(inv.due)}</span></div>
            </div>

            <div className="verifyFoot small">
              Last updated {new Date(inv.updatedAt).toLocaleString()}
              {inv.companyPhone && <> • {inv.companyPhone}</>}
              {inv.companyWebsite && <> • {inv.companyWebsite}</>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
