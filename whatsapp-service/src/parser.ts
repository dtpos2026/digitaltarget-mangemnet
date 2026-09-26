import {
  getContentType,
  isJidBroadcast,
  isJidGroup,
  isJidNewsletter,
  isJidStatusBroadcast,
  isLidUser,
  isPnUser,
  jidNormalizedUser,
  normalizeMessageContent,
  proto,
  toNumber,
  type WAMessage,
} from "@whiskeysockets/baileys";

export type MessageKind =
  | "text" | "image" | "video" | "audio" | "document" | "sticker" | "location"
  | "contact" | "poll" | "reaction" | "revoke" | "edit" | "call" | "other";

export type ChatType = "user" | "group" | "status" | "broadcast" | "newsletter";

export interface MediaInfo {
  kind: "image" | "video" | "audio" | "document" | "sticker";
  mimetype?: string;
  fileName?: string;
  size?: number;
  seconds?: number;
  ptt?: boolean;
}

export interface ParsedMessage {
  id: string;
  chatJid: string;
  chatType: ChatType;
  fromMe: boolean;
  /** Sender (participant in groups, chat jid in 1:1). */
  senderJid: string;
  pushName?: string;
  /** Epoch milliseconds. */
  timestamp: number;
  kind: MessageKind;
  /** Text, caption, or a short summary for non-text messages. */
  text: string;
  media?: MediaInfo;
  quotedId?: string;
  /** Message a reaction / delete / edit refers to. */
  targetId?: string;
  /** Delivery status for our own messages (proto WebMessageInfo.Status). */
  status?: number;
  /** Phone-number jid (…@s.whatsapp.net) of a 1:1 chat, when known. */
  pnJid?: string;
  /** Privacy id jid (…@lid) of a 1:1 chat, when known. */
  lidJid?: string;
}

export function chatTypeOf(jid: string): ChatType {
  if (isJidStatusBroadcast(jid)) return "status";
  if (isJidGroup(jid)) return "group";
  if (isJidNewsletter(jid)) return "newsletter";
  if (isJidBroadcast(jid)) return "broadcast";
  return "user";
}

const STATUS = proto.WebMessageInfo.Status;
/** Maps proto status to the values the portal shows. */
export function statusLabel(status: number | null | undefined, fromMe: boolean): string {
  if (!fromMe) return "received";
  switch (status) {
    case STATUS.ERROR: return "failed";
    case STATUS.PENDING: return "pending";
    case STATUS.SERVER_ACK: return "sent";
    case STATUS.DELIVERY_ACK: return "delivered";
    case STATUS.READ:
    case STATUS.PLAYED: return "read";
    default: return "sent";
  }
}

function textOf(content: proto.IMessage | null | undefined): string {
  if (!content) return "";
  return content.conversation || content.extendedTextMessage?.text || "";
}

const mediaInfo = (
  kind: MediaInfo["kind"],
  m: { mimetype?: string | null; fileLength?: unknown; seconds?: number | null; fileName?: string | null; ptt?: boolean | null }
): MediaInfo => ({
  kind,
  ...(m.mimetype ? { mimetype: m.mimetype } : {}),
  ...(m.fileName ? { fileName: m.fileName } : {}),
  ...(m.fileLength != null ? { size: toNumber(m.fileLength as number) } : {}),
  ...(m.seconds ? { seconds: m.seconds } : {}),
  ...(m.ptt ? { ptt: true } : {}),
});

/**
 * Turns a raw Baileys message into the shape stored in Firestore.
 * Returns null for things that are not user-visible messages
 * (key distribution, history-sync notifications, empty stubs…).
 */
export function parseMessage(msg: WAMessage): ParsedMessage | null {
  const key = msg.key;
  const chatJid = key?.remoteJid;
  if (!chatJid || !key.id) return null;
  const content = normalizeMessageContent(msg.message);
  const type = getContentType(content);
  if (!content || !type) return null;

  const fromMe = !!key.fromMe;
  const chatType = chatTypeOf(chatJid);
  const out: ParsedMessage = {
    id: key.id,
    chatJid,
    chatType,
    fromMe,
    senderJid: key.participant || chatJid,
    timestamp: toNumber(msg.messageTimestamp as number) * 1000 || Date.now(),
    kind: "other",
    text: "",
  };
  if (msg.pushName) out.pushName = msg.pushName;
  if (fromMe && msg.status != null) out.status = msg.status;

  if (chatType === "user") {
    const alt = key.remoteJidAlt;
    if (isPnUser(chatJid)) out.pnJid = jidNormalizedUser(chatJid);
    else if (alt && isPnUser(alt)) out.pnJid = jidNormalizedUser(alt);
    if (isLidUser(chatJid)) out.lidJid = jidNormalizedUser(chatJid);
    else if (alt && isLidUser(alt)) out.lidJid = jidNormalizedUser(alt);
  }

  const ctx = (content[type] as { contextInfo?: proto.IContextInfo } | undefined)?.contextInfo;
  if (ctx?.stanzaId) out.quotedId = ctx.stanzaId;

  switch (type) {
    case "conversation":
    case "extendedTextMessage":
      out.kind = "text";
      out.text = textOf(content);
      break;
    case "imageMessage":
      out.kind = "image";
      out.text = content.imageMessage?.caption || "";
      out.media = mediaInfo("image", content.imageMessage!);
      break;
    case "videoMessage":
      out.kind = "video";
      out.text = content.videoMessage?.caption || "";
      out.media = mediaInfo("video", content.videoMessage!);
      break;
    case "audioMessage":
      out.kind = "audio";
      out.media = mediaInfo("audio", content.audioMessage!);
      out.text = content.audioMessage?.ptt ? "🎤 Voice message" : "🎵 Audio";
      break;
    case "documentMessage":
      out.kind = "document";
      out.text = content.documentMessage?.caption || content.documentMessage?.fileName || "📄 Document";
      out.media = mediaInfo("document", content.documentMessage!);
      break;
    case "stickerMessage":
      out.kind = "sticker";
      out.text = "Sticker";
      out.media = mediaInfo("sticker", content.stickerMessage!);
      break;
    case "locationMessage":
    case "liveLocationMessage": {
      const l = content.locationMessage || content.liveLocationMessage;
      out.kind = "location";
      const name = (l as proto.Message.ILocationMessage)?.name;
      out.text = `📍 ${name ? name + " " : ""}${l?.degreesLatitude ?? ""},${l?.degreesLongitude ?? ""}`.trim();
      break;
    }
    case "contactMessage":
      out.kind = "contact";
      out.text = `👤 ${content.contactMessage?.displayName || "Contact"}`;
      break;
    case "contactsArrayMessage":
      out.kind = "contact";
      out.text = `👤 ${content.contactsArrayMessage?.contacts?.length || 0} contacts`;
      break;
    case "pollCreationMessage":
    case "pollCreationMessageV2":
    case "pollCreationMessageV3": {
      const p = content.pollCreationMessage || content.pollCreationMessageV2 || content.pollCreationMessageV3;
      out.kind = "poll";
      out.text = `📊 ${p?.name || "Poll"}`;
      break;
    }
    case "buttonsResponseMessage":
      out.kind = "text";
      out.text = content.buttonsResponseMessage?.selectedDisplayText || "";
      break;
    case "listResponseMessage":
      out.kind = "text";
      out.text = content.listResponseMessage?.title || content.listResponseMessage?.singleSelectReply?.selectedRowId || "";
      break;
    case "templateButtonReplyMessage":
      out.kind = "text";
      out.text = content.templateButtonReplyMessage?.selectedDisplayText || "";
      break;
    case "reactionMessage":
      out.kind = "reaction";
      out.text = content.reactionMessage?.text || "";
      out.targetId = content.reactionMessage?.key?.id || undefined;
      break;
    case "protocolMessage": {
      const pm = content.protocolMessage!;
      if (pm.type === proto.Message.ProtocolMessage.Type.REVOKE) {
        out.kind = "revoke";
        out.targetId = pm.key?.id || undefined;
      } else if (pm.type === proto.Message.ProtocolMessage.Type.MESSAGE_EDIT) {
        out.kind = "edit";
        out.targetId = pm.key?.id || undefined;
        out.text = textOf(normalizeMessageContent(pm.editedMessage));
      } else {
        return null; // history-sync notices, key shares, ephemeral settings…
      }
      break;
    }
    default:
      out.kind = "other";
      out.text = `[${type.replace(/Message$/, "")}]`;
  }
  return out;
}
