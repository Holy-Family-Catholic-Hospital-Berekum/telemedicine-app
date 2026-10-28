// The Overview figures worked out in the browser (components/admin/adminStats.js).
import { test } from "node:test";
import assert from "node:assert/strict";

import { bookingsToSchedule, dashboardStats, hospitalDay, initialsOf } from "../adminStats.js";

const TODAY = "2026-10-28";
const at = (iso) => new Date(iso);

test("hospitalDay is the date in Accra (UTC+0)", () => {
  assert.equal(hospitalDay(at("2026-10-28T00:00:00Z")), "2026-10-28");
  assert.equal(hospitalDay(at("2026-10-28T23:59:59Z")), "2026-10-28");
  assert.equal(hospitalDay("2026-10-29T00:00:00Z"), "2026-10-29");
});

test("initialsOf: first two words", () => {
  assert.equal(initialsOf("Ama Kofi Mensah"), "AK");
  assert.equal(initialsOf("  ama   mensah "), "AM");
  assert.equal(initialsOf("Kwame"), "K");
  assert.equal(initialsOf(""), "?");
  assert.equal(initialsOf(undefined), "?");
});

test("bookingsToSchedule: paid and not yet given a consultation", () => {
  const bookings = [
    { id: "a", status: "paid" },
    { id: "b", status: "paid", consultationId: "HFC-1" },
    { id: "c", status: "scheduled", consultationId: "HFC-2" },
    { id: "d", status: "no_show" },
  ];
  assert.deepEqual(bookingsToSchedule(bookings).map((b) => b.id), ["a"]);
});

test("dashboardStats: bookings today come from the booking log", () => {
  const stats = dashboardStats({ bookings: [], todaySlots: [], bookingLogToday: [{}, {}, {}], todayDate: TODAY });
  assert.deepEqual(stats, { todaysBookings: 3, activeConsultations: 0, doctorsOnDuty: 0 });
});

test("dashboardStats: in progress = scheduled, connected, doctor not out", () => {
  const bookings = [
    { status: "scheduled", metAt: at("2026-10-28T09:05:00Z") },
    { status: "scheduled" }, // not connected yet
    { status: "scheduled", metAt: at("2026-10-28T09:05:00Z"), doctorUnavailable: { kind: "call_incomplete" } },
    { status: "no_show", metAt: at("2026-10-28T09:05:00Z") },
    // Current behaviour, reported for a decision: connected days ago and
    // never closed still counts as in progress.
    { status: "scheduled", metAt: at("2026-10-20T09:05:00Z") },
  ];
  const stats = dashboardStats({ bookings, todaySlots: [], bookingLogToday: [], todayDate: TODAY });
  assert.equal(stats.activeConsultations, 2);
});

test("dashboardStats: doctors on duty today, each counted once", () => {
  const bookings = [
    { status: "scheduled", doctorUid: "d1", scheduledTime: at("2026-10-28T10:00:00Z") },
    { status: "scheduled", doctorUid: "d1", scheduledTime: at("2026-10-28T14:00:00Z") },
    { status: "scheduled", doctorUid: "d2", scheduledTime: at("2026-10-29T10:00:00Z") }, // tomorrow
    { status: "paid", requestedDoctorUid: "d3", preferredTime: at("2026-10-28T11:00:00Z") },
    { status: "paid", preferredTime: at("2026-10-28T11:00:00Z") }, // no doctor asked for
    { status: "scheduled", doctorUid: "d4" }, // no time
  ];
  const todaySlots = [
    { status: "open", doctorUid: "d5" },
    { status: "booked", doctorUid: "d1" },
    { status: "cancelled", doctorUid: "d6" },
    { status: "open", doctorUid: null },
  ];
  const stats = dashboardStats({ bookings, todaySlots, bookingLogToday: [], todayDate: TODAY });
  assert.equal(stats.doctorsOnDuty, 3); // d1, d3, d5
});
