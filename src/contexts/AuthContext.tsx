import React, { createContext, useContext, useEffect, useState } from "react";
import { auth, db } from "@/lib/firebase";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  User,
} from "firebase/auth";
import { doc, getDoc, setDoc, getDocs, collection } from "firebase/firestore";

export type UserRole =
  | "admin"
  | "manager"
  | "accountant"
  | "lead_manager"
  | "assistant"
  | "team_member";

export interface RoleDoc {
  uid: string;
  email: string;
  role: UserRole;
  workspaceUid: string; // admin uid that owns the data
  teamId?: string; // for team_member, link to team collection
  createdAt?: number;
}

interface AuthContextType {
  user: User | null;
  role: UserRole | null;
  roleDoc: RoleDoc | null;
  workspaceUid: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  createUserAccount: (
    email: string,
    password: string,
    role: UserRole,
    teamId?: string
  ) => Promise<void>;
  isAdmin: boolean;
  isManager: boolean;
  isAccountant: boolean;
  isLeadManager: boolean;
  isAssistant: boolean;
  isTeamMember: boolean;
  hasFullAccess: boolean; // admin OR manager
}

const AuthContext = createContext<AuthContextType | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be inside AuthProvider");
  return ctx;
}

async function fetchOrCreateRole(
  uid: string,
  email: string | null
): Promise<RoleDoc> {
  const ref = doc(db, "roles", uid);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    const data = snap.data() as RoleDoc;
    // backfill workspaceUid for legacy admins
    if (!data.workspaceUid) {
      const fixed = { ...data, workspaceUid: data.role === "admin" ? uid : uid };
      await setDoc(ref, fixed);
      return fixed;
    }
    return data;
  }
  // No role doc: first signup ever => admin; otherwise default assistant under first admin's workspace
  const allRoles = await getDocs(collection(db, "roles"));
  const admins = allRoles.docs
    .map((d) => d.data() as RoleDoc)
    .filter((r) => r.role === "admin");
  let newDoc: RoleDoc;
  if (admins.length === 0) {
    newDoc = {
      uid,
      email: email || "",
      role: "admin",
      workspaceUid: uid,
      createdAt: Date.now(),
    };
  } else {
    newDoc = {
      uid,
      email: email || "",
      role: "assistant",
      workspaceUid: admins[0].workspaceUid || admins[0].uid,
      createdAt: Date.now(),
    };
  }
  await setDoc(ref, newDoc);
  return newDoc;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [roleDoc, setRoleDoc] = useState<RoleDoc | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        try {
          const r = await fetchOrCreateRole(u.uid, u.email);
          setRoleDoc(r);
        } catch (e) {
          console.error("Role fetch error", e);
          setRoleDoc(null);
        }
      } else {
        setRoleDoc(null);
      }
      setLoading(false);
    });
    return unsub;
  }, []);

  const login = async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email, password);
  };

  const signup = async (email: string, password: string) => {
    await createUserWithEmailAndPassword(auth, email, password);
  };

  const logout = async () => {
    await signOut(auth);
  };

  // Admin/Manager creates any user with role; new user inherits same workspaceUid
  const createUserAccount = async (
    email: string,
    password: string,
    newRole: UserRole,
    teamId?: string
  ) => {
    const wsUid = roleDoc?.workspaceUid || user?.uid;
    if (!wsUid) throw new Error("No workspace");
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    const newRoleDoc: RoleDoc = {
      uid: cred.user.uid,
      email,
      role: newRole,
      workspaceUid: wsUid,
      teamId: teamId || undefined,
      createdAt: Date.now(),
    };
    await setDoc(doc(db, "roles", cred.user.uid), newRoleDoc);
  };

  const role = roleDoc?.role || null;
  const workspaceUid = roleDoc?.workspaceUid || user?.uid || null;

  return (
    <AuthContext.Provider
      value={{
        user,
        role,
        roleDoc,
        workspaceUid,
        loading,
        login,
        signup,
        logout,
        createUserAccount,
        isAdmin: role === "admin",
        isManager: role === "manager",
        isAccountant: role === "accountant",
        isLeadManager: role === "lead_manager",
        isAssistant: role === "assistant",
        isTeamMember: role === "team_member",
        hasFullAccess: role === "admin" || role === "manager",
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
