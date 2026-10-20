// Everything the sign-in state (context/authContext.jsx) needs from
// Firebase, in one module that authContext loads on demand (loadAuthSdk)
// right after the page first appears. Firebase is a third of the first
// download on a phone, so the public pages show without waiting for it.

export {
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
export { doc, getDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { functions } from "./firebase";
export { auth, db, functions } from "./firebase";

export const callRegisterPatient = httpsCallable(functions, "registerPatient");
export const callNoteSignIn = httpsCallable(functions, "noteSignIn");
export const callUpdatePatientProfile = httpsCallable(functions, "updatePatientProfile");
export const callSyncAccountEmail = httpsCallable(functions, "syncAccountEmail");
export const callUpdateStaffProfile = httpsCallable(functions, "updateStaffProfile");
export const callConfirmStaffSession = httpsCallable(functions, "confirmStaffSession");
export const callStaffActivity = httpsCallable(functions, "staffActivity");
