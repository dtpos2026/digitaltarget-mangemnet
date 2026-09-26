import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyAKr7v02vrmzhBTfiLG_6rKH1Xv3GsHS4I",
  authDomain: "digital-target007.firebaseapp.com",
  projectId: "digital-target007",
  storageBucket: "digital-target007.firebasestorage.app",
  messagingSenderId: "447921234317",
  appId: "1:447921234317:web:c71388b943fdb8edb85dc4",
  measurementId: "G-T4E431S6C8",
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export default app;
