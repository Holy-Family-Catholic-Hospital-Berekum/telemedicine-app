import { useEffect, useRef, useState } from "react";
import {
  Camera,
  Loader2,
  Plus,
  X,
  UserRound,
  BadgeCheck,
  Globe2,
} from "lucide-react";
import {
  fetchDoctorProfile,
  updateDoctorProfile,
  uploadDoctorProfilePicture,
} from "./docFirestoreService";
import {
  validateProfilePhoto,
  resizeProfilePhoto,
  MAX_PROFILE_PHOTO_MB,
} from "./docUtils";

const BIO_MAX_LENGTH = 400;

function TagEditor({ label, placeholder, values, onChange }) {
  const [draft, setDraft] = useState("");

  function commitDraft() {
    const cleaned = draft.trim();
    if (!cleaned) return;
    if (values.some((v) => v.toLowerCase() === cleaned.toLowerCase())) {
      setDraft("");
      return;
    }
    onChange([...values, cleaned]);
    setDraft("");
  }

  function handleKeyDown(event) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      commitDraft();
    }
  }

  function removeAt(index) {
    onChange(values.filter((_, i) => i !== index));
  }

  return (
    <div>
      <p className="text-sm font-medium text-[#12242C]">{label}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {values.map((value, index) => (
          <span
            key={value}
            className="flex items-center gap-1 rounded-sm bg-[#0095D90D] px-2 py-1 text-xs text-[#0095D9]"
          >
            {value}
            <button
              type="button"
              onClick={() => removeAt(index)}
              aria-label={`Remove ${value}`}
              className="text-[#0095D9]/70 hover:text-[#0095D9]"
            >
              <X size={11} strokeWidth={2.25} />
            </button>
          </span>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="flex-1 rounded-sm border border-[#DCE6EC] px-3 py-1.5 text-sm text-[#12242C] outline-none placeholder:text-[#5C6B72]/70 focus:border-[#0095D9]"
        />
        <button
          type="button"
          onClick={commitDraft}
          className="flex items-center gap-1 rounded-sm border border-[#DCE6EC] px-2.5 py-1.5 text-xs font-medium text-[#12242C] transition hover:border-[#0095D9]"
        >
          <Plus size={13} strokeWidth={2} />
          Add
        </button>
      </div>
    </div>
  );
}

export default function ProfileTab({ doctor, onToast }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [photoError, setPhotoError] = useState(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  const [saved, setSaved] = useState(null); // last persisted profile
  const [form, setForm] = useState(null); // working copy being edited
  const fileInputRef = useRef(null);

  useEffect(() => {
    let active = true;
    fetchDoctorProfile(doctor.uid).then((profile) => {
      if (!active) return;
      setSaved(profile);
      setForm(profile);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [doctor.uid]);

  const isDirty =
    form && saved && JSON.stringify(form) !== JSON.stringify(saved);

  function updateField(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handlePhotoChange(event) {
    const file = event.target.files?.[0];
    event.target.value = ""; // allow re-selecting the same file later
    if (!file) return;

    const validationError = validateProfilePhoto(file);
    if (validationError) {
      setPhotoError(validationError);
      return;
    }

    setPhotoError(null);
    setUploadingPhoto(true);
    try {
      const resized = await resizeProfilePhoto(file);
      const { photoURL } = await uploadDoctorProfilePicture(
        doctor.uid,
        resized,
      );
      const next = await updateDoctorProfile(doctor.uid, { photoURL });
      setSaved(next);
      setForm(next);
      onToast?.("Profile photo updated");
    } catch (err) {
      setPhotoError(err.message || "Could not update your photo. Try again.");
    } finally {
      setUploadingPhoto(false);
    }
  }

  async function handleRemovePhoto() {
    setUploadingPhoto(true);
    setPhotoError(null);
    try {
      const next = await updateDoctorProfile(doctor.uid, { photoURL: null });
      setSaved(next);
      setForm(next);
      onToast?.("Profile photo removed");
    } finally {
      setUploadingPhoto(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const next = await updateDoctorProfile(doctor.uid, {
        title: form.title,
        yearsExperience: form.yearsExperience,
        languages: form.languages,
        specialties: form.specialties,
        bio: form.bio,
      });
      setSaved(next);
      setForm(next);
      onToast?.("Profile saved");
    } finally {
      setSaving(false);
    }
  }

  function handleDiscard() {
    setForm(saved);
  }

  if (loading || !form) {
    return (
      <div className="rounded-md border border-dashed border-[#DCE6EC] bg-white p-8 text-center text-sm text-[#5C6B72]">
        Loading your profile…
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="space-y-6">
        {/* Photo */}
        <section className="rounded-md border border-[#DCE6EC] bg-white p-5">
          <h2 className="text-sm font-semibold text-[#12242C]">
            Profile photo
          </h2>
          <p className="mt-1 text-xs text-[#5C6B72]">
            Shown to patients in the "Meet your doctors" section of the booking
            site.
          </p>

          <div className="mt-4 flex items-center gap-4">
            <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-full bg-[#F5F8FA]">
              {form.photoURL ? (
                <img
                  src={form.photoURL}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-[#5C6B72]">
                  <UserRound size={30} strokeWidth={1.5} />
                </div>
              )}
              {uploadingPhoto && (
                <div className="absolute inset-0 flex items-center justify-center bg-[#12242C]/50">
                  <Loader2
                    size={18}
                    strokeWidth={2}
                    className="animate-spin text-white"
                  />
                </div>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={uploadingPhoto}
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-1.5 rounded-sm border border-[#DCE6EC] px-3 py-1.5 text-xs font-medium text-[#12242C] transition hover:border-[#0095D9] disabled:opacity-50"
                >
                  <Camera size={13} strokeWidth={1.75} />
                  {form.photoURL ? "Change photo" : "Upload photo"}
                </button>
                {form.photoURL && (
                  <button
                    type="button"
                    disabled={uploadingPhoto}
                    onClick={handleRemovePhoto}
                    className="rounded-sm px-3 py-1.5 text-xs font-medium text-[#5C6B72] transition hover:text-[#B23A3A] disabled:opacity-50"
                  >
                    Remove
                  </button>
                )}
              </div>
              <p className="text-[11px] text-[#5C6B72]">
                JPG, PNG, or WEBP, up to {MAX_PROFILE_PHOTO_MB}MB.
              </p>
              {photoError && (
                <p className="text-[11px] text-[#B23A3A]">{photoError}</p>
              )}
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handlePhotoChange}
              className="hidden"
            />
          </div>
        </section>

        {/* Identity (read-only — set by the hospital, not the doctor) */}
        <section className="rounded-md border border-[#DCE6EC] bg-white p-5">
          <h2 className="text-sm font-semibold text-[#12242C]">Identity</h2>
          <p className="mt-1 text-xs text-[#5C6B72]">
            Set by the hospital when your account is created. Contact admin to
            change these.
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-xs text-[#5C6B72]">Name</p>
              <p className="mt-0.5 text-sm text-[#12242C]">{doctor.name}</p>
            </div>
            <div>
              <p className="text-xs text-[#5C6B72]">Department</p>
              <p className="mt-0.5 text-sm text-[#12242C]">
                {doctor.department}
              </p>
            </div>
          </div>
        </section>

        {/* Editable public profile */}
        <section className="rounded-md border border-[#DCE6EC] bg-white p-5">
          <h2 className="text-sm font-semibold text-[#12242C]">
            Public profile
          </h2>
          <p className="mt-1 text-xs text-[#5C6B72]">
            You control this content — it's what patients see before they book
            with you.
          </p>

          <div className="mt-4 space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label
                  className="text-sm font-medium text-[#12242C]"
                  htmlFor="profile-title"
                >
                  Title / qualifications
                </label>
                <input
                  id="profile-title"
                  type="text"
                  value={form.title}
                  onChange={(e) => updateField("title", e.target.value)}
                  placeholder="e.g. MBChB, FWACS"
                  className="mt-1.5 w-full rounded-sm border border-[#DCE6EC] px-3 py-2 text-sm text-[#12242C] outline-none focus:border-[#0095D9]"
                />
              </div>
              <div>
                <label
                  className="text-sm font-medium text-[#12242C]"
                  htmlFor="profile-years"
                >
                  Years of experience
                </label>
                <input
                  id="profile-years"
                  type="number"
                  min="0"
                  max="70"
                  value={form.yearsExperience}
                  onChange={(e) =>
                    updateField("yearsExperience", Number(e.target.value))
                  }
                  className="mt-1.5 w-full rounded-sm border border-[#DCE6EC] px-3 py-2 text-sm text-[#12242C] outline-none focus:border-[#0095D9]"
                />
              </div>
            </div>

            <TagEditor
              label="Specialties"
              placeholder="Add a specialty and press Enter"
              values={form.specialties}
              onChange={(v) => updateField("specialties", v)}
            />

            <TagEditor
              label="Languages spoken"
              placeholder="Add a language and press Enter"
              values={form.languages}
              onChange={(v) => updateField("languages", v)}
            />

            <div>
              <div className="flex items-center justify-between">
                <label
                  className="text-sm font-medium text-[#12242C]"
                  htmlFor="profile-bio"
                >
                  Short bio
                </label>
                <span className="text-xs text-[#5C6B72]">
                  {form.bio.length}/{BIO_MAX_LENGTH}
                </span>
              </div>
              <textarea
                id="profile-bio"
                rows={4}
                value={form.bio}
                maxLength={BIO_MAX_LENGTH}
                onChange={(e) => updateField("bio", e.target.value)}
                placeholder="A couple of sentences about your practice and approach to care."
                className="mt-1.5 w-full resize-none rounded-sm border border-[#DCE6EC] px-3 py-2 text-sm text-[#12242C] outline-none focus:border-[#0095D9]"
              />
            </div>
          </div>

          {isDirty && (
            <div className="mt-5 flex items-center justify-end gap-2 border-t border-[#DCE6EC] pt-4">
              <button
                type="button"
                onClick={handleDiscard}
                disabled={saving}
                className="rounded-sm border border-[#DCE6EC] px-3.5 py-2 text-sm font-medium text-[#12242C] transition hover:border-[#0095D9] disabled:opacity-50"
              >
                Discard changes
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 rounded-sm px-3.5 py-2 text-sm font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-70"
                style={{ backgroundColor: "#0095D9" }}
              >
                {saving && (
                  <Loader2 size={14} strokeWidth={2} className="animate-spin" />
                )}
                {saving ? "Saving…" : "Save changes"}
              </button>
            </div>
          )}
        </section>
      </div>

      {/* Live preview of the public landing-page card */}
      <aside className="h-fit rounded-md border border-[#DCE6EC] bg-white p-5">
        <p className="text-xs font-medium uppercase tracking-wide text-[#5C6B72]">
          Preview
        </p>
        <p className="mt-1 text-xs text-[#5C6B72]">
          How this looks in "Meet your doctors" on the booking site.
        </p>

        <div className="mt-4 rounded-md border border-[#DCE6EC] p-4">
          <div className="flex items-center gap-3">
            <div className="h-14 w-14 shrink-0 overflow-hidden rounded-full bg-[#F5F8FA]">
              {form.photoURL ? (
                <img
                  src={form.photoURL}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-[#5C6B72]">
                  <UserRound size={22} strokeWidth={1.5} />
                </div>
              )}
            </div>
            <div>
              <p className="text-sm font-semibold text-[#12242C]">
                {doctor.name}
              </p>
              <p className="text-xs text-[#5C6B72]">{doctor.department}</p>
            </div>
          </div>

          {form.title && (
            <p className="mt-3 flex items-center gap-1.5 text-xs text-[#5C6B72]">
              <BadgeCheck
                size={13}
                strokeWidth={1.75}
                style={{ color: "#0095D9" }}
              />
              {form.title}
              {form.yearsExperience
                ? ` · ${form.yearsExperience} yrs experience`
                : ""}
            </p>
          )}

          {form.bio && (
            <p className="mt-2 text-xs leading-relaxed text-[#12242C]">
              {form.bio}
            </p>
          )}

          {form.specialties.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1">
              {form.specialties.map((s) => (
                <span
                  key={s}
                  className="rounded-sm bg-[#0095D90D] px-1.5 py-0.5 text-[10px] text-[#0095D9]"
                >
                  {s}
                </span>
              ))}
            </div>
          )}

          {form.languages.length > 0 && (
            <p className="mt-3 flex items-center gap-1.5 text-[11px] text-[#5C6B72]">
              <Globe2 size={12} strokeWidth={1.75} />
              {form.languages.join(", ")}
            </p>
          )}
        </div>
      </aside>
    </div>
  );
}
