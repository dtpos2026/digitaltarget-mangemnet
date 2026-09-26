import {
  BufferJSON,
  initAuthCreds,
  proto,
  type AuthenticationCreds,
  type AuthenticationState,
  type SignalDataTypeMap,
} from "@whiskeysockets/baileys";
import type { Firestore } from "firebase-admin/firestore";
import type { SessionCipher } from "./crypto.js";

const docId = (type: string, id: string) => `${type}-${id}`.replace(/\//g, "__");

/**
 * Baileys auth state stored in Firestore (waSessions/{sessionId} + /keys),
 * encrypted with WA_SESSION_KEY. Survives restarts and redeploys, so the
 * phone does not have to scan the QR again. Clients can never read this
 * collection (see firestore.rules).
 */
export async function useFirestoreAuthState(db: Firestore, sessionId: string, cipher: SessionCipher) {
  const root = db.collection("waSessions").doc(sessionId);
  const keys = root.collection("keys");

  const decode = (stored: unknown) => JSON.parse(cipher.decrypt(String(stored)), BufferJSON.reviver);
  const encode = (value: unknown) => cipher.encrypt(JSON.stringify(value, BufferJSON.replacer));

  const snap = await root.get();
  const creds: AuthenticationCreds = snap.exists && snap.get("creds") ? decode(snap.get("creds")) : initAuthCreds();

  const state: AuthenticationState = {
    creds,
    keys: {
      get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
        const out: { [id: string]: SignalDataTypeMap[T] } = {};
        for (let i = 0; i < ids.length; i += 100) {
          const chunk = ids.slice(i, i + 100);
          const docs = await db.getAll(...chunk.map((id) => keys.doc(docId(type, id))));
          docs.forEach((d, j) => {
            if (!d.exists) return;
            let value = decode(d.get("v"));
            if (type === "app-state-sync-key" && value) value = proto.Message.AppStateSyncKeyData.fromObject(value);
            out[chunk[j]] = value;
          });
        }
        return out;
      },
      set: async (data) => {
        let batch = db.batch();
        let n = 0;
        for (const category in data) {
          const entries = data[category as keyof SignalDataTypeMap] || {};
          for (const id in entries) {
            const value = entries[id];
            const ref = keys.doc(docId(category, id));
            if (value) batch.set(ref, { v: encode(value) });
            else batch.delete(ref);
            if (++n % 450 === 0) {
              await batch.commit();
              batch = db.batch();
            }
          }
        }
        if (n % 450 !== 0) await batch.commit();
      },
    },
  };

  return {
    state,
    saveCreds: async () => {
      await root.set({ creds: encode(state.creds), updatedAt: new Date().toISOString() }, { merge: true });
    },
    /** Forget the linked device (after logout / "logged out from phone"). */
    clear: async () => {
      await db.recursiveDelete(root);
    },
    hasSession: () => !!state.creds.registered || !!state.creds.me,
  };
}
