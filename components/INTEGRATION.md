# Control Panel — integration guide

This adds one admin sidebar tab, **Control Panel**, where an admin can:
1. change the home page hero photo
2. set the two consultation prices
3. manage the BrandAside slideshow photos (add / remove / reorder)
4. change the sign-in / sign-up photo

New files (drop in as-is):
- `admin/controlPanel.jsx` + `admin/controlPanel.css` — the tab itself
- `src/siteSettings.js` — shared client module every page reads settings from
- `functions/siteSettings.js` — the two admin-only callables that do the writing
- `src/brandAside.jsx` — your existing `BrandAside.jsx`, patched to read the
  slideshow from settings (drop-in replacement)

Patched in place: `admin/sidebar.jsx`, `admin/admin.jsx` (full files above —
just the Control Panel nav item / tab / import added, nothing else changed).

Below are the small, surgical patches for the three files that were **not**
rewritten in full here (they're long, and only a few lines change).

---

## 1. `functions/index.js`

Add near the top, after `admin.initializeApp();`:

```js
require("./siteSettings"); // registers updateConsultationPrices, updateSiteImages
const { loadPrices } = require("./siteSettings");
```

Then in `createBookingDraft`, replace the fixed fee lookup with the live one,
so a price the admin sets in the Control Panel is what patients are actually
charged:

```diff
- const amount = CONSULTATION_FEES[d.type];
+ const prices = await loadPrices();
+ const amount = prices[d.type];
```

`CONSULTATION_FEES` can stay as the emergency fallback inside
`functions/siteSettings.js` (`DEFAULT_FEES`) — nothing else in `index.js`
needs to change. `paymentIsAcceptable` already compares against
`booking.amount`, which is now the live price captured at draft time, so
in-flight payments are unaffected by a later price change.

## 2. `bookConsultation.jsx` (patient booking flow)

Swap the hard-coded fee table for the live one, and fall back gracefully
while it loads:

```diff
+ import { useSiteSettings } from "../../src/siteSettings";
+
- const CONSULTATION_FEES = {
-   OPD: 250,
-   SURGICAL: 300,
- };
+ // Fallback shown for an instant before live prices arrive. Keep in step
+ // with DEFAULT_FEES in functions/siteSettings.js.
+ const CONSULTATION_FEES = { OPD: 250, SURGICAL: 300 };
```

Inside `export default function BookConsultation() {`, near the top:

```diff
+ const { settings } = useSiteSettings();
+ const prices = settings.prices; // { OPD, SURGICAL } — live, admin-editable
```

Then everywhere the component reads `CONSULTATION_FEES[...]` for **display**
(the two option cards in step 0, and `fee = booking?.amount ?? CONSULTATION_FEES[type]`),
swap in `prices[...]`:

```diff
- {CURRENCY} {CONSULTATION_FEES[opt.key]}
+ {CURRENCY} {prices[opt.key]}
```

```diff
- const fee = booking?.amount ?? CONSULTATION_FEES[type];
+ const fee = booking?.amount ?? prices[type];
```

The actual charge always comes from `booking.amount`, which the server set
from `loadPrices()` — these are display-only, but keeping them in sync with
the server avoids showing GHS 250 on step 0 and then charging GHS 275 on step 1.

## 3. `Home.jsx` (public landing page)

Swap the bundled hero import for the live one, with the bundled photo kept
as the fallback:

```diff
- import heroImage from "../../src/assets/hero-consult.jpg";
+ import heroDefault from "../../src/assets/hero-consult.jpg";
+ import { useSiteSettings } from "../../src/siteSettings";
```

Inside `export default function Home() {`, near the top:

```diff
+ const { settings } = useSiteSettings();
+ const heroImage = settings.heroImage ?? heroDefault;
```

Nothing else in `Home.jsx` needs to change — the `<img src={heroImage} .../>`
in the hero section already just uses this variable.

## 4. `signIn.jsx` / `signUp.jsx` (via `AuthAside`)

`AuthAside.jsx` wasn't in what you shared, so I can't patch it blind — but
the change is the same shape as `BrandAside` above (its sibling component).
Wherever `AuthAside.jsx` currently imports its background photo (likely the
same `auth-bg.jpg` `BrandAside` used to default to), do:

```diff
- import authBgPhoto from "../../src/assets/auth-bg.jpg";
+ import authDefault from "../../src/assets/auth-bg.jpg";
+ import { useSiteSettings } from "../../src/siteSettings";
```

and inside the component:

```diff
+ const { settings } = useSiteSettings();
+ const bgPhoto = settings.authImage ?? authDefault;
```

then use `bgPhoto` wherever it currently uses `authBgPhoto` as the
background image. `signIn.jsx` and `signUp.jsx` themselves need no changes —
they don't touch the image directly, `AuthAside` does.

---

## 5. Firestore rules (`firestore.rules`)

Add a rule for the new collection: readable by anyone (it's public site
content), writable only by the two Cloud Functions above (which use the
Admin SDK and bypass rules — so this is effectively "no direct client
writes, ever"):

```
match /siteSettings/{docId} {
  allow read: if true;
  allow write: if false;
}
```

## 6. Storage rules (`storage.rules`)

Admins upload photos straight from the browser to
`siteAssets/{hero,auth,slider}/...`; `updateSiteImages` re-checks each file
server-side before it's ever shown publicly (real image, under 5 MB, correct
path), so a rejected admin write here can't reach the public site — but the
rule still stops anyone else from uploading in the first place. Everyone can
*read* these files, since they're shown on the public site:

```
match /siteAssets/{folder}/{fileName} {
  allow read: if true;
  allow write: if request.auth != null
               && exists(/databases/$(database)/documents/adminUsers/$(request.auth.uid))
               && get(/databases/$(database)/documents/adminUsers/$(request.auth.uid)).data.role == "admin"
               && request.resource.size < 5 * 1024 * 1024
               && request.resource.contentType.matches("image/.*");
}
```

(Adjust the `role == "admin"` check if your `adminUsers` documents use a
different field or value — keep it in step with `ADMIN_ROLE` in
`functions/siteSettings.js`.)

---

## Notes on the design choices

- **Images never trust the browser.** The client only ever sends a Storage
  *path*; `updateSiteImages` looks the file up in the bucket itself, checks
  it's really an image and under 5 MB, and builds the public URL server-side.
  A path for the wrong folder (e.g. claiming a `hero` upload as the `auth`
  photo) is rejected.
- **Every change is audited.** Both callables write an `auditLog` entry
  (`actorId`, `action`, `targetId`, `timestamp`) exactly like the rest of the
  admin console (architecture §5).
- **Orphaned files get cleaned up.** When a photo is replaced or a slide is
  removed, the old Storage file is deleted after the Firestore write commits.
- **A returning visitor sees the right photos immediately.** `siteSettings.js`
  caches the last-seen settings in `localStorage` (URLs only, nothing
  sensitive) so the very first paint already has the admin's photos, not the
  bundled ones, before the live Firestore listener catches up.
- **Prices are captured, not referenced, at booking time.** `booking.amount`
  is set once when the draft is created; a later price change never moves
  the goalposts on a payment already in flight — see the `paymentIsAcceptable`
  comment in `functions/index.js`.
