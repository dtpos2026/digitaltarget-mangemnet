import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { connectFirestoreEmulator, initializeFirestore } from "firebase/firestore";
import { connectStorageEmulator, getStorage } from "firebase/storage";

// Firebase web config is a public identifier, not a secret: access is enforced
// by firestore.rules / storage.rules. Values can be overridden per environment
// with VITE_FIREBASE_* variables (see .env.example); the defaults are the
// existing digital-target007 project.
const env = import.meta.env;
export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY || "AIzaSyAKr7v02vrmzhBTfiLG_6rKH1Xv3GsHS4I",
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || "digital-target007.firebaseapp.com",
  projectId: env.VITE_FIREBASE_PROJECT_ID || "digital-target007",
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || "digital-target007.firebasestorage.app",
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || "447921234317",
  appId: env.VITE_FIREBASE_APP_ID || "1:447921234317:web:c71388b943fdb8edb85dc4",
  measurementId: env.VITE_FIREBASE_MEASUREMENT_ID || "G-T4E431S6C8",
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
// ignoreUndefinedProperties: several forms spread optional fields that may be
// undefined; without it Firestore rejects the whole write.
export const db = initializeFirestore(app, { ignoreUndefinedProperties: true });
export const storage = getStorage(app);

// Local development against `firebase emulators:start`.
if (env.VITE_USE_FIREBASE_EMULATORS === "true") {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8085);
  connectStorageEmulator(storage, "127.0.0.1", 9199);
}

export default app;
