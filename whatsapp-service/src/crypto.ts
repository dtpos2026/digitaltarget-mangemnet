import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Encrypts WhatsApp session material before it is stored in Firestore.
 * Anyone holding these keys can impersonate the linked device, so they are
 * AES-256-GCM encrypted and the waSessions collection is closed to clients.
 */
export class SessionCipher {
  constructor(private readonly key: Buffer | null) {}

  encrypt(plain: string): string {
    if (!this.key) return "plain:" + plain;
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", this.key, iv);
    const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
    return "v1:" + Buffer.concat([iv, c.getAuthTag(), enc]).toString("base64");
  }

  decrypt(stored: string): string {
    if (stored.startsWith("plain:")) {
      if (this.key) throw new Error("Refusing plaintext session data while WA_SESSION_KEY is set");
      return stored.slice(6);
    }
    if (!stored.startsWith("v1:")) throw new Error("Unknown session encoding");
    if (!this.key) throw new Error("Session is encrypted but WA_SESSION_KEY is not set");
    const raw = Buffer.from(stored.slice(3), "base64");
    const d = createDecipheriv("aes-256-gcm", this.key, raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
  }
}
