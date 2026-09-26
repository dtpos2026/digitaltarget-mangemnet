import { useEffect, useState } from "react";
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { db, storage } from "@/lib/firebase";
import { ref as storageRef, uploadBytes } from "firebase/storage";
import { uid } from "@/lib/db";

// Shapes written by whatsapp-service (see whatsapp-service/src/types.ts).
export interface WaAccount {
  id: string;
  label?: string;
  expectedPhone?: string;
  status: "disconnected" | "connecting" | "qr" | "pairing" | "connected" | "logged_out" | "error";
  active?: boolean;
  qr?: string | null;
  qrExpiresAt?: number;
  pairingCode?: string | null;
  me?: { id: string; phone: string; name?: string } | null;
  lastError?: string | null;
  numberMismatch?: boolean;
  heartbeatAt?: string;
  connectedAt?: string;
  history?: { chats?: number; messages?: number; status?: string; progress?: number | null; completedAt?: string };
  settings?: Partial<WaSettings>;
  command?: { id: string; action: string } | null;
  commandAck?: string;
}

export interface WaSettings {
  autoCreateLeads: boolean;
  leadsFromHistory: boolean;
  ignoreGroups: boolean;
  downloadMedia: boolean;
  syncFullHistory: boolean;
  defaultAssignee: string;
  notifyOnNewLead: boolean;
}

export const DEFAULT_WA_SETTINGS: WaSettings = {
  autoCreateLeads: true,
  leadsFromHistory: false,
  ignoreGroups: true,
  downloadMedia: true,
  syncFullHistory: true,
  defaultAssignee: "",
  notifyOnNewLead: true,
};

export interface WaConversation {
  id: string;
  accountId: string;
  jid: string;
  chatType: string;
  phone?: string;
  contactName?: string;
  pushName?: string;
  leadId?: string;
  lastMessageAt?: number;
  lastMessageText?: string;
  lastMessageFromMe?: boolean;
  unreadCount?: number;
  assignedTo?: string;
  tags?: string[];
  notes?: string;
  followUpDate?: string;
  firstInboundAt?: number;
  firstResponseMs?: number;
  inboundCount?: number;
  outboundCount?: number;
  createdAt?: number;
  archived?: boolean;
}

export interface WaMessage {
  id: string;
  fromMe: boolean;
  kind: string;
  text: string;
  timestamp: number;
  status: string;
  senderName?: string;
  source?: string;
  media?: { kind: string; mimetype?: string; fileName?: string; size?: number; path?: string; skipped?: string; seconds?: number; ptt?: boolean };
  deleted?: boolean;
  edited?: boolean;
  reactions?: Record<string, string | null>;
  callStatus?: string;
}

export interface WaOutboxItem {
  id: string;
  conversationId: string;
  text: string;
  status: "queued" | "sending" | "sent" | "failed";
  media?: { fileName?: string };
  error?: string;
  createdAt: string;
}

export const MAIN_ACCOUNT_ID = "main";
/** Digital Target business number (from the owner); shown as the expected number. */
export const DEFAULT_EXPECTED_PHONE = "923451873354";

const wsCol = (ws: string, col: string) => collection(db, "users", ws, col);

export function useAccounts(ws: string | null) {
  const [accounts, setAccounts] = useState<WaAccount[] | null>(null);
  useEffect(() => {
    if (!ws) return;
    return onSnapshot(
      wsCol(ws, "waAccounts"),
      (s) => setAccounts(s.docs.map((d) => ({ id: d.id, ...d.data() }) as WaAccount)),
      (e) => { console.warn("waAccounts", e); setAccounts([]); }
    );
  }, [ws]);
  return accounts;
}

export function useConversations(ws: string | null, max: number) {
  const [rows, setRows] = useState<WaConversation[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!ws) return;
    setLoading(true);
    return onSnapshot(
      query(wsCol(ws, "waConversations"), orderBy("lastMessageAt", "desc"), limit(max)),
      (s) => { setRows(s.docs.map((d) => ({ id: d.id, ...d.data() }) as WaConversation)); setLoading(false); },
      (e) => { console.warn("waConversations", e); setLoading(false); }
    );
  }, [ws, max]);
  return { rows, loading };
}

export function useMessages(ws: string | null, conversationId: string | null, max: number) {
  const [rows, setRows] = useState<WaMessage[]>([]);
  useEffect(() => {
    setRows([]);
    if (!ws || !conversationId) return;
    return onSnapshot(
      query(collection(db, "users", ws, "waConversations", conversationId, "messages"), orderBy("timestamp", "desc"), limit(max)),
      (s) => setRows(s.docs.map((d) => ({ id: d.id, ...d.data() }) as WaMessage).reverse()),
      (e) => console.warn("messages", e)
    );
  }, [ws, conversationId, max]);
  return rows;
}

export function useOutbox(ws: string | null, conversationId: string | null) {
  const [rows, setRows] = useState<WaOutboxItem[]>([]);
  useEffect(() => {
    setRows([]);
    if (!ws || !conversationId) return;
    return onSnapshot(
      query(wsCol(ws, "waOutbox"), where("conversationId", "==", conversationId), limit(50)),
      (s) => setRows(
        s.docs.map((d) => d.data() as WaOutboxItem)
          .filter((o) => o.status !== "sent")
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      ),
      (e) => console.warn("outbox", e)
    );
  }, [ws, conversationId]);
  return rows;
}

export async function createMainAccount(ws: string, by: string) {
  await setDoc(doc(db, "users", ws, "waAccounts", MAIN_ACCOUNT_ID), {
    id: MAIN_ACCOUNT_ID,
    label: "Digital Target",
    expectedPhone: DEFAULT_EXPECTED_PHONE,
    status: "disconnected",
    settings: DEFAULT_WA_SETTINGS,
    createdAt: new Date().toISOString(),
    createdBy: by,
    command: null,
  });
}

export async function sendCommand(ws: string, accountId: string, by: string, action: string, extra: Record<string, unknown> = {}) {
  await updateDoc(doc(db, "users", ws, "waAccounts", accountId), {
    command: { id: uid("CMD"), action, requestedBy: by, requestedAt: new Date().toISOString(), ...extra },
  });
}

export async function saveAccountSettings(ws: string, accountId: string, settings: WaSettings, expectedPhone: string) {
  await updateDoc(doc(db, "users", ws, "waAccounts", accountId), { settings, expectedPhone });
}

export interface OutboxMedia { path: string; mimetype: string; fileName: string; size: number }

export const MAX_ATTACHMENT_BYTES = 16 * 1024 * 1024;

/** Uploads a file for sending (storage.rules: whatsapp.reply, < 16 MB, common types). */
export async function uploadAttachment(ws: string, file: File): Promise<OutboxMedia> {
  const safe = file.name.replace(/[^\w.-]+/g, "_").slice(-80) || "file";
  const path = `workspaces/${ws}/whatsapp-outbox/${uid("UP")}/${safe}`;
  await uploadBytes(storageRef(storage, path), file, { contentType: file.type || "application/octet-stream" });
  return { path, mimetype: file.type || "application/octet-stream", fileName: file.name, size: file.size };
}

export async function queueMessage(ws: string, accountId: string, conversationId: string, text: string, by: { uid: string; email?: string | null }, media?: OutboxMedia) {
  const id = uid("OUT");
  await setDoc(doc(db, "users", ws, "waOutbox", id), {
    id,
    accountId,
    conversationId,
    text,
    status: "queued",
    createdBy: by.uid,
    createdByEmail: by.email || "",
    createdAt: new Date().toISOString(),
    ...(media ? { media } : {}),
  });
}

export async function updateConversation(ws: string, id: string, patch: Partial<WaConversation> & { updatedBy?: string }) {
  await updateDoc(doc(db, "users", ws, "waConversations", id), { ...patch, updatedAt: Date.now() });
}

export function conversationName(c: Pick<WaConversation, "contactName" | "pushName" | "phone" | "id">) {
  return c.contactName || c.pushName || (c.phone ? formatPhone(c.phone) : "") || c.id;
}

export function formatPhone(e164: string) {
  if (e164.startsWith("92") && e164.length === 12) return "0" + e164.slice(2, 5) + "-" + e164.slice(5);
  return "+" + e164;
}

/** Service writes a heartbeat every 30s; older than 2 minutes means it is not running. */
export function serviceOnline(a: WaAccount | undefined) {
  if (!a?.heartbeatAt) return false;
  return Date.now() - new Date(a.heartbeatAt).getTime() < 120_000;
}

export function timeLabel(ts?: number) {
  if (!ts) return "";
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const y = new Date(now.getTime() - 86400000);
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString();
}

export function durationLabel(ms?: number) {
  if (ms == null) return "—";
  const m = Math.round(ms / 60000);
  if (m < 1) return "< 1 min";
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}
