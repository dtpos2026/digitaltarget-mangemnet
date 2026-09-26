import type { WAMessage } from "@whiskeysockets/baileys";

let seq = 0;
/** Builds a Baileys-shaped message for tests. */
export function waMsg(opts: {
  jid?: string;
  alt?: string;
  participant?: string;
  fromMe?: boolean;
  id?: string;
  ts?: number;
  pushName?: string;
  message: Record<string, unknown>;
}): WAMessage {
  return {
    key: {
      remoteJid: opts.jid ?? "923451873354@s.whatsapp.net",
      ...(opts.alt ? { remoteJidAlt: opts.alt } : {}),
      ...(opts.participant ? { participant: opts.participant } : {}),
      fromMe: !!opts.fromMe,
      id: opts.id ?? `MSG${++seq}`,
    },
    messageTimestamp: opts.ts ?? 1790000000,
    ...(opts.pushName ? { pushName: opts.pushName } : {}),
    message: opts.message,
  } as unknown as WAMessage;
}
