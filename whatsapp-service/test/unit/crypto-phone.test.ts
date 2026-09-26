import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SessionCipher } from "../../src/crypto.js";
import { formatLocalPhone, jidUser, normalizePhone } from "../../src/phone.js";

describe("SessionCipher", () => {
  const key = randomBytes(32);
  it("round-trips and does not store plaintext", () => {
    const c = new SessionCipher(key);
    const enc = c.encrypt('{"noiseKey":"secret"}');
    expect(enc.startsWith("v1:")).toBe(true);
    expect(enc).not.toContain("secret");
    expect(c.decrypt(enc)).toBe('{"noiseKey":"secret"}');
  });
  it("rejects tampering and wrong keys", () => {
    const enc = new SessionCipher(key).encrypt("data");
    const tampered = enc.slice(0, -4) + (enc.endsWith("AAAA") ? "BBBB" : "AAAA");
    expect(() => new SessionCipher(key).decrypt(tampered)).toThrow();
    expect(() => new SessionCipher(randomBytes(32)).decrypt(enc)).toThrow();
  });
  it("refuses plaintext sessions once a key is configured", () => {
    const plain = new SessionCipher(null).encrypt("x");
    expect(() => new SessionCipher(key).decrypt(plain)).toThrow();
  });
});

describe("phone helpers (same vectors as the portal)", () => {
  it.each([
    ["03451873354", "923451873354"],
    ["+92 345 1873354", "923451873354"],
    ["00923451873354", "923451873354"],
    ["3451873354", "923451873354"],
    ["+1 (415) 555-2671", "14155552671"],
    ["12345", ""],
  ])("%s → %s", (i, o) => expect(normalizePhone(i)).toBe(o));
  it("formats and reads jids", () => {
    expect(formatLocalPhone("923451873354")).toBe("03451873354");
    expect(jidUser("923451873354:12@s.whatsapp.net")).toBe("923451873354");
  });
});

import { FieldValue } from "firebase-admin/firestore";
import { statsDoc } from "../../src/store.js";
describe("statsDoc", () => {
  it("nests dotted counters for a merge write", () => {
    const d = statsDoc("2026-09-26", { inbound: 2, "byUser.u1.sent": 1 }, { "byUser.u1.email": "a@b.pk" }) as any;
    expect(d.day).toBe("2026-09-26");
    expect(d.inbound.isEqual(FieldValue.increment(2))).toBe(true);
    expect(d.byUser.u1.sent.isEqual(FieldValue.increment(1))).toBe(true);
    expect(d.byUser.u1.email).toBe("a@b.pk");
  });
});
