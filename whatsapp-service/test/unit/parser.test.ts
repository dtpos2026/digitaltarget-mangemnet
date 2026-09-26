import { proto } from "@whiskeysockets/baileys";
import { describe, expect, it } from "vitest";
import { parseMessage, statusLabel } from "../../src/parser.js";
import { waMsg } from "./msg.js";

describe("parseMessage", () => {
  it("plain and extended text with quote", () => {
    const a = parseMessage(waMsg({ message: { conversation: "Salam, price?" }, pushName: "Ali", ts: 1790000000 }))!;
    expect(a).toMatchObject({ kind: "text", text: "Salam, price?", chatType: "user", fromMe: false, pushName: "Ali", pnJid: "923451873354@s.whatsapp.net", timestamp: 1790000000000 });
    const b = parseMessage(waMsg({ message: { extendedTextMessage: { text: "yes", contextInfo: { stanzaId: "Q1" } } } }))!;
    expect(b).toMatchObject({ kind: "text", text: "yes", quotedId: "Q1" });
  });

  it("media with caption and metadata, including wrapped (ephemeral / view-once)", () => {
    const img = parseMessage(waMsg({ message: { ephemeralMessage: { message: { imageMessage: { caption: "menu", mimetype: "image/jpeg", fileLength: 2048 } } } } }))!;
    expect(img).toMatchObject({ kind: "image", text: "menu", media: { kind: "image", mimetype: "image/jpeg", size: 2048 } });
    const doc = parseMessage(waMsg({ message: { documentWithCaptionMessage: { message: { documentMessage: { fileName: "quote.pdf", mimetype: "application/pdf" } } } } }))!;
    expect(doc).toMatchObject({ kind: "document", text: "quote.pdf", media: { fileName: "quote.pdf" } });
    const ptt = parseMessage(waMsg({ message: { audioMessage: { ptt: true, seconds: 7, mimetype: "audio/ogg" } } }))!;
    expect(ptt).toMatchObject({ kind: "audio", media: { ptt: true, seconds: 7 } });
  });

  it("reactions, deletes and edits point at the target message", () => {
    expect(parseMessage(waMsg({ message: { reactionMessage: { text: "👍", key: { id: "T1" } } } }))).toMatchObject({ kind: "reaction", text: "👍", targetId: "T1" });
    expect(parseMessage(waMsg({ message: { protocolMessage: { type: proto.Message.ProtocolMessage.Type.REVOKE, key: { id: "T2" } } } }))).toMatchObject({ kind: "revoke", targetId: "T2" });
    expect(parseMessage(waMsg({ message: { protocolMessage: { type: proto.Message.ProtocolMessage.Type.MESSAGE_EDIT, key: { id: "T3" }, editedMessage: { conversation: "fixed" } } } })))
      .toMatchObject({ kind: "edit", targetId: "T3", text: "fixed" });
  });

  it("ignores non-visible protocol messages and empty content", () => {
    expect(parseMessage(waMsg({ message: { protocolMessage: { type: proto.Message.ProtocolMessage.Type.HISTORY_SYNC_NOTIFICATION } } }))).toBeNull();
    expect(parseMessage(waMsg({ message: {} }))).toBeNull();
    expect(parseMessage({ key: { remoteJid: "x@s.whatsapp.net" } } as never)).toBeNull();
  });

  it("classifies chats and resolves phone vs privacy (lid) ids", () => {
    expect(parseMessage(waMsg({ jid: "1203630@g.us", participant: "923001112233@s.whatsapp.net", message: { conversation: "hi" } }))).toMatchObject({ chatType: "group", senderJid: "923001112233@s.whatsapp.net" });
    expect(parseMessage(waMsg({ jid: "status@broadcast", message: { conversation: "story" } }))!.chatType).toBe("status");
    const lid = parseMessage(waMsg({ jid: "98765@lid", alt: "923009998877@s.whatsapp.net", message: { conversation: "hi" } }))!;
    expect(lid).toMatchObject({ lidJid: "98765@lid", pnJid: "923009998877@s.whatsapp.net" });
  });

  it("maps delivery status for our own messages", () => {
    expect(statusLabel(proto.WebMessageInfo.Status.READ, true)).toBe("read");
    expect(statusLabel(proto.WebMessageInfo.Status.DELIVERY_ACK, true)).toBe("delivered");
    expect(statusLabel(undefined, false)).toBe("received");
  });
});
