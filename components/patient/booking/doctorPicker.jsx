import { DoctorAvatar } from "./bookingUi";

// Optional; the admin can switch doctor choice off. Closed by default:
// the list only renders once the patient opens it.
export default function DoctorPicker({
  doctorPickerOpen,
  setDoctorPickerOpen,
  selectedDoctor,
  setSelectedDoctorId,
  slotLocked,
  doctorSearch,
  setDoctorSearch,
  filteredDoctors,
}) {
  return (
    <fieldset className="mt-8">
      <legend className="text-[16px] font-medium mb-3">
        Doctor
      </legend>

      {!doctorPickerOpen && (
        <div className="rounded-2xl border-2 border-[#0095D9] p-5 flex items-center justify-between gap-4 flex-wrap">
          {selectedDoctor ? (
            <div className="flex items-center gap-3">
              <DoctorAvatar doctor={selectedDoctor} />
              <div>
                <p className="font-medium text-[16px]">
                  {selectedDoctor.name}
                </p>
                <p className="text-[15px] text-black/75">
                  {selectedDoctor.role}
                </p>
              </div>
            </div>
          ) : (
            <p className="text-[16px] text-black/70 max-w-sm">
              The hospital will choose a doctor for you. Or you can
              choose one yourself.
            </p>
          )}
          {slotLocked ? (
            <p className="text-[15px] text-black/75 max-w-xs">
              This appointment time is with this doctor. To see a
              different doctor, go back and choose another time.
            </p>
          ) : (
          <div className="flex items-center gap-4">
            {selectedDoctor && (
              <button
                type="button"
                onClick={() => setSelectedDoctorId(null)}
                className="text-[15px] font-medium text-black/70 hover:text-black/70"
              >
                Remove
              </button>
            )}
            <button
              type="button"
              onClick={() => setDoctorPickerOpen(true)}
              className="text-[16px] bg-[#F88535] cursor-pointer p-2 rounded-full font-medium text-white hover:underline"
            >
              {selectedDoctor
                ? "Change doctor"
                                              : "Choose a doctor"}
            </button>
          </div>
          )}
        </div>
      )}

      {doctorPickerOpen && (
        <div className="rounded-2xl border-2 border-[#F88535]/40 p-5">
          <div className="flex items-center gap-3">
            <label htmlFor="doctorSearch" className="sr-only">
              Search by name or specialty
            </label>
            <input
              id="doctorSearch"
              type="text"
              value={doctorSearch}
              onChange={(e) => setDoctorSearch(e.target.value)}
              placeholder="Search by name or specialty"
              className="flex-1 rounded-xl border border-black/20 px-4 py-2.5 text-[16px]
                         focus:outline-none focus:border-[#F88535] focus:ring-1 focus:ring-[#F88535]"
            />
            <button
              type="button"
              onClick={() => setDoctorPickerOpen(false)}
              className="text-[15px] font-medium text-black/70 hover:text-black/70 shrink-0"
            >
              Close
            </button>
          </div>

          <div className="mt-4 grid sm:grid-cols-2 gap-3 max-h-[420px] overflow-y-auto pr-1">
            {filteredDoctors.map((doc) => (
              <button
                key={doc.id}
                type="button"
                onClick={() => {
                  setSelectedDoctorId(doc.id);
                  setDoctorPickerOpen(false);
                  setDoctorSearch("");
                }}
                className="text-left rounded-xl border border-black/10 p-4 hover:border-[#F88535] transition"
              >
                <div className="flex items-center gap-3">
                  <DoctorAvatar doctor={doc} />
                  <div className="min-w-0">
                    <p className="font-medium text-[16px] truncate">
                      {doc.name}
                    </p>
                    <p className="text-[15px] text-black/75 truncate">
                      {doc.role}
                    </p>
                  </div>
                </div>
                <p className="mt-2 text-[15px] text-black/75">
                  {doc.specialties.join(" · ")}
                </p>
              </button>
            ))}
            {filteredDoctors.length === 0 && (
              <p className="col-span-full text-[16px] text-black/75 py-4 text-center">
                No doctors match "{doctorSearch}" for this
                consultation type.
              </p>
            )}
          </div>
        </div>
      )}
    </fieldset>
  );
}
