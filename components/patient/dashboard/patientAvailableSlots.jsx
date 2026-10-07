import { Link } from "react-router-dom";
import { CalendarPlus } from "lucide-react";
import { TYPE_LABELS, MODE_LABELS, formatDateTime } from "../../../src/constants";
import { Pagination } from "../../shared/pagination.jsx";
import { usePagination } from "../../shared/usePagination.js";

/**
 * AvailableSlots
 *
 * Booking — including payment — happens in exactly one place: the /book
 * flow in bookConsultation.jsx (createBookingDraft -> initializePayment
 * -> Paystack, server-confirmed). patientFirestoreService.js no longer
 * exports createBooking for that reason (see the note at the top of that
 * file): there's no separate "claim now, pay later" step to reimplement
 * here, and duplicating the payment/verification logic in a second place
 * would be a good way to end up with two different sources of truth for
 * "is this booking paid".
 *
 * So claiming an open slot from the dashboard just hands the patient off
 * to /book with that slot's details pre-filled via query params, rather
 * than collecting a second details form here. bookConsultation.jsx reads
 * these params on mount (see the effect that also reads `doctor`) and
 * pre-selects type, mode and doctor, and threads slotId through to
 * createBookingDraft so the server can convert this specific held slot
 * into a booking instead of creating a fresh, unrelated one.
 */
export default function AvailableSlots({ slots }) {
  const pager = usePagination(slots ?? [], 5);
  if (!slots?.length) return null;

  return (
    <div>
      <h3 className="text-sm font-medium text-[#12242C]">
        Free appointment times you can book
      </h3>
      <div className="mt-2 space-y-2">
        {pager.pageItems.map((slot) => {
          const params = new URLSearchParams({
            slotId: slot.slotId,
            type: slot.type,
            mode: slot.mode,
          });
          if (slot.doctorUid) params.set("doctor", slot.doctorUid);

          return (
            <div
              key={slot.slotId}
              className="flex items-center justify-between gap-3 rounded-md border border-[#DCE6EC] p-3.5"
            >
              <div className="text-sm">
                <p className="font-medium text-[#12242C]">{slot.doctorName}</p>
                <p className="text-xs text-[#3E4E56]">
                  {TYPE_LABELS[slot.type] ?? slot.type} ·{" "}
                  {MODE_LABELS[slot.mode] ?? slot.mode} ·{" "}
                  {formatDateTime(slot.startAt)}
                </p>
              </div>
              <Link
                to={`/book?${params.toString()}`}
                className="flex shrink-0 items-center gap-1.5 rounded-sm border border-[#0095D9] px-3 py-1.5 text-xs font-medium text-[#0095D9] hover:bg-[#0095D90D] transition"
              >
                <CalendarPlus size={13} strokeWidth={1.75} />
                Book
              </Link>
            </div>
          );
        })}
      </div>
      <Pagination {...pager} noun="open times" size="lg" />
    </div>
  );
}
