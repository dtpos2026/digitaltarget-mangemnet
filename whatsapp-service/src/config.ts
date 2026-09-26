import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface Config {
  port: number;
  /** 32-byte AES key for WhatsApp session data at rest (null only in dev). */
  sessionKey: Buffer | null;
  /** Restrict the service to one workspace (admin uid); null = every workspace. */
  workspaceUid: string | null;
  storageBucket: string | undefined;
  mediaMaxBytes: number;
  timezone: string;
  instanceId: string;
  logLevel: string;
  /** Minimum gap between outgoing messages per account (anti-spam). */
  sendIntervalMs: number;
  presetsPath: string;
}

function findPresets(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.PERMISSION_PRESETS_PATH,
    join(here, "../permission-presets.json"), // Docker image
    join(here, "../../src/lib/permission-presets.json"), // repo checkout (dist/ or src/)
  ].filter(Boolean) as string[];
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error(`permission-presets.json not found (looked in ${candidates.join(", ")})`);
  return found;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  let sessionKey: Buffer | null = null;
  if (env.WA_SESSION_KEY) {
    sessionKey = Buffer.from(env.WA_SESSION_KEY, "base64");
    if (sessionKey.length !== 32) throw new Error("WA_SESSION_KEY must be 32 bytes, base64-encoded (npm run gen-key)");
  } else if (env.ALLOW_PLAINTEXT_SESSION !== "true") {
    throw new Error("WA_SESSION_KEY is required (npm run gen-key). Set ALLOW_PLAINTEXT_SESSION=true only for local testing.");
  }
  return {
    port: Number(env.PORT || 8080),
    sessionKey,
    workspaceUid: env.WORKSPACE_UID || null,
    storageBucket: env.FIREBASE_STORAGE_BUCKET || undefined,
    mediaMaxBytes: Number(env.MEDIA_MAX_MB || 16) * 1024 * 1024,
    timezone: env.TZ_LEADS || "Asia/Karachi",
    instanceId: env.INSTANCE_ID || `${env.HOSTNAME || "wa"}-${randomUUID().slice(0, 8)}`,
    logLevel: env.LOG_LEVEL || "info",
    sendIntervalMs: Number(env.SEND_INTERVAL_MS || 1500),
    presetsPath: findPresets(),
  };
}
