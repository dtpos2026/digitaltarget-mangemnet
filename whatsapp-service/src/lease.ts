import type { DocumentReference, Firestore } from "firebase-admin/firestore";

/**
 * Only one running service instance may drive a WhatsApp session. Two
 * sockets on the same linked device kick each other off ("connection
 * replaced") in a loop, which can get the number flagged. The lease lives in
 * waLeases/{sessionId} and is renewed while the instance is healthy.
 */
export class Lease {
  private timer: NodeJS.Timeout | null = null;
  private readonly ref: DocumentReference;

  constructor(private readonly db: Firestore, sessionId: string, private readonly owner: string, private readonly ttlMs = 60_000) {
    this.ref = db.collection("waLeases").doc(sessionId);
  }

  async acquire(): Promise<boolean> {
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(this.ref);
      const cur = snap.data() as { owner?: string; expiresAt?: number } | undefined;
      if (cur?.owner && cur.owner !== this.owner && (cur.expiresAt || 0) > Date.now()) return false;
      tx.set(this.ref, { owner: this.owner, expiresAt: Date.now() + this.ttlMs, renewedAt: new Date().toISOString() });
      return true;
    });
  }

  /** Renews every ttl/3; calls onLost if another instance took over. */
  keepAlive(onLost: () => void) {
    this.stop();
    this.timer = setInterval(async () => {
      try {
        if (!(await this.acquire())) {
          this.stop();
          onLost();
        }
      } catch {
        /* transient; next tick retries before the lease expires */
      }
    }, Math.floor(this.ttlMs / 3));
    this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async release() {
    this.stop();
    await this.db.runTransaction(async (tx) => {
      const snap = await tx.get(this.ref);
      if (snap.get("owner") === this.owner) tx.delete(this.ref);
    }).catch(() => undefined);
  }
}
