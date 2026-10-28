// The admin dashboard's own figures, worked out from the live lists
// admin.jsx loads (the database-counted ones are in hooks/useServerTotals.js).

/** YYYY-MM-DD in hospital time (Africa/Accra). */
export function hospitalDay(value) {
  return new Date(value).toLocaleDateString("en-CA", { timeZone: "Africa/Accra" });
}

export function initialsOf(name) {
  if (!name) return "?";
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0].toUpperCase())
    .join("");
}

/** Paid bookings still waiting for a doctor and a time. */
export function bookingsToSchedule(bookings) {
  return bookings.filter((b) => b.status === "paid" && !b.consultationId);
}

/** The Overview cards: bookings today, consultations under way, doctors on duty. */
export function dashboardStats({ bookings, todaySlots, bookingLogToday, todayDate }) {
  const todaysBookings = bookingLogToday.length;
  // Under way: the patient and doctor were connected (metAt) and it isn't
  // closed yet. Not a call someone merely opened, and not one the doctor
  // couldn't make (that waits for a new time).
  const activeConsultations = bookings.filter(
    (b) => b.status === "scheduled" && b.metAt && !b.doctorUnavailable,
  ).length;
  // On duty = has something scheduled today (hospital time): a scheduled
  // consultation, a paid booking for a slot today, or an admin-created
  // slot today that isn't cancelled.
  const onDuty = new Set();
  for (const b of bookings) {
    if (b.status === "scheduled" && b.scheduledTime && hospitalDay(b.scheduledTime) === todayDate) {
      onDuty.add(b.doctorUid);
    }
    if (b.status === "paid" && b.preferredTime && hospitalDay(b.preferredTime) === todayDate) {
      onDuty.add(b.requestedDoctorUid);
    }
  }
  for (const s of todaySlots) {
    if (s.status !== "cancelled") onDuty.add(s.doctorUid);
  }
  onDuty.delete(undefined);
  onDuty.delete(null);
  return {
    todaysBookings,
    activeConsultations,
    doctorsOnDuty: onDuty.size,
  };
}
