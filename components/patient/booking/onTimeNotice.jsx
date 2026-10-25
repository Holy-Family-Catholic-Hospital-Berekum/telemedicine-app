// Missed appointments (no-show policy, admin-set).
export default function OnTimeNotice({ settings, online, payAtHospital }) {
  return (
    <div className="mt-8 rounded-2xl border border-[#F88535]/40 bg-[#F88535]/5 p-5">
      <p className="text-[16px] font-medium">Please be on time</p>
      {payAtHospital ? (
        <p className="mt-1.5 text-[16px] text-black/80">
          If you don't arrive within {settings.noShow.waitMinutes} minutes
          of the start, the visit may be marked as missed and you
          will need to book again. If you can't make it, change
          the time from your dashboard before the visit.
        </p>
      ) : (
      <p className="mt-1.5 text-[16px] text-black/80">
        {online
          ? `Whoever is in the video room first waits up to ${settings.noShow.waitMinutes} minutes for the other (from the start time, or from when they joined if later). If your doctor is waiting and you don't join in that time, the consultation is marked as missed. If your doctor doesn't join in time, you get a new time at no cost or a full refund.`
          : `If you don't arrive within ${settings.noShow.waitMinutes} minutes of the start, the visit may be marked as missed.`}
        {settings.noShow.rescheduleFee > 0
          ? ` To book a new time after that, you pay an extra GHS ${settings.noShow.rescheduleFee}`
          : " You can then book a new time"}
        {`, or you can ask for a refund minus ${settings.noShow.forfeitPercent}% of what you paid.`}{" "}
        {settings.noShow.rescheduleFee > 0
          ? `If you can't make it, change the time from your dashboard: free up to 24 hours before the appointment, GHS ${settings.noShow.rescheduleFee} after that.`
          : "If you can't make it, change the time free of charge from your dashboard before the appointment."}
      </p>
      )}
    </div>
  );
}
