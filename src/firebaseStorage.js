// firebaseStorage.js
//
// Cloud Storage, kept out of src/firebase.js so the Storage SDK only
// downloads with the pages that upload files (control panel images, doctor
// photos, call recordings), not with the home page. Import `storage` from
// here; never call getStorage() anywhere else.

import { getStorage } from "firebase/storage";
import { app } from "./firebase";

export const storage = getStorage(app);
