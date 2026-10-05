// authContext.jsx
//
// Single source of truth for auth state across the app. Wrap your app
// in <AuthProvider> once (e.g. in main.jsx / index.jsx), then read
// { user, role, emailVerified, initializing, ... } via useAuth() anywhere.
//
// Security decisions made here, and why:
//
// 1. Role comes from the signed `role` custom claim in the ID token,
//    which only Cloud Functions set (registerPatient, createDoctorAccount,
//    the staffAdmin script). The matching profile document (`adminUsers`
//    for staff, `users` for patients) supplies display data and must be
//    `active`. No claim, or an inactive profile, means no role at all:
//    the app never defaults anyone to "patient". Firestore Security Rules
//    and Cloud Functions read the same claim and are the real
//    enforcement; `role` here is UI routing only.
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
// 4. Idle timeout: staff (admin, doctor) after 30 minutes without
//    activity, patients after 60. A video call holds the session open
//    (holdSession) so nobody is signed out mid-consultation for not
//    touching the mouse.
//
// 5. Staff second factor (functions/staffAuth.js, enforced by
//    functions/lib/core.js requireRole and the Security Rules): admins and
//    doctors use an authenticator app (TOTP).
//    - With one enrolled, the password step throws
//      auth/multi-factor-auth-required; signIn() returns
//      { step: "totp", resolver } and completeTotpSignIn() finishes it.
//    - Without one, signIn() returns { step: "totp_enroll" }: set one up
//      (startTotpEnrollment / finishTotpEnrollment), then sign in with it.
//    - The first sign-in with a new authenticator returns
//      { step: "setup_code" }: submitSetupCode() sends the one-time code
//      from IT / an admin, which pins that authenticator to the account.
//    Until the second step is done the account is held back
//    (pendingStaffRef): no user, no profile, no role in the app. On page
//    reload a staff session that isn't confirmed is signed out.
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
//    (Checked against the role claim, then the profile document.)
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
  EmailAuthProvider,
  reauthenticateWithCredential,
  verifyBeforeUpdateEmail,
  getMultiFactorResolver,
  multiFactor,
  TotpMultiFactorGenerator,
} from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { auth, db, functions } from "../firebase";
import { CURRENT_AGE_DECLARATION } from "../consentText.js";

const callRegisterPatient = httpsCallable(functions, "registerPatient");
const callUpdatePatientProfile = httpsCallable(functions, "updatePatientProfile");
const callSyncAccountEmail = httpsCallable(functions, "syncAccountEmail");
const callUpdateStaffProfile = httpsCallable(functions, "updateStaffProfile");
const callConfirmStaffSession = httpsCallable(functions, "confirmStaffSession");

const AuthContext = createContext(null);

// Idle-timeout windows, in minutes. Staff sessions are tighter since
// they can see patient bookings and payment data.
// Hospital decision: one hour of inactivity signs out every role.
const IDLE_TIMEOUT_MINUTES = { admin: 30, doctor: 30, patient: 60 };

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
    case "auth/user-disabled":
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
      return "Additional verification is required for this account.";
    case "auth/invalid-verification-code":
      return "That code isn't right. Check your authenticator app and try again.";
    default:
      return "Something went wrong. Please try again.";
  }
}

/** The `role` claim, refreshing the token once if it isn't there yet. */
async function roleClaim(fbUser) {
  let result = await fbUser.getIdTokenResult();
  if (!result.claims.role) {
    // A just-registered account gets its claim moments after creation.
    result = await fbUser.getIdTokenResult(true);
  }
  return typeof result.claims.role === "string" ? result.claims.role : null;
}

export function AuthProvider({ children }) {
  const [firebaseUser, setFirebaseUser] = useState(null);
  const [profile, setProfile] = useState(null); // { uid, role, name, department?, phone? }
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
  // A staff account that passed the password step but not yet its second
  // factor: { uid, profile }. Kept out of React state until it does.
  const pendingStaffRef = useRef(null);
  // Open video calls holding the session (see holdSession).
  const sessionHoldsRef = useRef(0);

  const clearIdleTimer = useCallback(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
  }, []);

  const scheduleIdleLogout = useCallback(
    (role) => {
      clearIdleTimer();
      const minutes = IDLE_TIMEOUT_MINUTES[role] ?? 60;
      const fire = () => {
        // In a call: check again later instead of signing out.
        if (sessionHoldsRef.current > 0) {
          idleTimer.current = setTimeout(fire, minutes * 60 * 1000);
          return;
        }
        signOut(auth).catch(() => {});
      };
      idleTimer.current = setTimeout(fire, minutes * 60 * 1000);
    },
    [clearIdleTimer],
  );

  // Role from the signed claim; display data from the matching profile,
  // which Security Rules let each user read for their own uid only.
  // Returns null (no access) when there's no claim, the claim doesn't
  // suit this login page, or the profile is missing or not active.
  //
  //   audience "staff"   -> admin or doctor only
  //   audience "patient" -> patient only
  //   audience undefined -> any role (page refresh / listener)
  const loadProfile = useCallback(async (fbUser, audience) => {
    const role = await roleClaim(fbUser);
    if (!role) return null;
    const isStaff = STAFF_ROLES.includes(role);
    if (audience === "staff" && !isStaff) return null;
    if (audience === "patient" && role !== "patient") return null;
    if (!isStaff && role !== "patient") return null;

    const snap = await getDoc(
      doc(db, isStaff ? "adminUsers" : "users", fbUser.uid),
    );
    if (!snap.exists() || snap.data().status !== "active") return null;
    const data = snap.data();
    return isStaff
      ? {
          uid: fbUser.uid,
          role,
          name: data.name || fbUser.displayName || "Staff",
          // null rather than "" so the UI can tell "not set" from empty.
          department: data.department || null,
          email: data.email || null,
        }
      : {
          uid: fbUser.uid,
          role,
          name: data.name || fbUser.displayName || "Patient",
          phone: data.phone,
          email: data.email || null,
        };
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
      if (pendingStaffRef.current?.uid === fbUser.uid) return;

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
        if (!p) {
          // No role, or the account was deactivated: fail closed.
          await signOut(auth).catch(() => {});
          return;
        }
        if (STAFF_ROLES.includes(p.role)) {
          // Page reload: only a session that already passed its second
          // factor carries on. Never send a new code from here.
          const { data } = await callConfirmStaffSession({});
          if (data?.status !== "ok") {
            await signOut(auth).catch(() => {});
            return;
          }
        }
        loadedProfileUidRef.current = fbUser.uid;
        setProfile(p);
        scheduleIdleLogout(p.role);
      } catch {
        // Couldn't reach Firebase. Stay signed in but with no role, so
        // protected pages refuse until a reload succeeds.
        setProfile(null);
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

  // Creates the Auth account, then registerPatient writes the profile, the
  // consent record and the role claim on the server. If that fails, the
  // half-made Auth account is deleted so the email can be used again.
  const signUpPatient = useCallback(
    async ({ name, phone, email, password, acceptedTerms, confirmedAdult }) => {
      signingInRef.current = true;
      try {
        let cred;
        try {
          cred = await createUserWithEmailAndPassword(
            auth,
            email.trim(),
            password,
          );
        } catch (err) {
          throw new Error(mapAuthError(err), { cause: err });
        }
        try {
          await updateProfile(cred.user, { displayName: name.trim() });
          await callRegisterPatient({
            name: name.trim(),
            phone: phone.trim(),
            acceptedTerms: acceptedTerms === true,
            // Only sent when the box was ticked; the server stores the
            // declaration against this version of the wording.
            ...(confirmedAdult === true
              ? { ageDeclarationVersion: CURRENT_AGE_DECLARATION }
              : {}),
          });
        } catch (err) {
          await cred.user.delete().catch(() => signOut(auth).catch(() => {}));
          throw new Error(
            err?.code?.startsWith("functions/") && err.message
              ? err.message
              : "We couldn't create your account. Please try again.",
            { cause: err },
          );
        }
        await sendEmailVerification(cred.user);

        const p = await loadProfile(cred.user, "patient");
        if (!p) {
          await signOut(auth).catch(() => {});
          throw new Error("We couldn't finish setting up your account. Please sign in.");
        }
        setFirebaseUser(cred.user);
        setEmailVerifiedFlag(cred.user.emailVerified ?? false);
        loadedProfileUidRef.current = cred.user.uid;
        setProfile(p);
        scheduleIdleLogout(p.role);
        return cred.user;
      } finally {
        signingInRef.current = false;
      }
    },
    [loadProfile, scheduleIdleLogout],
  );

  // Makes a fully signed-in account visible to the rest of the app.
  const exposeSession = useCallback(
    (fbUser, p) => {
      setFirebaseUser(fbUser);
      setEmailVerifiedFlag(fbUser.emailVerified ?? false);
      loadedProfileUidRef.current = fbUser.uid;
      setProfile(p);
      scheduleIdleLogout(p.role);
    },
    [scheduleIdleLogout],
  );

  // Asks the server what this staff sign-in still needs. Holds the account
  // back until it's done.
  const staffSecondStep = useCallback(
    async (fbUser, p) => {
      let status;
      try {
        const { data } = await callConfirmStaffSession({});
        status = data?.status;
      } catch (err) {
        await signOut(auth).catch(() => {});
        throw new Error(
          err?.code?.startsWith("functions/") && err.message
            ? err.message
            : "We couldn't finish signing you in. Please try again.",
          { cause: err },
        );
      }
      if (status === "ok") {
        pendingStaffRef.current = null;
        exposeSession(fbUser, p);
        return { user: fbUser, role: p.role };
      }
      if (status === "totp_enroll" || status === "setup_code") {
        pendingStaffRef.current = { uid: fbUser.uid, profile: p };
        return { step: status };
      }
      await signOut(auth).catch(() => {});
      throw new Error(
        status === "setup_expired"
          ? "Your authenticator setup code has expired or hasn't been issued. Ask IT (admins) or an admin (doctors) for a new one."
          : "Please sign in again and enter the code from your authenticator app.",
      );
    },
    [exposeSession],
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
          // Right password, and the account has an authenticator: ask for
          // its code. Only on the staff page; patients don't use MFA.
          if (err?.code === "auth/multi-factor-auth-required" && audience === "staff") {
            const resolver = getMultiFactorResolver(auth, err);
            const hint = resolver.hints.find(
              (h) => h.factorId === TotpMultiFactorGenerator.FACTOR_ID,
            );
            if (hint) {
              attemptStore.delete(key);
              return { step: "totp", resolver, hintUid: hint.uid };
            }
          }
          recordFailure(key);
          throw new Error(mapAuthError(err), { cause: err });
        }

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

        if (audience === "staff") return await staffSecondStep(cred.user, p);

        exposeSession(cred.user, p);
        return { user: cred.user, role: p.role };
      } finally {
        signingInRef.current = false;
      }
    },
    [loadProfile, exposeSession, staffSecondStep],
  );

  // ---- Staff second factor ----

  // Admin: the 6-digit code from the authenticator app.
  const completeTotpSignIn = useCallback(
    async ({ resolver, hintUid, code }) => {
      signingInRef.current = true;
      try {
        let cred;
        try {
          cred = await resolver.resolveSignIn(
            TotpMultiFactorGenerator.assertionForSignIn(hintUid, code.trim()),
          );
        } catch (err) {
          throw new Error(mapAuthError(err), { cause: err });
        }
        const p = await loadProfile(cred.user, "staff").catch(() => null);
        if (!p) {
          await signOut(auth).catch(() => {});
          throw new Error("Invalid email or password.");
        }
        return await staffSecondStep(cred.user, p);
      } finally {
        signingInRef.current = false;
      }
    },
    [loadProfile, staffSecondStep],
  );

  // Admin without an authenticator: make one. Returns what the setup
  // screen shows (QR code URL and the key to type in by hand).
  const startTotpEnrollment = useCallback(async () => {
    const u = auth.currentUser;
    if (!u || pendingStaffRef.current?.uid !== u.uid) {
      throw new Error("Please sign in again.");
    }
    try {
      const session = await multiFactor(u).getSession();
      const secret = await TotpMultiFactorGenerator.generateSecret(session);
      return {
        secret,
        qrUrl: secret.generateQrCodeUrl(u.email, "Holy Family Telemedicine"),
        key: secret.secretKey,
      };
    } catch (err) {
      const code = err?.code || "";
      throw new Error(
        code === "auth/unverified-email"
          ? "This account's email isn't verified. Ask IT to run the make-admin command again."
          : code === "auth/operation-not-allowed"
            ? "Authenticator sign-in isn't switched on for this project yet. Ask IT to run enable-totp."
            : "We couldn't start the setup. Please sign in again and retry.",
        { cause: err },
      );
    }
  }, []);

  // Confirms the first code from the new authenticator, then signs out:
  // the admin signs in again using it.
  const finishTotpEnrollment = useCallback(async ({ secret, code }) => {
    const u = auth.currentUser;
    if (!u) throw new Error("Please sign in again.");
    try {
      const assertion = TotpMultiFactorGenerator.assertionForEnrollment(secret, code.trim());
      await multiFactor(u).enroll(assertion, "Authenticator app");
    } catch (err) {
      throw new Error(mapAuthError(err), { cause: err });
    }
    pendingStaffRef.current = null;
    await signOut(auth).catch(() => {});
  }, []);

  // First sign-in with a new authenticator: the one-time setup code from
  // IT (admins) or an admin (doctors) pins it to the account.
  const submitSetupCode = useCallback(
    async (setupCode) => {
      const pending = pendingStaffRef.current;
      const u = auth.currentUser;
      if (!pending || !u || u.uid !== pending.uid) throw new Error("Please sign in again.");
      let data;
      try {
        ({ data } = await callConfirmStaffSession({ setupCode: setupCode.trim() }));
      } catch (err) {
        throw new Error(
          err?.code?.startsWith("functions/") && err.message
            ? err.message
            : "We couldn't check the setup code. Please try again.",
          { cause: err },
        );
      }
      if (data?.status !== "ok") {
        pendingStaffRef.current = null;
        await signOut(auth).catch(() => {});
        throw new Error(
          "Your setup code has expired. Ask IT (admins) or an admin (doctors) for a new one, then sign in again.",
        );
      }
      pendingStaffRef.current = null;
      exposeSession(u, pending.profile);
      return { user: u, role: pending.profile.role };
    },
    [exposeSession],
  );

  // Keeps the session open while a video call is on screen; returns the
  // release function.
  const holdSession = useCallback(() => {
    sessionHoldsRef.current += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      sessionHoldsRef.current = Math.max(0, sessionHoldsRef.current - 1);
    };
  }, []);

  // Back out of a half-finished staff sign-in.
  const cancelStaffSignIn = useCallback(async () => {
    pendingStaffRef.current = null;
    await signOut(auth).catch(() => {});
  }, []);

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
    // Rules and functions read email_verified from the ID token, so mint a
    // fresh one now rather than waiting up to an hour for the next refresh.
    if (verified) await auth.currentUser.getIdToken(true);
    setEmailVerifiedFlag(verified);
    // Keep firebaseUser in sync too, in case other consumers read
    // fields (displayName, etc.) directly off `user`.
    setFirebaseUser(auth.currentUser);
    return verified;
  }, []);

  // ---- Patient settings (dashboard Settings tab) ----

  const updatePatientName = useCallback(async (name) => {
    const { data } = await callUpdatePatientProfile({ name: name.trim() });
    setProfile((p) => (p ? { ...p, name: data.name } : p));
    return data.name;
  }, []);

  // Staff: name (and a doctor's department). Returns the saved values.
  const updateStaffProfile = useCallback(async ({ name, department }) => {
    const { data } = await callUpdateStaffProfile({
      name: name.trim(),
      ...(department !== undefined ? { department: department.trim() } : {}),
    });
    setProfile((p) =>
      p ? { ...p, name: data.name, ...(data.department ? { department: data.department } : {}) } : p,
    );
    return data;
  }, []);

  // Changing the sign-in email needs a fresh sign-in: the current password,
  // and for staff also their authenticator code. It only happens once the
  // user clicks the link Firebase sends to the NEW address; the old
  // address gets a notice with a way to undo it.
  const requestEmailChange = useCallback(async ({ newEmail, password, totpCode }) => {
    const u = auth.currentUser;
    if (!u?.email) throw new Error("Please sign in again and retry.");
    try {
      await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email, password));
    } catch (err) {
      const code = err?.code || "";
      if (code === "auth/multi-factor-auth-required") {
        // Staff: finish the fresh sign-in with the authenticator code.
        const resolver = getMultiFactorResolver(auth, err);
        const hint = resolver.hints.find((h) => h.factorId === TotpMultiFactorGenerator.FACTOR_ID);
        if (!hint || !totpCode) {
          throw new Error("Enter the code from your authenticator app.", { cause: err });
        }
        try {
          await resolver.resolveSignIn(
            TotpMultiFactorGenerator.assertionForSignIn(hint.uid, totpCode.trim()),
          );
        } catch (mfaErr) {
          throw new Error(
            mfaErr?.code === "auth/invalid-verification-code"
              ? "That authenticator code isn't right. Try the current one."
              : "We couldn't confirm your authenticator code. Please try again.",
            { cause: mfaErr },
          );
        }
      } else {
        throw new Error(
          code === "auth/too-many-requests"
            ? "Too many attempts. Please wait a few minutes and try again."
            : "Your current password is incorrect.",
          { cause: err },
        );
      }
    }
    try {
      await verifyBeforeUpdateEmail(u, newEmail.trim(), {
        url: `${window.location.origin}/signin`,
      });
    } catch (err) {
      const code = err?.code || "";
      throw new Error(
        code === "auth/invalid-email"
          ? "Enter a valid email address."
          : code === "auth/too-many-requests"
            ? "Too many attempts. Please wait a few minutes and try again."
            : "We couldn't send the confirmation email. Check the address and try again.",
        { cause: err },
      );
    }
  }, []);

  // After a confirmed email change, copy the new address to the profile
  // (patients: also open bookings, where appointment emails are sent).
  useEffect(() => {
    const u = firebaseUser;
    if (!u || !profile?.role || !u.email || !u.emailVerified) return;
    if (u.email.toLowerCase() === (profile.email || "").toLowerCase()) return;
    let cancelled = false;
    callSyncAccountEmail()
      .then(({ data }) => {
        if (!cancelled && data?.email) setProfile((p) => (p ? { ...p, email: data.email } : p));
      })
      .catch(() => {}); // retried on the next sign-in or page load
    return () => {
      cancelled = true;
    };
  }, [firebaseUser, profile?.role, profile?.email]);

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
    updatePatientName,
    updateStaffProfile,
    requestEmailChange,
    completeTotpSignIn,
    startTotpEnrollment,
    finishTotpEnrollment,
    submitSetupCode,
    holdSession,
    cancelStaffSignIn,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
