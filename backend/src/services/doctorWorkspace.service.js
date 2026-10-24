import { randomUUID } from 'node:crypto';
import { ObjectId } from 'mongodb';
import neo4j from 'neo4j-driver';
import { env } from '../config/env.js';
import { getMongoDatabase } from '../config/mongodb.js';
import { getNeo4jDriver } from '../config/neo4j.js';
import { getZonedWeekdayAndTime, OperationError, pageOptions } from './adminOperations.service.js';

const weekdays = new Set([0, 1, 2, 3, 4, 5, 6]);
const recordTypes = new Set(['consultation', 'lab report', 'imaging', 'clinical note', 'other']);

function objectId(value, label = 'ID') {
  if (typeof value !== 'string' || !ObjectId.isValid(value)) {
    throw new OperationError(400, `${label} is invalid.`);
  }
  return new ObjectId(value);
}

function cleanText(value, label, { required = false, max = 2000 } = {}) {
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string') throw new OperationError(400, `${label} must be text.`);
  const text = value.trim();
  if ((required && !text) || text.length > max) {
    throw new OperationError(400, `${label} is required and must be no longer than ${max} characters.`);
  }
  return text;
}

function dateValue(value, label, required = false) {
  if ((value === undefined || value === null || value === '') && !required) return null;
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) throw new OperationError(400, `${label} is not a valid date.`);
  return date;
}

function safeSearch(value) {
  return String(value || '').trim().slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function serializeId(record) {
  if (!record) return record;
  return { ...record, _id: record._id?.toString(), patientId: record.patientId?.toString?.() || record.patientId, doctorId: record.doctorId?.toString?.() || record.doctorId, appointmentId: record.appointmentId?.toString?.() || record.appointmentId };
}

export async function ensureDoctorIndexes() {
  const db = getMongoDatabase();
  await Promise.all([
    db.collection('consultations').createIndex(
      { appointmentId: 1 },
      { unique: true, partialFilterExpression: { appointmentId: { $type: 'objectId' } } },
    ),
    db.collection('consultations').createIndex({ doctorId: 1, patientId: 1, createdAt: -1 }),
    db.collection('medical_records').createIndex({ doctorId: 1, patientId: 1, createdAt: -1 }),
  ]);
}

async function currentDoctor(actor) {
  const doctor = await getMongoDatabase().collection('doctors').findOne({ userId: objectId(actor.id), isActive: { $ne: false } });
  if (!doctor) throw new OperationError(403, 'An active doctor profile is required.');
  return doctor;
}

async function authorizedPatient(actor, patientId) {
  const db = getMongoDatabase();
  const requestedId = objectId(patientId, 'Patient ID');
  const patient = await db.collection('patients').findOne({ $or: [{ _id: requestedId }, { userId: requestedId }], isActive: { $ne: false } });
  if (!patient) throw new OperationError(404, 'Patient was not found.');
  const doctorId = actor.id;
  const [appointment, consultation, record] = await Promise.all([
    db.collection('appointments').findOne({ doctorId, patientId: patient.userId?.toString() || patient._id.toString() }, { projection: { _id: 1 } }),
    db.collection('consultations').findOne({ doctorId, patientId: patient._id }, { projection: { _id: 1 } }),
    db.collection('medical_records').findOne({ doctorId, patientId: patient._id }, { projection: { _id: 1 } }),
  ]);
  if (!appointment && !consultation && !record) throw new OperationError(403, 'You are not authorized to access this patient.');
  return patient;
}

async function patientNamesForAppointments(rows) {
  const ids = [...new Set(rows.map((row) => row.patientId).filter((id) => typeof id === 'string' && ObjectId.isValid(id)))].map((id) => new ObjectId(id));
  if (!ids.length) return new Map();
  const patients = await getMongoDatabase().collection('patients').find({ userId: { $in: ids } }, {
    projection: { userId: 1, name: 1, patientId: 1, _id: 1 },
  }).toArray();
  return new Map(patients.map((patient) => [patient.userId.toString(), {
    id: patient._id.toString(),
    name: patient.name || 'Patient',
    patientIdentifier: patient.patientId || patient._id.toString(),
  }]));
}

export async function getDoctorDashboard(actor) {
  await ensureDoctorIndexes();
  const db = getMongoDatabase();
  const now = new Date();
  const todayStart = new Date(now); todayStart.setUTCHours(0, 0, 0, 0);
  const tomorrow = new Date(todayStart); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const weekEnd = new Date(todayStart); weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);
  const doctorId = actor.id;
  const [todayRows, upcomingCount, completedConsultations, pendingConsultations, patientIds, followUps, recentConsultations, recentRecords, weekRows, graphFailures] = await Promise.all([
    db.collection('appointments').find({ doctorId, scheduledAt: { $gte: todayStart, $lt: tomorrow } }).sort({ scheduledAt: 1 }).limit(50).toArray(),
    db.collection('appointments').countDocuments({ doctorId, scheduledAt: { $gte: tomorrow }, status: 'scheduled' }),
    db.collection('consultations').countDocuments({ doctorId, status: 'finalized' }),
    db.collection('appointments').countDocuments({ doctorId, status: 'scheduled' }),
    Promise.all([
      db.collection('appointments').distinct('patientId', { doctorId }),
      db.collection('consultations').distinct('patientId', { doctorId }),
      db.collection('medical_records').distinct('patientId', { doctorId }),
    ]),
    db.collection('consultations').find({ doctorId, status: 'finalized', 'followUp.status': { $ne: 'completed' }, 'followUp.dueAt': { $lte: weekEnd } }).sort({ 'followUp.dueAt': 1 }).limit(10).toArray(),
    db.collection('consultations').find({ doctorId }).sort({ updatedAt: -1 }).limit(5).project({ diagnosis: 1, patientId: 1, appointmentId: 1, status: 1, updatedAt: 1, createdAt: 1 }).toArray(),
    db.collection('medical_records').find({ doctorId }).sort({ updatedAt: -1 }).limit(5).project({ title: 1, recordType: 1, patientId: 1, updatedAt: 1, createdAt: 1 }).toArray(),
    db.collection('appointments').find({ doctorId, scheduledAt: { $gte: todayStart, $lt: weekEnd } }).sort({ scheduledAt: 1 }).toArray(),
    db.collection('appointments').countDocuments({ doctorId, 'graphSync.status': 'failed' }),
  ]);
  const names = await patientNamesForAppointments([...todayRows, ...weekRows]);
  const recentPatientIds = [...new Set([...recentConsultations, ...recentRecords].map((item) => item.patientId?.toString()).filter(Boolean))];
  const recentPatients = recentPatientIds.length
    ? await db.collection('patients').find({ _id: { $in: recentPatientIds.filter(ObjectId.isValid).map((id) => new ObjectId(id)) } }, { projection: { _id: 1, name: 1, patientId: 1 } }).toArray()
    : [];
  const recentPatientNames = new Map(recentPatients.map((item) => [item._id.toString(), item.name || 'Patient']));
  const followUpRows = followUps.map((item) => ({
    consultationId: item._id.toString(),
    patientId: item.patientId?.toString(),
    patientName: recentPatientNames.get(item.patientId?.toString()) || 'Patient',
    dueAt: item.followUp.dueAt,
    recommendation: item.followUp.recommendation,
    status: item.followUp.status || 'open',
  }));
  return {
    generatedAt: now.toISOString(),
    metrics: {
      todayAppointments: todayRows.filter((item) => item.status !== 'cancelled').length,
      upcomingAppointments: upcomingCount,
      completedConsultations,
      pendingConsultations,
      assignedPatients: new Set(patientIds.flat().map((id) => id?.toString()).filter(Boolean)).size,
      followUpsDueSoon: followUpRows.length,
      overdueFollowUps: followUpRows.filter((item) => new Date(item.dueAt) < todayStart).length,
    },
    todayAppointments: todayRows.map((item) => ({
      ...serializeId(item),
      patient: names.get(item.patientId) || { id: item.patientId, name: 'Patient', patientIdentifier: item.patientId },
    })),
    weekSchedule: weekRows.map((item) => ({
      id: item._id.toString(),
      appointmentId: item.appointmentId,
      scheduledAt: item.scheduledAt,
      status: item.status,
    })),
    followUps: followUpRows,
    recentActivity: [
      ...recentConsultations.map((item) => ({ id: item._id.toString(), type: 'consultation', title: item.diagnosis || 'Consultation draft', patientName: recentPatientNames.get(item.patientId?.toString()) || 'Patient', updatedAt: item.updatedAt, status: item.status })),
      ...recentRecords.map((item) => ({ id: item._id.toString(), type: 'record', title: item.title, patientName: recentPatientNames.get(item.patientId?.toString()) || 'Patient', updatedAt: item.updatedAt, status: item.recordType })),
    ].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)).slice(0, 8),
    graphSyncFailures: graphFailures,
  };
}

export async function listDoctorAppointments(actor, query) {
  await currentDoctor(actor);
  const db = getMongoDatabase();
  const { page, limit, skip } = pageOptions(query);
  const filter = { doctorId: actor.id };
  if (query.status && query.status !== 'all') {
    if (!['scheduled', 'completed', 'cancelled'].includes(query.status)) throw new OperationError(400, 'Appointment status is invalid.');
    filter.status = query.status;
  }
  if (query.from || query.to) {
    filter.scheduledAt = {};
    if (query.from) filter.scheduledAt.$gte = dateValue(query.from, 'Start date', true);
    if (query.to) filter.scheduledAt.$lte = dateValue(query.to, 'End date', true);
    if (filter.scheduledAt.$gte && filter.scheduledAt.$lte && filter.scheduledAt.$gte > filter.scheduledAt.$lte) throw new OperationError(400, 'Date range is invalid.');
  }
  const search = safeSearch(query.search);
  if (search) {
    const re = { $regex: search, $options: 'i' };
    const patients = await db.collection('patients').find({ $or: [{ name: re }, { patientId: re }] }, { projection: { userId: 1 } }).limit(500).toArray();
    filter.$or = [
      { appointmentId: re },
      { patientId: { $in: patients.map((patient) => patient.userId?.toString()).filter(Boolean) } },
    ];
  }
  const [rows, total] = await Promise.all([
    db.collection('appointments').find(filter).sort({ scheduledAt: 1 }).skip(skip).limit(limit).toArray(),
    db.collection('appointments').countDocuments(filter),
  ]);
  const names = await patientNamesForAppointments(rows);
  return {
    items: rows.map((row) => ({ ...serializeId(row), patient: names.get(row.patientId) || { id: row.patientId, name: 'Patient', patientIdentifier: row.patientId } })),
    page, limit, total, pages: Math.ceil(total / limit),
  };
}

export async function getDoctorAppointment(actor, id) {
  await currentDoctor(actor);
  const appointment = await getMongoDatabase().collection('appointments').findOne({ _id: objectId(id, 'Appointment ID'), doctorId: actor.id });
  if (!appointment) throw new OperationError(404, 'Appointment was not found.');
  const patient = await getMongoDatabase().collection('patients').findOne({ userId: objectId(appointment.patientId, 'Patient ID') }, {
    projection: { medicalHistory: 0, records: 0 },
  });
  if (!patient) throw new OperationError(404, 'Appointment patient was not found.');
  return { appointment: serializeId(appointment), patient: { ...serializeId(patient), patientIdentifier: patient.patientId || patient._id.toString() } };
}

export async function changeDoctorAppointmentStatus(actor, id, status) {
  await currentDoctor(actor);
  if (!['completed', 'cancelled'].includes(status)) throw new OperationError(400, 'Appointment status is invalid.');
  const db = getMongoDatabase();
  const _id = objectId(id, 'Appointment ID');
  const appointment = await db.collection('appointments').findOne({ _id, doctorId: actor.id });
  if (!appointment) throw new OperationError(404, 'Appointment was not found.');
  if (appointment.status !== 'scheduled') throw new OperationError(409, 'Only scheduled appointments can be changed.');
  if (status === 'completed' && !(await db.collection('consultations').findOne({ doctorId: actor.id, appointmentId: _id, status: 'finalized' }, { projection: { _id: 1 } }))) {
    throw new OperationError(409, 'Finalize a consultation before completing this appointment.');
  }
  const result = await db.collection('appointments').updateOne(
    { _id, doctorId: actor.id, status: 'scheduled', updatedAt: appointment.updatedAt },
    { $set: { status, updatedAt: new Date(), graphSync: { status: 'pending', updatedAt: new Date(), error: null } } },
  );
  if (!result.modifiedCount) throw new OperationError(409, 'The appointment changed. Refresh and try again.');
  if (status === 'cancelled' || status === 'completed') await db.collection('appointment_slots').deleteOne({ appointmentId: appointment.appointmentId });
  const [patient, doctor] = await Promise.all([
    db.collection('patients').findOne({ userId: objectId(appointment.patientId, 'Patient ID') }),
    db.collection('doctors').findOne({ userId: objectId(actor.id) }),
  ]);
  let graphSync = 'failed';
  if (patient && doctor) {
    try {
      await syncDoctorAppointmentToGraph(appointment, patient, doctor, status);
      await db.collection('appointments').updateOne({ _id }, { $set: { graphSync: { status: 'synced', updatedAt: new Date(), error: null } } });
      graphSync = 'synced';
    } catch {
      await db.collection('appointments').updateOne({ _id }, { $set: { graphSync: { status: 'failed', updatedAt: new Date(), error: 'Graph synchronization failed.' } } });
      console.error('[doctor:graph-sync] Appointment status synchronization failed.');
    }
  }
  await db.collection('audit_logs').insertOne({ actorId: actor.id, actorName: actor.name, action: `doctor.appointment.${status}`, entity: 'appointment', entityId: appointment.appointmentId, metadata: { graphSync }, createdAt: new Date() });
  return { status, graphSync };
}

async function syncDoctorAppointmentToGraph(appointment, patient, doctor, status) {
  const driver = getNeo4jDriver();
  if (!driver) throw new Error('Neo4j driver is unavailable.');
  const session = driver.session({ database: env.neo4jDatabase || 'neo4j' });
  try {
    const result = await session.executeWrite((tx) => tx.run(
      `MERGE (p:Patient {patient_id: $patientId})
       SET p.name = $patientName
       MERGE (d:Doctor {doctor_id: $doctorId})
       SET d.name = $doctorName
       MERGE (a:Appointment {appointment_id: $appointmentId})
       SET a.scheduled_at = $scheduledAt, a.status = $status
       MERGE (p)-[:BOOKED]->(a)
       MERGE (a)-[:WITH_DOCTOR]->(d)
       FOREACH (_ IN CASE WHEN $status = 'completed' THEN [1] ELSE [] END |
         MERGE (p)-[:CONSULTED_DOCTOR]->(d)
       )
       RETURN a.appointment_id AS appointmentId`,
      {
        patientId: appointment.patientId,
        patientName: patient.name || 'Patient',
        doctorId: doctor.userId.toString(),
        doctorName: doctor.name || 'Doctor',
        appointmentId: appointment.appointmentId,
        scheduledAt: appointment.scheduledAt.toISOString(),
        status,
      },
    ));
    if (!result.records.length) throw new Error('Graph synchronization returned no records.');
  } finally {
    await session.close();
  }
}

export async function rescheduleDoctorAppointment(actor, id, input) {
  const doctor = await currentDoctor(actor);
  const db = getMongoDatabase();
  const _id = objectId(id, 'Appointment ID');
  const appointments = db.collection('appointments');
  const appointment = await appointments.findOne({ _id, doctorId: actor.id, status: 'scheduled' });
  if (!appointment) throw new OperationError(404, 'A scheduled appointment assigned to this doctor was not found.');
  const scheduledAt = dateValue(input.scheduledAt, 'Appointment time', true);
  if (scheduledAt <= new Date()) throw new OperationError(400, 'Appointment time must be in the future.');
  if (scheduledAt.valueOf() === new Date(appointment.scheduledAt).valueOf()) throw new OperationError(400, 'Choose a different appointment time.');
  const { day, time } = getZonedWeekdayAndTime(scheduledAt, doctor.availabilityTimeZone || 'UTC');
  const rule = doctor.availability?.find((entry) => entry.enabled && entry.day === day);
  if (Array.isArray(doctor.availability)) {
    if (!rule || time < rule.start || time >= rule.end || (rule.breakStart && time >= rule.breakStart && time < rule.breakEnd)) {
      throw new OperationError(409, 'The new time is outside your saved availability.');
    }
  }
  const conflict = await appointments.findOne({ doctorId: actor.id, scheduledAt, status: 'scheduled', _id: { $ne: _id } }, { projection: { _id: 1 } });
  if (conflict) throw new OperationError(409, 'Another appointment is already scheduled at that time.');
  await db.collection('appointment_slots').createIndex({ doctorId: 1, scheduledAt: 1 }, { unique: true });
  const slot = await db.collection('appointment_slots').insertOne({ doctorId: actor.id, scheduledAt, appointmentId: appointment.appointmentId, createdAt: new Date() }).catch((error) => {
    if (error?.code === 11000) throw new OperationError(409, 'Another appointment is already scheduled at that time.');
    throw error;
  });
  const updatedAt = new Date();
  try {
    const result = await appointments.updateOne({ _id, doctorId: actor.id, status: 'scheduled', updatedAt: appointment.updatedAt }, {
      $set: { scheduledAt, updatedAt, graphSync: { status: 'pending', updatedAt, error: null } },
    });
    if (!result.modifiedCount) throw new OperationError(409, 'The appointment changed. Refresh and try again.');
  } catch (error) {
    await db.collection('appointment_slots').deleteOne({ _id: slot.insertedId });
    throw error;
  }
  await db.collection('appointment_slots').deleteOne({ appointmentId: appointment.appointmentId, scheduledAt: appointment.scheduledAt });
  let graphSync = 'failed';
  const patient = await db.collection('patients').findOne({ userId: objectId(appointment.patientId, 'Patient ID') });
  if (patient) {
    try {
      await syncDoctorAppointmentToGraph({ ...appointment, scheduledAt }, patient, doctor, 'scheduled');
      await appointments.updateOne({ _id }, { $set: { graphSync: { status: 'synced', updatedAt: new Date(), error: null } } });
      graphSync = 'synced';
    } catch {
      await appointments.updateOne({ _id }, { $set: { graphSync: { status: 'failed', updatedAt: new Date(), error: 'Graph synchronization failed.' } } });
      console.error('[doctor:graph-sync] Appointment reschedule synchronization failed.');
    }
  }
  await db.collection('audit_logs').insertOne({ actorId: actor.id, actorName: actor.name, action: 'doctor.appointment.rescheduled', entity: 'appointment', entityId: appointment.appointmentId, metadata: { graphSync }, createdAt: new Date() });
  return { id: id, scheduledAt, graphSync };
}

export async function listDoctorPatients(actor, query) {
  await currentDoctor(actor);
  const db = getMongoDatabase();
  const { page, limit, skip } = pageOptions(query);
  const [appointmentIds, consultationIds, recordIds] = await Promise.all([
    db.collection('appointments').distinct('patientId', { doctorId: actor.id }),
    db.collection('consultations').distinct('patientId', { doctorId: actor.id }),
    db.collection('medical_records').distinct('patientId', { doctorId: actor.id }),
  ]);
  const userIds = [...new Set(appointmentIds)].filter(ObjectId.isValid).map((id) => new ObjectId(id));
  const profileIds = [...new Set([...consultationIds, ...recordIds].map((id) => id?.toString()).filter(ObjectId.isValid))].map((id) => new ObjectId(id));
  const authorization = [];
  if (userIds.length) authorization.push({ userId: { $in: userIds } });
  if (profileIds.length) authorization.push({ _id: { $in: profileIds } });
  if (!authorization.length) return { items: [], page, limit, total: 0, pages: 0 };
  const filter = { $or: authorization, isActive: { $ne: false } };
  const search = safeSearch(query.search);
  if (search) {
    const expression = { $regex: search, $options: 'i' };
    filter.$and = [{ $or: [{ name: expression }, { patientId: expression }, { email: expression }] }];
  }
  const [patients, total] = await Promise.all([
    db.collection('patients').find(filter, { projection: { medicalHistory: 0, records: 0 } }).sort({ name: 1 }).skip(skip).limit(limit).toArray(),
    db.collection('patients').countDocuments(filter),
  ]);
  const patientProfileIds = patients.map((patient) => patient._id);
  const [nextAppointments, allergySummaries] = await Promise.all([
    db.collection('appointments').aggregate([
      { $match: { doctorId: actor.id, status: 'scheduled', scheduledAt: { $gte: new Date() }, patientId: { $in: patients.map((patient) => patient.userId?.toString()).filter(Boolean) } } },
      { $sort: { scheduledAt: 1 } },
      { $group: { _id: '$patientId', nextAppointment: { $first: '$scheduledAt' } } },
    ]).toArray(),
    db.collection('medical_records').find({ doctorId: actor.id, patientId: { $in: patientProfileIds }, allergies: { $exists: true, $ne: [] } }, { projection: { patientId: 1, allergies: 1 } }).toArray(),
  ]);
  const nextByUser = new Map(nextAppointments.map((item) => [item._id, item.nextAppointment]));
  const allergiesByProfile = new Map(allergySummaries.map((item) => [item.patientId.toString(), item.allergies]));
  return {
    items: patients.map((patient) => ({
      ...serializeId(patient),
      patientIdentifier: patient.patientId || patient._id.toString(),
      nextAppointment: nextByUser.get(patient.userId?.toString()) || null,
      allergies: patient.allergies || allergiesByProfile.get(patient._id.toString()) || null,
    })),
    page, limit, total, pages: Math.ceil(total / limit),
  };
}

export async function getDoctorPatient(actor, id) {
  const patient = await authorizedPatient(actor, id);
  const db = getMongoDatabase();
  const [appointments, consultations, records] = await Promise.all([
    db.collection('appointments').find({ doctorId: actor.id, patientId: patient.userId?.toString() || patient._id.toString() }).sort({ scheduledAt: -1 }).limit(100).toArray(),
    db.collection('consultations').find({ doctorId: actor.id, patientId: patient._id }).sort({ createdAt: -1 }).limit(100).toArray(),
    db.collection('medical_records').find({ doctorId: actor.id, patientId: patient._id }).sort({ createdAt: -1 }).limit(100).toArray(),
  ]);
  const doctorIds = [...new Set([...consultations.map((item) => item.doctorId), ...records.map((item) => item.doctorId)].filter(Boolean))].map((value) => ObjectId.isValid(value) ? new ObjectId(value) : null).filter(Boolean);
  const doctors = doctorIds.length ? await db.collection('doctors').find({ userId: { $in: doctorIds } }, { projection: { userId: 1, name: 1 } }).toArray() : [];
  const doctorNames = new Map(doctors.map((item) => [item.userId.toString(), item.name]));
  return {
    patient: { ...serializeId(patient), patientIdentifier: patient.patientId || patient._id.toString() },
    appointments: appointments.map(serializeId),
    consultations: consultations.map((item) => ({ ...serializeId(item), author: doctorNames.get(item.doctorId) || actor.name })),
    records: records.map((item) => ({ ...serializeId(item), author: doctorNames.get(item.doctorId) || actor.name })),
  };
}

function validateVitals(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new OperationError(400, 'Vitals must be an object.');
  const limits = { systolic: [40, 300], diastolic: [20, 200], heartRate: [20, 250], temperatureC: [25, 45], oxygenSaturation: [50, 100] };
  const vitals = {};
  for (const [key, bounds] of Object.entries(limits)) {
    if (input[key] === undefined || input[key] === '') continue;
    const value = Number(input[key]);
    if (!Number.isFinite(value) || value < bounds[0] || value > bounds[1]) throw new OperationError(400, `${key} is outside the accepted measurement range.`);
    vitals[key] = value;
  }
  if (vitals.systolic !== undefined && vitals.diastolic !== undefined && vitals.systolic <= vitals.diastolic) {
    throw new OperationError(400, 'Systolic pressure must exceed diastolic pressure.');
  }
  return vitals;
}

export async function listDoctorConsultations(actor, query) {
  await currentDoctor(actor);
  const filter = { doctorId: actor.id };
  if (query.patientId) filter.patientId = objectId(query.patientId, 'Patient ID');
  if (query.appointmentId) filter.appointmentId = objectId(query.appointmentId, 'Appointment ID');
  if (query.status && ['draft', 'finalized'].includes(query.status)) filter.status = query.status;
  const items = await getMongoDatabase().collection('consultations').find(filter).sort({ updatedAt: -1 }).limit(100).toArray();
  const names = await getMongoDatabase().collection('patients').find({ _id: { $in: [...new Set(items.map((item) => item.patientId?.toString()).filter(ObjectId.isValid))].map((id) => new ObjectId(id)) } }, { projection: { _id: 1, name: 1, patientId: 1 } }).toArray();
  const patientNames = new Map(names.map((item) => [item._id.toString(), item.name]));
  return { items: items.map((item) => ({ ...serializeId(item), patientName: patientNames.get(item.patientId?.toString()) || 'Patient' })) };
}

async function syncConsultationToGraph(appointment, patient, doctor) {
  const driver = getNeo4jDriver();
  if (!driver) throw new Error('Neo4j driver is unavailable.');
  const session = driver.session({ database: env.neo4jDatabase || 'neo4j' });
  try {
    const result = await session.executeWrite((tx) => tx.run(
      `MATCH (p:Patient {patient_id: $patientId})
       MATCH (a:Appointment {appointment_id: $appointmentId})
       MATCH (d:Doctor {doctor_id: $doctorId})
       MERGE (p)-[:CONSULTED_DOCTOR]->(d)
       SET a.status = 'completed'`,
      { patientId: appointment.patientId, appointmentId: appointment.appointmentId, doctorId: doctor.userId.toString() },
    ));
    if (result.summary.counters.updates().propertiesSet === 0) {
      const verification = await session.run(
        'MATCH (p:Patient {patient_id: $patientId})-[:CONSULTED_DOCTOR]->(d:Doctor {doctor_id: $doctorId}) RETURN count(*) AS count',
        { patientId: appointment.patientId, doctorId: doctor.userId.toString() },
      );
      if (!verification.records.length || Number(verification.records[0].get('count')) === 0) throw new Error('Expected graph records were not found.');
    }
  } finally {
    await session.close();
  }
}

export async function saveDoctorConsultation(actor, input) {
  const doctor = await currentDoctor(actor);
  const db = getMongoDatabase();
  const appointmentObjectId = objectId(input.appointmentId, 'Appointment ID');
  const appointment = await db.collection('appointments').findOne({ _id: appointmentObjectId, doctorId: actor.id });
  if (!appointment) throw new OperationError(404, 'An appointment assigned to this doctor was not found.');
  if (!['scheduled', 'completed'].includes(appointment.status)) throw new OperationError(409, 'This appointment cannot have a consultation.');
  const existing = await db.collection('consultations').findOne({ appointmentId: appointmentObjectId });
  const status = input.status === 'draft' ? 'draft' : 'finalized';
  const diagnosis = cleanText(input.diagnosis, 'Diagnosis', { max: 1000 });
  const notes = cleanText(input.notes, 'Clinical notes', { max: 10000 });
  const plan = cleanText(input.treatmentPlan, 'Treatment plan', { max: 5000 });
  const prescriptionSummary = cleanText(input.prescriptionSummary, 'Prescription summary', { max: 3000 });
  const recommendation = cleanText(input.followUp?.recommendation, 'Follow-up recommendation', { max: 1000 });
  const dueAt = dateValue(input.followUp?.dueAt, 'Follow-up date');
  if (status === 'finalized' && (!diagnosis || !notes)) throw new OperationError(400, 'Diagnosis and clinical notes are required to finalize a consultation.');
  if (Boolean(recommendation) !== Boolean(dueAt)) throw new OperationError(400, 'Provide both a follow-up recommendation and due date.');
  if (existing && existing.status === 'finalized') throw new OperationError(409, 'A finalized consultation already exists for this appointment.');
  if (existing && input.id && existing._id.toString() !== input.id) throw new OperationError(409, 'A consultation already exists for this appointment.');
  const now = new Date();
  const consultation = {
    appointmentId: appointmentObjectId,
    doctorId: actor.id,
    patientId: objectId(appointment.patientId, 'Patient ID'),
    diagnosis: diagnosis || '',
    notes: notes || '',
    treatmentPlan: plan || '',
    prescriptionSummary: prescriptionSummary || '',
    followUp: recommendation && dueAt ? { recommendation, dueAt, status: 'open' } : null,
    vitals: validateVitals(input.vitals),
    status,
    authorId: actor.id,
    updatedAt: now,
  };
  let consultationId;
  if (existing) {
    if (existing.doctorId !== actor.id) throw new OperationError(403, 'You are not authorized to update this consultation.');
    if (existing.status === 'finalized') throw new OperationError(409, 'Finalized consultations are read-only.');
    await db.collection('consultations').updateOne({ _id: existing._id, doctorId: actor.id, status: 'draft' }, { $set: consultation });
    consultationId = existing._id;
  } else {
    consultation.createdAt = now;
    const result = await db.collection('consultations').insertOne(consultation);
    consultationId = result.insertedId;
  }
  let graphSync = 'not-required';
  if (status === 'finalized') {
    const patient = await db.collection('patients').findOne({ _id: consultation.patientId });
    await db.collection('appointments').updateOne({ _id: appointmentObjectId, doctorId: actor.id }, { $set: { status: 'completed', updatedAt: now, graphSync: { status: 'pending', updatedAt: now, error: null } } });
    await db.collection('appointment_slots').deleteOne({ appointmentId: appointment.appointmentId });
    try {
      if (!patient) throw new Error('Patient record unavailable.');
      await syncConsultationToGraph(appointment, patient, doctor);
      await db.collection('appointments').updateOne({ _id: appointmentObjectId }, { $set: { graphSync: { status: 'synced', updatedAt: new Date(), error: null } } });
      graphSync = 'synced';
    } catch {
      await db.collection('appointments').updateOne({ _id: appointmentObjectId }, { $set: { graphSync: { status: 'failed', updatedAt: new Date(), error: 'Graph synchronization failed.' } } });
      graphSync = 'failed';
      console.error('[doctor:graph-sync] Consultation relationship synchronization failed.');
    }
  }
  await db.collection('audit_logs').insertOne({
    actorId: actor.id,
    actorName: actor.name,
    action: existing ? `consultation.${status === 'draft' ? 'draft_updated' : 'finalized'}` : `consultation.${status === 'draft' ? 'draft_created' : 'finalized'}`,
    entity: 'consultation',
    entityId: consultationId.toString(),
    metadata: { appointmentId: appointment.appointmentId, graphSync },
    createdAt: now,
  });
  return { consultation: { ...serializeId(consultation), _id: consultationId.toString(), id: consultationId.toString() }, graphSync };
}

export async function listDoctorRecords(actor, query) {
  await currentDoctor(actor);
  const db = getMongoDatabase();
  const { page, limit, skip } = pageOptions(query);
  const filter = { doctorId: actor.id };
  if (query.patientId) filter.patientId = objectId(query.patientId, 'Patient ID');
  if (query.type && query.type !== 'all') {
    if (!recordTypes.has(String(query.type).toLowerCase())) throw new OperationError(400, 'Medical record type is invalid.');
    filter.recordType = String(query.type).toLowerCase();
  }
  if (query.from || query.to) {
    filter.createdAt = {};
    if (query.from) filter.createdAt.$gte = dateValue(query.from, 'Start date', true);
    if (query.to) filter.createdAt.$lte = dateValue(query.to, 'End date', true);
    if (filter.createdAt.$gte && filter.createdAt.$lte && filter.createdAt.$gte > filter.createdAt.$lte) throw new OperationError(400, 'Date range is invalid.');
  }
  const search = safeSearch(query.search);
  if (search) {
    const expression = { $regex: search, $options: 'i' };
    const patients = await db.collection('patients').find({ $or: [{ name: expression }, { patientId: expression }] }, { projection: { _id: 1 } }).limit(500).toArray();
    filter.$or = [
      { recordId: expression },
      { title: expression },
      { patientId: { $in: patients.map((patient) => patient._id) } },
    ];
  }
  const [items, total] = await Promise.all([
    db.collection('medical_records').find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(),
    db.collection('medical_records').countDocuments(filter),
  ]);
  const patientIds = [...new Set(items.map((item) => item.patientId?.toString()).filter(ObjectId.isValid))].map((id) => new ObjectId(id));
  const patients = patientIds.length ? await db.collection('patients').find({ _id: { $in: patientIds } }, { projection: { _id: 1, name: 1, patientId: 1 } }).toArray() : [];
  const patientNames = new Map(patients.map((item) => [item._id.toString(), item]));
  return { items: items.map((item) => ({ ...serializeId(item), patient: patientNames.get(item.patientId?.toString()) || null })), page, limit, total, pages: Math.ceil(total / limit) };
}

export async function saveDoctorRecord(actor, input, id) {
  const patient = await authorizedPatient(actor, input.patientId || '');
  const db = getMongoDatabase();
  const title = cleanText(input.title, 'Record title', { required: true, max: 160 });
  const recordType = cleanText(input.recordType, 'Record type', { required: true, max: 50 }).toLowerCase();
  if (!recordTypes.has(recordType)) throw new OperationError(400, 'Record type is not supported.');
  const content = cleanText(input.content, 'Record content', { required: true, max: 10000 });
  const now = new Date();
  if (id) {
    const _id = objectId(id, 'Record ID');
    const existing = await db.collection('medical_records').findOne({ _id, doctorId: actor.id, patientId: patient._id });
    if (!existing) throw new OperationError(404, 'Medical record was not found.');
    await db.collection('medical_records').updateOne({ _id, doctorId: actor.id }, {
      $set: { title, recordType, content, updatedAt: now },
      $push: { history: { title: existing.title, recordType: existing.recordType, content: existing.content, archivedAt: now, archivedBy: actor.id } },
    });
    await db.collection('audit_logs').insertOne({ actorId: actor.id, actorName: actor.name, action: 'medical_record.updated', entity: 'medical_record', entityId: id, createdAt: now });
    return { id, updatedAt: now };
  }
  const result = await db.collection('medical_records').insertOne({
    recordId: `MR-${randomUUID()}`,
    patientId: patient._id,
    doctorId: actor.id,
    title, recordType, content,
    authorId: actor.id,
    createdAt: now,
    updatedAt: now,
  });
  await db.collection('audit_logs').insertOne({ actorId: actor.id, actorName: actor.name, action: 'medical_record.created', entity: 'medical_record', entityId: result.insertedId.toString(), createdAt: now });
  return { id: result.insertedId.toString(), createdAt: now };
}

export async function listDoctorFollowUps(actor, query) {
  await currentDoctor(actor);
  const filter = { doctorId: actor.id, status: 'finalized', 'followUp.recommendation': { $type: 'string' } };
  const now = new Date();
  const startToday = new Date(now); startToday.setUTCHours(0, 0, 0, 0);
  const endToday = new Date(startToday); endToday.setUTCHours(23, 59, 59, 999);
  if (query.status && !['all', 'completed', 'overdue', 'today', 'upcoming'].includes(query.status)) throw new OperationError(400, 'Follow-up status is invalid.');
  if (query.status === 'completed') filter['followUp.status'] = 'completed';
  else if (query.status === 'overdue') { filter['followUp.status'] = { $ne: 'completed' }; filter['followUp.dueAt'] = { $lt: now }; }
  else if (query.status === 'today') { filter['followUp.status'] = { $ne: 'completed' }; filter['followUp.dueAt'] = { $gte: startToday, $lte: endToday }; }
  else if (query.status === 'upcoming') { filter['followUp.status'] = { $ne: 'completed' }; filter['followUp.dueAt'] = { $gte: now }; }
  const items = await getMongoDatabase().collection('consultations').find(filter).sort({ 'followUp.dueAt': 1 }).limit(200).toArray();
  const names = await getMongoDatabase().collection('patients').find({ _id: { $in: [...new Set(items.map((item) => item.patientId?.toString()).filter(ObjectId.isValid))].map((id) => new ObjectId(id)) } }, { projection: { _id: 1, name: 1 } }).toArray();
  const patientNames = new Map(names.map((item) => [item._id.toString(), item.name]));
  return { items: items.map((item) => ({ id: item._id.toString(), consultationId: item._id.toString(), appointmentId: item.appointmentId?.toString(), patientId: item.patientId?.toString(), patientName: patientNames.get(item.patientId?.toString()) || 'Patient', diagnosis: item.diagnosis, recommendation: item.followUp.recommendation, dueAt: item.followUp.dueAt, status: item.followUp.status || 'open' })) };
}

export async function updateDoctorFollowUp(actor, id, input) {
  await currentDoctor(actor);
  const db = getMongoDatabase();
  const _id = objectId(id, 'Consultation ID');
  const consultation = await db.collection('consultations').findOne({ _id, doctorId: actor.id, status: 'finalized', 'followUp.recommendation': { $type: 'string' } });
  if (!consultation) throw new OperationError(404, 'Follow-up was not found.');
  const changes = {};
  if (input.status !== undefined) {
    if (!['open', 'completed'].includes(input.status)) throw new OperationError(400, 'Follow-up status is invalid.');
    changes['followUp.status'] = input.status;
  }
  if (input.dueAt !== undefined) changes['followUp.dueAt'] = dateValue(input.dueAt, 'Follow-up date', true);
  if (input.recommendation !== undefined) changes['followUp.recommendation'] = cleanText(input.recommendation, 'Follow-up recommendation', { required: true, max: 1000 });
  if (!Object.keys(changes).length) throw new OperationError(400, 'Provide a follow-up status, date, or recommendation.');
  changes.updatedAt = new Date();
  await db.collection('consultations').updateOne({ _id, doctorId: actor.id }, { $set: changes });
  await db.collection('audit_logs').insertOne({ actorId: actor.id, actorName: actor.name, action: 'follow_up.updated', entity: 'consultation', entityId: id, createdAt: new Date() });
  return { id, status: changes['followUp.status'] || consultation.followUp.status || 'open' };
}

export async function getDoctorAvailability(actor) {
  const doctor = await currentDoctor(actor);
  return { availability: doctor.availability || [], timeZone: doctor.availabilityTimeZone || 'UTC', configured: Array.isArray(doctor.availability) };
}

function parseAvailability(input) {
  if (!Array.isArray(input) || input.length > 7) throw new OperationError(400, 'Availability must contain no more than seven weekly entries.');
  const seen = new Set();
  return input.map((entry) => {
    const day = Number(entry.day);
    if (!weekdays.has(day) || seen.has(day) || typeof entry.enabled !== 'boolean') throw new OperationError(400, 'Availability contains a duplicate or invalid weekday.');
    seen.add(day);
    if (!entry.enabled) return { day, enabled: false };
    const start = cleanText(entry.start, 'Start time', { required: true, max: 5 });
    const end = cleanText(entry.end, 'End time', { required: true, max: 5 });
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(end) || start >= end) throw new OperationError(400, 'Each working day needs a valid start time before its end time.');
    const rule = { day, enabled: true, start, end };
    const breakStart = entry.breakStart ? cleanText(entry.breakStart, 'Break start', { max: 5 }) : '';
    const breakEnd = entry.breakEnd ? cleanText(entry.breakEnd, 'Break end', { max: 5 }) : '';
    if (Boolean(breakStart) !== Boolean(breakEnd)) throw new OperationError(400, 'Provide both break start and break end.');
    if (breakStart && (!/^([01]\d|2[0-3]):[0-5]\d$/.test(breakStart) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(breakEnd) || breakStart <= start || breakEnd >= end || breakStart >= breakEnd)) {
      throw new OperationError(400, 'Break times must be inside working hours and in order.');
    }
    if (breakStart) { rule.breakStart = breakStart; rule.breakEnd = breakEnd; }
    return rule;
  });
}

export async function updateDoctorAvailability(actor, input) {
  const doctor = await currentDoctor(actor);
  const availability = parseAvailability(input.availability);
  const timeZone = cleanText(input.timeZone || doctor.availabilityTimeZone || 'UTC', 'Time zone', { required: true, max: 80 });
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
  } catch {
    throw new OperationError(400, 'Enter a valid IANA time zone.');
  }
  const scheduled = await getMongoDatabase().collection('appointments').find({ doctorId: actor.id, status: 'scheduled', scheduledAt: { $gte: new Date() } }).project({ appointmentId: 1, scheduledAt: 1 }).toArray();
  const enabledDays = new Map(availability.filter((item) => item.enabled).map((item) => [item.day, item]));
  const conflicts = scheduled.filter((appointment) => {
    const date = new Date(appointment.scheduledAt);
    const { day, time } = getZonedWeekdayAndTime(date, timeZone);
    const rule = enabledDays.get(day);
    if (!rule) return true;
    return time < rule.start || time >= rule.end || (rule.breakStart && time >= rule.breakStart && time < rule.breakEnd);
  });
  if (conflicts.length) throw new OperationError(409, `Availability conflicts with ${conflicts.length} existing scheduled appointment(s). No appointments were changed.`);
  await getMongoDatabase().collection('doctors').updateOne({ _id: doctor._id }, { $set: { availability, availabilityTimeZone: timeZone, updatedAt: new Date() } });
  await getMongoDatabase().collection('audit_logs').insertOne({ actorId: actor.id, actorName: actor.name, action: 'doctor.availability.updated', entity: 'doctor', entityId: doctor._id.toString(), createdAt: new Date() });
  return { availability, timeZone };
}

export async function getDoctorProfile(actor) {
  const doctor = await currentDoctor(actor);
  return {
    profile: {
      id: doctor._id.toString(),
      userId: actor.id,
      name: doctor.name || actor.name,
      email: doctor.email || actor.email,
      phone: doctor.phone || '',
      specialization: doctor.specialization || '',
      department: doctor.department || '',
      qualifications: doctor.qualifications || '',
      availability: doctor.availability || [],
      availabilityTimeZone: doctor.availabilityTimeZone || 'UTC',
    },
  };
}

export async function updateDoctorProfile(actor, input) {
  const doctor = await currentDoctor(actor);
  const changes = {};
  if (input.name !== undefined) changes.name = cleanText(input.name, 'Name', { required: true, max: 100 });
  if (input.phone !== undefined) changes.phone = cleanText(input.phone, 'Phone number', { max: 40 });
  if (input.specialization !== undefined) changes.specialization = cleanText(input.specialization, 'Specialization', { required: true, max: 100 });
  if (input.department !== undefined) changes.department = cleanText(input.department, 'Department', { required: true, max: 100 });
  if (input.qualifications !== undefined) changes.qualifications = cleanText(input.qualifications, 'Qualifications', { max: 1000 });
  if (input.email !== undefined) {
    const email = cleanText(input.email, 'Email', { required: true, max: 254 }).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new OperationError(400, 'Enter a valid email address.');
    if (await getMongoDatabase().collection('users').findOne({ email, _id: { $ne: objectId(actor.id) } }, { projection: { _id: 1 } })) throw new OperationError(409, 'This email address is already in use.');
    changes.email = email;
  }
  if (!Object.keys(changes).length) throw new OperationError(400, 'Provide at least one permitted profile field.');
  changes.updatedAt = new Date();
  await getMongoDatabase().collection('doctors').updateOne({ _id: doctor._id }, { $set: changes });
  const userChanges = { updatedAt: changes.updatedAt };
  for (const key of ['name', 'email']) if (changes[key] !== undefined) userChanges[key] = changes[key];
  await getMongoDatabase().collection('users').updateOne({ _id: objectId(actor.id) }, { $set: userChanges });
  await getMongoDatabase().collection('audit_logs').insertOne({ actorId: actor.id, actorName: actor.name, action: 'doctor.profile.updated', entity: 'doctor', entityId: doctor._id.toString(), metadata: { fields: Object.keys(changes).filter((key) => key !== 'updatedAt') }, createdAt: new Date() });
  return { profile: { ...changes, id: doctor._id.toString() } };
}

export async function createDoctorRecord(actor, input) {
  const result = await saveDoctorRecord(actor, input);
  return result;
}
