import SignIn from "./signIn";
import { useStaffAppManifest } from "../../staffApp.js";

export default function StaffSignIn() {
  // Installing from a staff page gives the staff app (opens on staff sign-in).
  useStaffAppManifest();
  return <SignIn audience="staff" />;
}
