// authContext.jsx
//
// Single source of truth for auth state across the app. Wrap your app
// in <AuthProvider> once (e.g. in main.jsx / index.jsx), then read
// { user, role, emailVerified, initializing, ... } via useAuth() anywhere.
//
// Security decisions made here, and why:
//
// 1. Role comes from Firestore, never from anything the client claims.
//    On sign-in we look the uid up in `adminUsers` (staff) or `users`
//    (patients), depending on which login page was used (see note 8).
//    The client only ever *reads* these — writes to adminUsers must stay
//    restricted to the hospital's own admin console / Cloud Functions,
//    per Security Architecture 6.1. This context does not grant access
//    by itself; your Firestore Security Rules and Cloud Functions are
//    the real enforcement boundary. Treat `role` here as UI routing
//    only, not a security control.
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
//    IMPORTANT: this throttle counts signInWithEmailAndPassword
//    failures and wrong-audience logins (which are deliberately
//    indistinguishable from a wrong password). It must never count a
//    downstream infrastructure failure such as a Firestore read error.
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
//    IMPORTANT for anything reading `profile.mfaEnabled` (e.g. the
//    doctor dashboard header badge): this flag only reflects what's
//    stored on the adminUsers doc — it is NOT proof that a real MFA
//    challenge ran at sign-in, because none does yet. Don't present it
//    to users as an active security guarantee until the MFA HOOK below
//    is wired up for real.
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
//
// 7. signIn() resolves role itself (in addition to the
//    onAuthStateChanged listener) so callers can redirect immediately
//    instead of waiting a tick for the listener to populate `profile`.
//    A uid ref (loadedProfileUidRef) lets the listener detect that
//    signIn() already did this and skip a redundant second Firestore
//    read for the same uid.
//
// 8. Audience separation. signIn() takes an `audience` option:
//      "patient" (public /signin)  -> only accepts accounts that have a
//                                     `users` doc with role "patient".
//      "staff"   (hidden route)    -> only accepts accounts that have an
//                                     `adminUsers` doc with role
//                                     "admin" or "doctor".
//    An account on the wrong page is signed straight back out and gets
//    the same generic "Invalid email or password." error as a wrong
//    password, so neither page reveals which kind of account exists.
//    While signIn() is running, signingInRef makes the
//    onAuthStateChanged listener ignore the new user, so a rejected
//    account never becomes "signed in" in React state (which would let
//    PublicOnlyRoute bounce it to a dashboard for a moment).
//
//    NOTE: this is a UI-level separation. Firebase Auth is a single
//    user pool, so it does not stop someone calling Firebase's sign-in
//    endpoint directly. Real brute-force protection needs server-side
//    controls (Identity Platform lockout, App Check).

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

// Roles allowed to sign in through the staff page.
const STAFF_ROLES = ["admin", "doctor"];

// Client-side login throttle (UX layer only — see note 3 above).
const MAX_ATTEMPTS_BEFORE_COOLDOWN = 5;
const COOLDOWN_MS = 30_000;
const attemptStore = new Map(); // email -> { count, cooldownUntil }

function recordFailure(key) {
  const count = (attemptStore.get(key)?.count || 0) + 1;
  attemptStore.set(key, {
    count,
    cooldownUntil:
      count >= MAX_ATTEMPTS_BEFORE_COOLDOWN
        ? Date.now() + COOLDOWN_MS
        : undefined,
  });
}

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

// Default profile used by the onAuthStateChanged listener (page load /
// token refresh) when a role can't be determined. signIn() does NOT use
// this — it fails closed instead, so a Firestore hiccup can never let a
// staff account through the patient page.
function fallbackProfile(fbUser) {
  return { role: "patient", name: fbUser.displayName || "Patient" };
}

export function AuthProvider({ children }) {
  const [firebaseUser, setFirebaseUser] = useState(null);
  const [profile, setProfile] = useState(null); // { role, name, department?, mfaEnabled?, emailVerified }
  const [emailVerifiedFlag, setEmailVerifiedFlag] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const idleTimer = useRef(null);
  // Tracks the uid whose profile is currently loaded into `profile`, so
  // signIn() can populate profile/idle-timer itself and the
  // onAuthStateChanged listener below can skip re-fetching the same
  // doc a moment later. Reset to null on sign-out.
  const loadedProfileUidRef = useRef(null);
  // True while signIn() is running. The listener ignores signed-in
  // users during this window; signIn() decides whether the account is
  // allowed on this page and sets user/profile itself.
  const signingInRef = useRef(false);

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

  // Resolve role from Firestore. Reads are allowed by Security Rules
  // only for the signed-in user's own uid — see 6.1 in the architecture doc.
  //
  //   audience "staff"   -> adminUsers only; null if no doc there
  //   audience "patient" -> users only; null if no doc there
  //   audience undefined -> adminUsers first, then users, then a
  //                         fallback profile (page refresh / listener)
  const loadProfile = useCallback(async (fbUser, audience) => {
    if (audience !== "patient") {
      const adminSnap = await getDoc(doc(db, "adminUsers", fbUser.uid));
      if (adminSnap.exists()) {
        const data = adminSnap.data();
        return {
          uid: fbUser.uid,
          role: data.role || "admin",
          mfaEnabled: !!data.mfaEnabled,
          name: data.name || fbUser.displayName || "Staff",
          // Doctor accounts live in adminUsers too (role: "doctor"),
          // and the doctor dashboard header needs this. null rather
          // than "" so the UI can tell "not set yet" from empty.
          department: data.department || null,
        };
      }
      if (audience === "staff") return null;
    }

    const patientSnap = await getDoc(doc(db, "users", fbUser.uid));
    if (patientSnap.exists()) {
      const data = patientSnap.data();
      return {
        uid: fbUser.uid,
        role: "patient",
        name: data.name || fbUser.displayName || "Patient",
        phone: data.phone,
      };
    }
    if (audience === "patient") return null;
    return { uid: fbUser.uid, ...fallbackProfile(fbUser) };
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
      if (!fbUser) {
        setFirebaseUser(null);
        setEmailVerifiedFlag(false);
        setProfile(null);
        loadedProfileUidRef.current = null;
        clearIdleTimer();
        setInitializing(false);
        return;
      }

      // signIn() is mid-flight: it will verify the account belongs on
      // this login page and then set user/profile itself. Don't expose
      // a not-yet-vetted user to the rest of the app.
      if (signingInRef.current) return;

      setFirebaseUser(fbUser);
      setEmailVerifiedFlag(fbUser.emailVerified ?? false);

      // signIn() already loaded and set this exact user's profile —
      // skip the redundant Firestore read. This branch still runs on
      // page load / token refresh / other tabs, where the ref won't
      // match and a real fetch happens.
      if (loadedProfileUidRef.current === fbUser.uid) {
        setInitializing(false);
        return;
      }
      try {
        const p = await loadProfile(fbUser);
        loadedProfileUidRef.current = fbUser.uid;
        setProfile(p);
        scheduleIdleLogout(p.role);
      } catch {
        setProfile(fallbackProfile(fbUser));
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
        role: "patient", // Users.jsx filters strictly on this
        status: "active", // Users.jsx's status pill checks === "active"
        emailVerified: false,
        createdAt: serverTimestamp(),
      });
      await sendEmailVerification(cred.user);
      return cred.user;
    },
    [],
  );

  const signIn = useCallback(
    async (
      email,
      password,
      { rememberMe = false, audience = "patient" } = {},
    ) => {
      const key = email.trim().toLowerCase();
      const attempt = attemptStore.get(key);
      if (attempt?.cooldownUntil && Date.now() < attempt.cooldownUntil) {
        const waitSec = Math.ceil((attempt.cooldownUntil - Date.now()) / 1000);
        throw new Error(`Too many attempts. Try again in ${waitSec}s.`);
      }

      signingInRef.current = true;
      try {
        // --- Step 1: actual authentication. Failures from THIS step
        // count against the login throttle. ---
        let cred;
        try {
          // Staff should never silently persist a session on a shared
          // machine; only honor "remember me" for patients on their own device.
          await setPersistence(
            auth,
            audience === "staff" || !rememberMe
              ? browserSessionPersistence
              : browserLocalPersistence,
          );
          cred = await signInWithEmailAndPassword(auth, email.trim(), password);
          attemptStore.delete(key);
        } catch (err) {
          recordFailure(key);
          throw new Error(mapAuthError(err), { cause: err });
        }

        // MFA HOOK: if this account has mfaEnabled and Firebase throws
        // 'auth/multi-factor-auth-required', it's caught in the block
        // above (before this point is reached) — handle the resolver
        // there instead once MFA is turned back on.

        // --- Step 2: profile lookup, restricted to the collection that
        // belongs to this login page. ---
        let p = null;
        let lookupFailed = false;
        try {
          p = await loadProfile(cred.user, audience);
        } catch {
          lookupFailed = true;
        }

        const allowed =
          audience === "staff"
            ? STAFF_ROLES.includes(p?.role)
            : p?.role === "patient";

        if (!allowed) {
          // Wrong page for this account (or no profile / lookup failed):
          // sign straight back out. Fail closed.
          await signOut(auth).catch(() => {});

          if (lookupFailed) {
            // Infrastructure error, not a bad-credentials attempt: don't
            // count it against the throttle.
            throw new Error(
              mapAuthError({ code: "auth/network-request-failed" }),
            );
          }

          recordFailure(key);
          // Identical to the wrong-password message on purpose.
          throw new Error("Invalid email or password.");
        }

        // Account is allowed here — now expose it to the rest of the app.
        setFirebaseUser(cred.user);
        setEmailVerifiedFlag(cred.user.emailVerified ?? false);
        loadedProfileUidRef.current = cred.user.uid;
        setProfile(p);
        scheduleIdleLogout(p.role);

        return { user: cred.user, role: p.role };
      } finally {
        signingInRef.current = false;
      }
    },
    [loadProfile, scheduleIdleLogout],
  );

  const signOutUser = useCallback(async () => {
    clearIdleTimer();
    try {
      await signOut(auth);
    } catch (err) {
      // Signing out is a "make it so" action from the user's perspective —
      // a rare network blip here shouldn't leave them stuck on a button
      // that appears to do nothing. Firebase's local auth state is cleared
      // regardless; a lingering session on the server side isn't something
      // the user can act on from this button anyway.
      console.error("signOutUser failed:", err);
    }
  }, [clearIdleTimer]);

  const resetPassword = useCallback(async (email) => {
    try {
      await sendPasswordResetEmail(auth, email.trim());
    } catch (err) {
      // Swallow "user not found" so this can't be used to check which
      // emails are registered — always report success to the caller.
      // in resetPassword:
      if (err?.code !== "auth/user-not-found")
        throw new Error(mapAuthError(err), { cause: err });
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
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
