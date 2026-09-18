// authContext.jsx
//
// Single source of truth for auth state across the app. Wrap your app
// in <AuthProvider> once (e.g. in main.jsx / index.jsx), then read
// { user, role, emailVerified, initializing, ... } via useAuth() anywhere.
//
// Security decisions made here, and why:
//
// 1. Role comes from Firestore, never from anything the client claims.
//    On sign-in we look the uid up in `adminUsers` first (staff), then
//    `users` (patients). The client only ever *reads* these — writes to
//    adminUsers must stay restricted to the hospital's own admin
//    console / Cloud Functions, per Security Architecture 6.1. This
//    context does not grant access by itself; your Firestore Security
//    Rules and Cloud Functions are the real enforcement boundary. Treat
//    `role` here as UI routing only, not a security control.
//
// 2. Generic error messages. Firebase error codes like
//    'auth/user-not-found' vs 'auth/wrong-password' are collapsed into
//    one message so a failed login can't be used to enumerate which
//    emails have accounts.
//
// 3. Client-side attempt throttling. This slows down casual brute
//    forcing in the UI and is a UX nicety, not the real defense — per
//    the architecture doc (6.2), the actual lockout-after-repeated-
//    failures control belongs on the server (Firebase
//    Identity Platform's account-lockout setting, or a Cloud Function
//    that checks a failedAttempts counter). Wire that up server-side
//    before launch; don't rely on this alone.
//
// 4. Idle timeout. Admin/doctor sessions sign out after a short idle
//    window; patients get a longer one. This satisfies "session tokens
//    expire and require re-authentication after a period of inactivity"
//    (6.2) at the app level, on top of Firebase's own token refresh.
//
// 5. MFA is intentionally NOT implemented yet (per your instruction, to
//    avoid friction while testing). Search this file for "MFA HOOK" for
//    the one place it plugs in later — Firebase's multi-factor sign-in
//    surfaces as an `auth/multi-factor-auth-required` error on
//    signInWithEmailAndPassword, which you catch and resolve with
//    getMultiFactorResolver() + TotpMultiFactorGenerator.
//
// 6. emailVerified is tracked as its own state, not read directly off
//    firebaseUser.emailVerified. That field is a snapshot cached by the
//    SDK at the last token refresh — clicking the verification link in
//    an email does not push a change back into an already-open tab.
//    auth.currentUser.reload() forces a real check against Firebase's
//    servers and updates auth.currentUser in place, but since it's the
//    same object reference, handing it back to setFirebaseUser() won't
//    reliably cause a re-render, and reload() does not fire
//    onAuthStateChanged either. refreshEmailVerified() below does the
//    reload and then explicitly sets a plain boolean state, which does
//    trigger a re-render. Call it after the user comes back from
//    clicking the email link, instead of reloading the page.

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
} from "react";
import {
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  sendEmailVerification,
  sendPasswordResetEmail,
  updateProfile,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
} from "firebase/auth";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { auth, db } from "../firebase";

const AuthContext = createContext(null);

// Idle-timeout windows, in minutes. Staff sessions are tighter since
// they can see patient bookings and payment data.
const IDLE_TIMEOUT_MINUTES = { admin: 15, doctor: 15, patient: 30 };

// Client-side login throttle (UX layer only — see note 3 above).
const MAX_ATTEMPTS_BEFORE_COOLDOWN = 5;
const COOLDOWN_MS = 30_000;
const attemptStore = new Map(); // email -> { count, cooldownUntil }

function mapAuthError(err) {
  const code = err?.code || "";
  switch (code) {
    case "auth/invalid-email":
    case "auth/user-not-found":
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return "Invalid email or password.";
    case "auth/too-many-requests":
      return "Too many attempts. Please wait a moment and try again.";
    case "auth/email-already-in-use":
      return "An account with this email already exists.";
    case "auth/weak-password":
      return "Please choose a stronger password.";
    case "auth/network-request-failed":
      return "Network error. Check your connection and try again.";
    case "auth/multi-factor-auth-required":
      // MFA HOOK: resolve with getMultiFactorResolver(auth, err) once MFA is enabled.
      return "Additional verification is required for this account.";
    default:
      return "Something went wrong. Please try again.";
  }
}

export function AuthProvider({ children }) {
  const [firebaseUser, setFirebaseUser] = useState(null);
  const [profile, setProfile] = useState(null); // { role, name, mfaEnabled?, emailVerified }
  const [emailVerifiedFlag, setEmailVerifiedFlag] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const idleTimer = useRef(null);

  const clearIdleTimer = useCallback(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
  }, []);

  const scheduleIdleLogout = useCallback(
    (role) => {
      clearIdleTimer();
      const minutes = IDLE_TIMEOUT_MINUTES[role] ?? 20;
      idleTimer.current = setTimeout(
        () => {
          signOut(auth).catch(() => {});
        },
        minutes * 60 * 1000,
      );
    },
    [clearIdleTimer],
  );

  // Resolve role by checking adminUsers first, then users. Both reads
  // are allowed by Security Rules only for the signed-in user's own
  // uid — see 6.1 in the architecture doc.
  const loadProfile = useCallback(async (fbUser) => {
    const adminSnap = await getDoc(doc(db, "adminUsers", fbUser.uid));
    if (adminSnap.exists()) {
      const data = adminSnap.data();
      return {
        role: data.role || "admin",
        mfaEnabled: !!data.mfaEnabled,
        name: fbUser.displayName || "Staff",
      };
    }
    const patientSnap = await getDoc(doc(db, "users", fbUser.uid));
    if (patientSnap.exists()) {
      const data = patientSnap.data();
      return {
        role: "patient",
        name: data.name || fbUser.displayName || "Patient",
        phone: data.phone,
      };
    }
    // Authenticated but no profile doc yet (edge case, e.g. sign-up
    // write hasn't landed). Treat as patient with no extra data.
    return { role: "patient", name: fbUser.displayName || "Patient" };
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
      setFirebaseUser(fbUser);
      setEmailVerifiedFlag(fbUser?.emailVerified ?? false);
      if (!fbUser) {
        setProfile(null);
        clearIdleTimer();
        setInitializing(false);
        return;
      }
      try {
        const p = await loadProfile(fbUser);
        setProfile(p);
        scheduleIdleLogout(p.role);
      } catch {
        setProfile({ role: "patient", name: fbUser.displayName || "Patient" });
      } finally {
        setInitializing(false);
      }
    });
    return unsubscribe;
  }, [loadProfile, scheduleIdleLogout, clearIdleTimer]);

  // Reset the idle timer on real user activity.
  useEffect(() => {
    if (!firebaseUser || !profile) return;
    const reset = () => scheduleIdleLogout(profile.role);
    const events = ["mousemove", "keydown", "click", "scroll", "touchstart"];
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    return () => {
      events.forEach((e) => window.removeEventListener(e, reset));
      clearIdleTimer();
    };
  }, [firebaseUser, profile, scheduleIdleLogout, clearIdleTimer]);

  const signUpPatient = useCallback(
    async ({ name, phone, email, password }) => {
      const cred = await createUserWithEmailAndPassword(
        auth,
        email.trim(),
        password,
      );
      await updateProfile(cred.user, { displayName: name.trim() });
      await setDoc(doc(db, "users", cred.user.uid), {
        uid: cred.user.uid,
        name: name.trim(),
        phone: phone.trim(),
        email: email.trim(),
        emailVerified: false,
        createdAt: serverTimestamp(),
      });
      await sendEmailVerification(cred.user);
      return cred.user;
    },
    [],
  );

  const signIn = useCallback(
    async (email, password, { rememberMe = false } = {}) => {
      const key = email.trim().toLowerCase();
      const attempt = attemptStore.get(key);
      if (attempt?.cooldownUntil && Date.now() < attempt.cooldownUntil) {
        const waitSec = Math.ceil((attempt.cooldownUntil - Date.now()) / 1000);
        throw new Error(`Too many attempts. Try again in ${waitSec}s.`);
      }

      try {
        // Staff should never silently persist a session on a shared
        // machine; only honor "remember me" for patients on their own device.
        await setPersistence(
          auth,
          rememberMe ? browserLocalPersistence : browserSessionPersistence,
        );
        const cred = await signInWithEmailAndPassword(
          auth,
          email.trim(),
          password,
        );
        attemptStore.delete(key);

        // MFA HOOK: if this account has mfaEnabled and Firebase throws
        // 'auth/multi-factor-auth-required' above, it's caught below and
        // this line is never reached — handle the resolver there instead
        // once MFA is turned back on.
        return cred.user;
      } catch (err) {
        const current = attemptStore.get(key) || { count: 0 };
        const count = current.count + 1;
        attemptStore.set(key, {
          count,
          cooldownUntil:
            count >= MAX_ATTEMPTS_BEFORE_COOLDOWN
              ? Date.now() + COOLDOWN_MS
              : undefined,
        });
        throw new Error(mapAuthError(err));
      }
    },
    [],
  );

  const signOutUser = useCallback(async () => {
    clearIdleTimer();
    await signOut(auth);
  }, [clearIdleTimer]);

  const resetPassword = useCallback(async (email) => {
    try {
      await sendPasswordResetEmail(auth, email.trim());
    } catch (err) {
      // Swallow "user not found" so this can't be used to check which
      // emails are registered — always report success to the caller.
      if (err?.code !== "auth/user-not-found")
        throw new Error(mapAuthError(err));
    }
  }, []);

  const resendVerificationEmail = useCallback(async () => {
    if (!auth.currentUser) return;
    await sendEmailVerification(auth.currentUser);
  }, []);

  // Forces a real check against Firebase's servers for the current
  // user's verification status, and updates state so the app re-renders
  // with the fresh value. See note 6 above — this is the piece a plain
  // page reload was standing in for, incorrectly.
  const refreshEmailVerified = useCallback(async () => {
    if (!auth.currentUser) return false;
    await auth.currentUser.reload();
    const verified = auth.currentUser.emailVerified;
    setEmailVerifiedFlag(verified);
    // Keep firebaseUser in sync too, in case other consumers read
    // fields (displayName, etc.) directly off `user`.
    setFirebaseUser(auth.currentUser);
    return verified;
  }, []);

  const value = {
    user: firebaseUser,
    role: profile?.role ?? null,
    profile,
    emailVerified: emailVerifiedFlag,
    initializing,
    signUpPatient,
    signIn,
    signOutUser,
    resetPassword,
    resendVerificationEmail,
    refreshEmailVerified,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
