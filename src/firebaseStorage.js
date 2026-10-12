// firebaseStorage.js
//
// Cloud Storage, kept out of src/firebase.js so the Storage SDK only
// downloads with the pages that upload files (control panel images, doctor
// photos, call recordings), not with the home page. Import `storage` from
// here; never call getStorage() anywhere else.

import { getStorage, connectStorageEmulator } from "firebase/storage";
import { app, USE_EMULATORS } from "./firebase";

export const storage = getStorage(app);
// End-to-end tests only (see src/firebase.js).
if (USE_EMULATORS) connectStorageEmulator(storage, "127.0.0.1", 9199);
