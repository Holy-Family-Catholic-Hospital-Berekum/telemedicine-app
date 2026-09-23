# Security rules needed for recordings

Nothing in `callRecording.js` restricts who can *read* a recording — the
`callRecordingEnabled` flag only decides whether one gets made. "Only
admin can access" has to be enforced by Firestore/Storage security
rules, checked against a real admin identity. Since the admin side
isn't built yet, here's the minimum needed for the rest of this to be
safe rather than just client-side theater.

## Prerequisite: an admin identity the rules can check

Pick one (both are enforceable in rules):

- **Custom claim** (recommended): set `admin: true` on a user's Firebase
  Auth token via the Admin SDK, e.g. from a Cloud Function you trigger
  manually or from whatever process creates admin accounts. Rules check
  `request.auth.token.admin == true`.
- **Firestore role lookup**: a `users/{uid}` doc with a `role: "admin"`
  field. Rules check it with a `get()` call. Simpler to manage without
  custom claims, costs an extra read per rule evaluation.

The examples below use the custom-claim approach.

## Firestore rules (`recordings` collection)

```
match /recordings/{recordingId} {
  // Doctors' clients create the metadata doc when a recording starts,
  // and update it (status, storagePath, sizeBytes) when it finishes
  // uploading — see callRecording.js. They should not be able to read
  // recordings back, including their own.
  allow create: if request.auth != null;
  allow update: if request.auth != null
    && resource.data.status == "recording";
  allow read: if request.auth.token.admin == true;
  allow delete: if request.auth.token.admin == true;
}
```

## Storage rules (`recordings/{consultationId}/{fileName}`)

```
match /recordings/{consultationId}/{fileName} {
  allow write: if request.auth != null;
  allow read: if request.auth.token.admin == true;
}
```

## `systemSettings/features` (the on/off flag)

```
match /systemSettings/features {
  allow read: if request.auth != null; // any signed-in client needs to check it
  allow write: if request.auth.token.admin == true; // only the (future) admin UI
}
```

Until that doc exists, `featureFlags.js` treats recording as **off** —
create it manually in the Firebase console to turn recording on:

```
systemSettings/features
  callRecordingEnabled: true
```

## Not covered here (flagging, not building)

- **Consent**: recording a patient without their knowledge is a real
  legal problem in most jurisdictions, independent of app-level
  disclosure. The REC badge in `VideoCallModal.jsx` tells them it's
  happening, but you likely also want an explicit consent step (a
  checkbox or a required acknowledgment) before the call starts, and a
  record of that consent — worth checking Ghana's data-protection
  requirements for health records specifically.
- **Admin UI**: viewing, downloading, and deleting recordings — the
  Firestore `recordings` docs + Storage paths above are the data model
  it would read from.
- **Storage cost/lifecycle**: "kept indefinitely" means Storage costs
  grow every call, unbounded. Worth deciding later whether that's
  literal or whether older recordings eventually move to
  cheaper/archival storage.
