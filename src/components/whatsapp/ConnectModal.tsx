import React, { useEffect, useState } from "react";
import QRCode from "qrcode";
import { formatPhone, serviceOnline, WaAccount } from "./useWhatsApp";

interface Props {
  account: WaAccount | undefined;
  onClose: () => void;
  onConnect: () => void;
  onPairCode: (phone: string) => void;
}

/**
 * "Connect WhatsApp" popup. Shows the QR published by whatsapp-service
 * (live via Firestore); the phone scans it from WhatsApp → Linked devices.
 */
export default function ConnectModal({ account, onClose, onConnect, onPairCode }: Props) {
  const [qrImg, setQrImg] = useState("");
  const [now, setNow] = useState(Date.now());
  const [usePhone, setUsePhone] = useState(false);
  const [phone, setPhone] = useState(account?.expectedPhone ? "0" + account.expectedPhone.slice(2) : "03451873354");

  useEffect(() => {
    setQrImg("");
    if (!account?.qr) return;
    QRCode.toDataURL(account.qr, { width: 280, margin: 1, errorCorrectionLevel: "L" })
      .then(setQrImg)
      .catch((e: unknown) => console.warn("QR render failed", e));
  }, [account?.qr]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (account?.status !== "connected") return;
    const t = setTimeout(onClose, 4000);
    return () => clearTimeout(t);
  }, [account?.status, onClose]);

  const status = account?.status || "disconnected";
  const online = serviceOnline(account);
  const secondsLeft = account?.qrExpiresAt ? Math.max(0, Math.round((account.qrExpiresAt - now) / 1000)) : 0;

  let body: React.ReactNode;
  if (status === "connected") {
    body = (
      <div className="waConnectState ok">
        <div className="waBigIcon">✅</div>
        <b>WhatsApp connected</b>
        <div>{account?.me?.name} {account?.me?.phone ? `(${formatPhone(account.me.phone)})` : ""}</div>
        {account?.numberMismatch && <div className="waWarn">{account.lastError}</div>}
        {account?.history && account.history.status !== "idle" && (
          <div className="small">
            Purani chats import ho rahi hain: {account.history.chats || 0} chats, {account.history.messages || 0} messages
            {account.history.status === "complete" ? " ✓" : "…"}
          </div>
        )}
      </div>
    );
  } else if (status === "qr" && qrImg) {
    body = (
      <div className="waQrWrap">
        <img src={qrImg} alt="WhatsApp QR code" className="waQr" />
        <ol className="waSteps">
          <li>Phone par <b>WhatsApp</b> kholein</li>
          <li><b>Settings → Linked devices → Link a device</b> dabayein</li>
          <li>Yeh QR code scan karein</li>
        </ol>
        <div className="small">QR {secondsLeft > 0 ? `${secondsLeft}s mein` : "jald"} refresh hoga — scan hone tak yeh window khuli rakhein.</div>
      </div>
    );
  } else if (status === "pairing" && account?.pairingCode) {
    body = (
      <div className="waConnectState">
        <div className="waPairCode">{account.pairingCode.slice(0, 4)}-{account.pairingCode.slice(4)}</div>
        <ol className="waSteps">
          <li>Phone par WhatsApp → <b>Settings → Linked devices → Link a device</b></li>
          <li><b>"Link with phone number instead"</b> dabayein</li>
          <li>Yeh code enter karein</li>
        </ol>
      </div>
    );
  } else if (status === "connecting" || (status === "qr" && !qrImg)) {
    body = (
      <div className="waConnectState">
        <div className="waSpinner" />
        <div>{online ? "WhatsApp se connect ho raha hai…" : "WhatsApp service ka intezar…"}</div>
        {!online && (
          <div className="waWarn">
            WhatsApp service abhi online nahi lag rahi. Server par <code>whatsapp-service</code> chal rahi honi chahiye
            (docs/WHATSAPP.md dekhein).
          </div>
        )}
      </div>
    );
  } else {
    body = (
      <div className="waConnectState">
        {account?.lastError && <div className="waWarn">{account.lastError}</div>}
        <p>WhatsApp Business number ko portal se jorne ke liye neeche button dabayein — QR code yahan aa jayega.</p>
        <button className="btnSolid" onClick={onConnect}>Generate QR Code</button>
      </div>
    );
  }

  return (
    <div className="dtModalBackdrop" onClick={onClose}>
      <div className="dtModal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Connect WhatsApp">
        <div className="dtModalHead">
          <div>
            <b>Connect WhatsApp</b>
            <div className="small">Expected number: {account?.expectedPhone ? formatPhone(account.expectedPhone) : "0345-1873354"}</div>
          </div>
          <button className="btnSmall" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {body}

        {status !== "connected" && (
          <div className="waAltLink">
            {!usePhone ? (
              <button className="linkBtn" onClick={() => setUsePhone(true)}>
                QR scan nahi ho raha (portal isi phone par khula hai)? Phone number se link karein
              </button>
            ) : (
              <div className="waPairForm">
                <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="03451873354" inputMode="tel" />
                <button className="btnSmall" onClick={() => onPairCode(phone)}>Get pairing code</button>
              </div>
            )}
          </div>
        )}

        <div className="waDisclaimer">
          Yeh WhatsApp Web jaisa "linked device" connection hai (Meta Cloud API nahi). WhatsApp ki terms ke mutabiq
          unofficial automation par number block hone ka khatra hota hai — bulk / spam messages na bhejein.
        </div>
      </div>
    </div>
  );
}
