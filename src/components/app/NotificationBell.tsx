import React, { useEffect, useRef, useState } from "react";
import { collection, doc, limit, onSnapshot, orderBy, query, updateDoc, where, writeBatch } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { navigate } from "@/lib/navigation";

interface Notif {
  id: string;
  type: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
  link?: { tab: string; conversationId?: string; leadId?: string };
}

/** In-app notifications (users/{ws}/notifications, one doc per recipient) + browser notifications. */
export default function NotificationBell() {
  const { workspaceUid, user } = useAuth();
  const [items, setItems] = useState<Notif[]>([]);
  const [open, setOpen] = useState(false);
  const [perm, setPerm] = useState(typeof Notification !== "undefined" ? Notification.permission : "denied");
  const mountedAt = useRef(new Date().toISOString());
  const shown = useRef(new Set<string>());

  useEffect(() => {
    if (!workspaceUid || !user) return;
    return onSnapshot(
      query(collection(db, "users", workspaceUid, "notifications"), where("userUid", "==", user.uid), orderBy("createdAt", "desc"), limit(30)),
      (s) => {
        const rows = s.docs.map((d) => d.data() as Notif);
        setItems(rows);
        for (const n of rows) {
          if (n.read || n.createdAt <= mountedAt.current || shown.current.has(n.id)) continue;
          shown.current.add(n.id);
          if (typeof Notification !== "undefined" && Notification.permission === "granted") {
            const bn = new Notification(n.title, { body: n.body, tag: n.id });
            bn.onclick = () => { window.focus(); openItem(n); };
          }
        }
      },
      (e) => console.warn("notifications", e)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceUid, user]);

  const unread = items.filter((n) => !n.read).length;

  const markRead = (n: Notif) => {
    if (!workspaceUid || n.read) return;
    updateDoc(doc(db, "users", workspaceUid, "notifications", n.id), { read: true, readAt: new Date().toISOString() }).catch(() => undefined);
  };

  const openItem = (n: Notif) => {
    markRead(n);
    setOpen(false);
    if (n.link?.tab) navigate(n.link);
  };

  const markAll = async () => {
    if (!workspaceUid) return;
    const batch = writeBatch(db);
    items.filter((n) => !n.read).forEach((n) => batch.update(doc(db, "users", workspaceUid, "notifications", n.id), { read: true, readAt: new Date().toISOString() }));
    await batch.commit().catch(() => undefined);
  };

  const enableBrowser = async () => {
    if (typeof Notification === "undefined") return;
    setPerm(await Notification.requestPermission());
  };

  return (
    <div className="notifWrap">
      <button className="btnSmall notifBtn" onClick={() => setOpen(!open)} aria-label={`Notifications (${unread} unread)`}>
        🔔{unread > 0 && <span className="notifCount">{unread > 9 ? "9+" : unread}</span>}
      </button>
      {open && (
        <div className="notifPanel">
          <div className="notifHead">
            <b>Notifications</b>
            {unread > 0 && <button className="linkBtn" onClick={markAll}>Mark all read</button>}
          </div>
          {perm === "default" && (
            <button className="linkBtn notifEnable" onClick={enableBrowser}>🔔 Browser notifications on karein</button>
          )}
          {items.length === 0 && <div className="small notifEmpty">Koi notification nahi.</div>}
          {items.map((n) => (
            <button key={n.id} className={`notifItem ${n.read ? "" : "unread"}`} onClick={() => openItem(n)}>
              <b>{n.title}</b>
              <span>{n.body}</span>
              <span className="small">{new Date(n.createdAt).toLocaleString()}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
