import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { auth, db, firebaseConfig } from "@/lib/firebase";
import { deleteApp, initializeApp } from "firebase/app";
import {
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  User,
} from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { effectivePermissions, isSuperRole, Permission, presetFor } from "@/lib/permissions";

export type UserRole = string;

export interface RoleDoc {
  uid: string;
  email: string;
  role: UserRole;
  workspaceUid: string; // admin uid that owns the data
  teamId?: string; // links the login to a Team record (My Portal)
  /** Explicit permission list; when missing the role preset applies. */
  permissions?: string[];
  disabled?: boolean;
  displayName?: string;
  createdAt?: number;
  createdBy?: string;
  updatedAt?: number;
  updatedBy?: string;
}

/** Why a signed-in user may still be blocked from the portal. */
export type AccessState = "ok" | "no_role" | "disabled" | "error";

interface AuthContextType {
  user: User | null;
  role: UserRole | null;
  roleDoc: RoleDoc | null;
  workspaceUid: string | null;
  loading: boolean;
  access: AccessState;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  createUserAccount: (input: {
    email: string;
    password: string;
    role: UserRole;
    teamId?: string;
    permissions?: string[];
    displayName?: string;
  }) => Promise<string>;
  perms: Set<Permission>;
  can: (p: Permission | Permission[]) => boolean;
  isAdmin: boolean;
  isTeamMember: boolean;
  hasFullAccess: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be inside AuthProvider");
  return ctx;
}

// Role docs are created only by an admin (see createUserAccount). A login
// without one gets no access — the old "auto-create assistant" path let anyone
// who signed up read business data, and re-admitted removed users.
async function fetchRole(uid: string): Promise<RoleDoc | null> {
  const snap = await getDoc(doc(db, "roles", uid));
  return snap.exists() ? (snap.data() as RoleDoc) : null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [roleDoc, setRoleDoc] = useState<RoleDoc | null>(null);
  const [access, setAccess] = useState<AccessState>("ok");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setLoading(true);
      setUser(u);
      if (!u) {
        setRoleDoc(null);
        setAccess("ok");
        setLoading(false);
        return;
      }
      try {
        const r = await fetchRole(u.uid);
        setRoleDoc(r);
        setAccess(!r ? "no_role" : r.disabled ? "disabled" : "ok");
      } catch (e) {
        console.error("Role fetch error", e);
        setRoleDoc(null);
        setAccess("error");
      }
      setLoading(false);
    });
    return unsub;
  }, []);

  const login = async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email, password);
  };

  const logout = async () => {
    await signOut(auth);
  };

  const resetPassword = async (email: string) => {
    await sendPasswordResetEmail(auth, email);
  };

  // Creates the Firebase Auth account on a throwaway secondary app so the
  // admin stays signed in, then writes the role doc as the admin (the rules
  // only let users.manage holders write role docs).
  const createUserAccount: AuthContextType["createUserAccount"] = async (input) => {
    const wsUid = roleDoc?.workspaceUid;
    if (!wsUid || !user) throw new Error("No workspace");
    const secondary = initializeApp(firebaseConfig, `create-user-${Date.now()}`);
    try {
      const cred = await createUserWithEmailAndPassword(getAuth(secondary), input.email, input.password);
      const newRoleDoc: RoleDoc = {
        uid: cred.user.uid,
        email: input.email,
        role: input.role,
        workspaceUid: wsUid,
        permissions: input.permissions ?? presetFor(input.role),
        createdAt: Date.now(),
        createdBy: user.uid,
        ...(input.teamId ? { teamId: input.teamId } : {}),
        ...(input.displayName ? { displayName: input.displayName } : {}),
      };
      await setDoc(doc(db, "roles", cred.user.uid), newRoleDoc);
      await signOut(getAuth(secondary));
      return cred.user.uid;
    } finally {
      await deleteApp(secondary);
    }
  };

  const perms = useMemo(() => effectivePermissions(roleDoc), [roleDoc]);
  const can = useCallback(
    (p: Permission | Permission[]) => (Array.isArray(p) ? p.some((x) => perms.has(x)) : perms.has(p)),
    [perms]
  );

  const role = roleDoc?.role || null;
  const workspaceUid = access === "ok" ? roleDoc?.workspaceUid || null : null;

  return (
    <AuthContext.Provider
      value={{
        user,
        role,
        roleDoc,
        workspaceUid,
        loading,
        access,
        login,
        logout,
        resetPassword,
        createUserAccount,
        perms,
        can,
        isAdmin: isSuperRole(role),
        isTeamMember: role === "team_member",
        hasFullAccess: perms.has("data.manage"),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
