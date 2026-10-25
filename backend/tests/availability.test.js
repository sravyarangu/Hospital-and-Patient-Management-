import assert from 'node:assert/strict';
import test from 'node:test';
import {
  appointmentDuration,
  appointmentMinuteReservations,
  fitsDoctorAvailability,
  requireMinuteAlignedAppointmentTime,
} from '../src/services/adminOperations.service.js';
import { parseAppointmentDuration, parseAvailability } from '../src/services/doctorWorkspace.service.js';

const mondaySchedule = [{
  day: 1,
  enabled: true,
  start: '09:00',
  end: '17:00',
  breakStart: '13:00',
  breakEnd: '14:00',
}];

test('availability permits slots fully inside working hours in the saved time zone', () => {
  assert.equal(fitsDoctorAvailability(mondaySchedule, 'Asia/Kolkata', new Date('2026-10-26T03:30:00.000Z'), 30), true);
  assert.equal(fitsDoctorAvailability(mondaySchedule, 'Asia/Kolkata', new Date('2026-10-26T11:00:00.000Z'), 30), true);
});

test('availability rejects slots outside hours and appointments that overlap a break', () => {
  assert.equal(fitsDoctorAvailability(mondaySchedule, 'Asia/Kolkata', new Date('2026-10-26T02:45:00.000Z'), 30), false);
  assert.equal(fitsDoctorAvailability(mondaySchedule, 'Asia/Kolkata', new Date('2026-10-26T07:15:00.000Z'), 30), false);
  assert.equal(fitsDoctorAvailability(mondaySchedule, 'Asia/Kolkata', new Date('2026-10-26T11:15:00.000Z'), 30), false);
});

test('availability rejects unconfigured or disabled days', () => {
  assert.equal(fitsDoctorAvailability([], 'UTC', new Date('2026-10-26T09:00:00.000Z'), 30), false);
  assert.equal(fitsDoctorAvailability([{ day: 1, enabled: false }], 'UTC', new Date('2026-10-26T09:00:00.000Z'), 30), false);
});

test('appointment times must align to a whole minute', () => {
  assert.equal(requireMinuteAlignedAppointmentTime('2026-10-26T09:00:00.000Z').toISOString(), '2026-10-26T09:00:00.000Z');
  assert.throws(() => requireMinuteAlignedAppointmentTime('2026-10-26T09:00:30.000Z'), { status: 400 });
});

test('appointment duration uses configured values and a safe legacy fallback', () => {
  assert.equal(appointmentDuration({ availabilityDurationMinutes: 45 }), 45);
  assert.equal(appointmentDuration({ availabilityDurationMinutes: 45 }, { durationMinutes: 60 }), 60);
  assert.equal(appointmentDuration({ availabilityDurationMinutes: 200 }), 30);
});

test('minute reservations cover the complete appointment interval', () => {
  const start = new Date('2026-10-26T09:00:00.000Z');
  const reservations = appointmentMinuteReservations('doctor-id', start, 30, 'appointment-id');
  assert.equal(reservations.length, 30);
  assert.equal(reservations[0].scheduledAt.toISOString(), start.toISOString());
  assert.equal(reservations.at(-1).scheduledAt.toISOString(), '2026-10-26T09:29:00.000Z');
  assert.ok(reservations.every((reservation) => reservation.doctorId === 'doctor-id' && reservation.appointmentId === 'appointment-id'));
});

test('weekly availability requires one valid entry for every weekday', () => {
  const week = Array.from({ length: 7 }, (_, day) => ({ day, enabled: false }));
  week[1] = { day: 1, enabled: true, start: '09:00', end: '17:00', breakStart: '13:00', breakEnd: '14:00' };
  assert.equal(parseAvailability(week).length, 7);
  assert.throws(() => parseAvailability(week.slice(1)), { status: 400 });
  assert.throws(() => parseAvailability(week.map((entry, day) => ({ ...entry, day: day === 6 ? 5 : entry.day }))), { status: 400 });
});

test('availability rejects invalid working and break periods', () => {
  const invalidHours = Array.from({ length: 7 }, (_, day) => ({ day, enabled: false }));
  invalidHours[1] = { day: 1, enabled: true, start: '17:00', end: '09:00' };
  assert.throws(() => parseAvailability(invalidHours), { status: 400 });

  const invalidBreak = Array.from({ length: 7 }, (_, day) => ({ day, enabled: false }));
  invalidBreak[1] = { day: 1, enabled: true, start: '09:00', end: '17:00', breakStart: '08:00', breakEnd: '14:00' };
  assert.throws(() => parseAvailability(invalidBreak), { status: 400 });
});

test('appointment duration accepts only 15-minute increments up to two hours', () => {
  assert.equal(parseAppointmentDuration(45), 45);
  assert.throws(() => parseAppointmentDuration(20), { status: 400 });
  assert.throws(() => parseAppointmentDuration(135), { status: 400 });
});
