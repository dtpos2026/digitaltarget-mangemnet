import { createServer } from "node:http";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import pino from "pino";
import { loadConfig } from "./config.js";
import { Manager } from "./manager.js";
import { FirestoreStore } from "./store.js";

const cfg = loadConfig();
const log = pino({ level: cfg.logLevel, base: { svc: "dt-whatsapp", instance: cfg.instanceId } });
if (!cfg.sessionKey) log.warn("WA_SESSION_KEY not set — session stored UNENCRYPTED (local testing only)");

// Credentials: GOOGLE_APPLICATION_CREDENTIALS (service-account JSON) locally,
// or the attached service account on Cloud Run / GCE.
initializeApp(cfg.storageBucket ? { storageBucket: cfg.storageBucket } : undefined);
const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });
const bucket = cfg.storageBucket ? getStorage().bucket() : null;
if (!bucket) log.warn("FIREBASE_STORAGE_BUCKET not set — media will not be downloaded");

const store = new FirestoreStore(db, cfg.presetsPath);
const manager = new Manager({ db, bucket, cfg, log, store });
manager.start();

// Health endpoint (Cloud Run / uptime checks). Exposes no message data.
const server = createServer((req, res) => {
  if (req.url === "/healthz" || req.url === "/") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, instance: cfg.instanceId, accounts: manager.summary() }));
    return;
  }
  res.writeHead(404).end();
});
server.listen(cfg.port, () => log.info({ port: cfg.port }, "whatsapp-service listening"));

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info({ signal }, "shutting down");
  server.close();
  await manager.shutdown().catch((e) => log.error({ err: e }, "shutdown error"));
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("unhandledRejection", (e) => log.error({ err: e }, "unhandled rejection"));
