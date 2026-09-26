import { downloadMediaMessage, type WAMessage, type WASocket } from "@whiskeysockets/baileys";
import type { getStorage } from "firebase-admin/storage";
import type { ParsedMessage } from "./parser.js";
import type { StoredMedia } from "./types.js";

type Bucket = ReturnType<ReturnType<typeof getStorage>["bucket"]>;

const EXT: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
  "video/mp4": "mp4", "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/mp4": "m4a",
  "application/pdf": "pdf",
};

function extFor(p: ParsedMessage): string {
  const mime = (p.media?.mimetype || "").split(";")[0].trim();
  if (EXT[mime]) return EXT[mime];
  const fromName = p.media?.fileName?.split(".").pop();
  if (fromName && /^[a-z0-9]{1,8}$/i.test(fromName)) return fromName.toLowerCase();
  return "bin";
}

/**
 * Downloads a message's media and stores it at
 * workspaces/{ws}/whatsapp/{conversation}/{messageId}.{ext}
 * (readable only by users with whatsapp.view — see storage.rules).
 */
export function makeMediaStorer(opts: { bucket: Bucket; ws: string; maxBytes: number; getSocket: () => WASocket | null }) {
  return async (msg: WAMessage, p: ParsedMessage, conversationId: string): Promise<StoredMedia | null> => {
    if (!p.media) return null;
    if (p.media.size && p.media.size > opts.maxBytes) return { ...p.media, skipped: "too large" };
    const sock = opts.getSocket();
    const buffer = await downloadMediaMessage(msg, "buffer", {}, sock ? { logger: sock.logger, reuploadRequest: sock.updateMediaMessage } : undefined);
    if (buffer.length > opts.maxBytes) return { ...p.media, skipped: "too large" };
    const safeId = p.id.replace(/[^\w-]/g, "_");
    const path = `workspaces/${opts.ws}/whatsapp/${conversationId}/${safeId}.${extFor(p)}`;
    await opts.bucket.file(path).save(buffer, {
      resumable: false,
      contentType: p.media.mimetype?.split(";")[0] || "application/octet-stream",
      metadata: { cacheControl: "private, max-age=31536000" },
    });
    return { ...p.media, size: buffer.length, path };
  };
}
