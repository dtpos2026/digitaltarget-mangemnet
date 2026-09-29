// Pictures / videos / documents for WhatsApp campaigns.
//
// The file is kept in this browser (IndexedDB) instead of Cloud Storage: the
// campaign only runs while this portal tab is open anyway, and reading a
// Storage file back from the browser needs bucket CORS settings that not
// every project has. The saved campaign holds only a small description
// (MediaRef). If the file is missing later (other computer, cleared browser)
// the campaign pauses and asks for the file again.
import type { MediaRef } from "./campaign";

export const MAX_MEDIA_BYTES = 16 * 1024 * 1024;
const ACCEPT = /^(image\/(jpeg|png|webp|gif)|video\/(mp4|3gpp|quicktime)|application\/pdf)$/;
export const MEDIA_ACCEPT = "image/jpeg,image/png,image/webp,image/gif,video/mp4,video/3gpp,video/quicktime,application/pdf";

const DB = "dt-campaign-media";
const STORE = "files";
const memory = new Map<string, Blob>();

const open = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("no indexedDB"));
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

const run = async <T,>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => { db.close(); resolve(req.result); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
};

export const kindOf = (mime: string): MediaRef["kind"] => (mime.startsWith("image/") ? "image" : mime.startsWith("video/") ? "video" : "file");

/** Checks a picked file; returns an error message or "". */
export function checkMedia(f: File): string {
  if (!ACCEPT.test(f.type)) return "Sirf photo (JPG/PNG/WebP), video (MP4) ya PDF chalti hai.";
  if (f.size > MAX_MEDIA_BYTES) return "File 16 MB se bari hai — chhoti file ya video ka link use karein.";
  return "";
}

/** Saves the file under `key` and returns its description. */
export async function saveMedia(key: string, f: File): Promise<MediaRef> {
  memory.set(key, f);
  try { await run("readwrite", (s) => s.put(f, key)); } catch { /* memory copy still works for this session */ }
  return { key, name: f.name, type: f.type, size: f.size, kind: kindOf(f.type) };
}

export async function loadMedia(key: string): Promise<Blob | null> {
  if (memory.has(key)) return memory.get(key)!;
  try {
    const b = (await run("readonly", (s) => s.get(key))) as Blob | undefined;
    if (b) { memory.set(key, b); return b; }
  } catch { /* fall through */ }
  return null;
}

/** Removes every file of a campaign (keys start with `${campaignId}:`). */
export async function deleteCampaignMedia(campaignId: string) {
  for (const k of [...memory.keys()]) if (k.startsWith(`${campaignId}:`)) memory.delete(k);
  try {
    const keys = (await run("readonly", (s) => s.getAllKeys())) as IDBValidKey[];
    for (const k of keys) if (String(k).startsWith(`${campaignId}:`)) await run("readwrite", (s) => s.delete(k));
  } catch { /* nothing stored */ }
}

export const blobToDataUrl = (b: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(b);
  });
