import { randomUUID } from 'node:crypto';
import { ObjectId } from 'mongodb';
import bcrypt from 'bcryptjs';
import neo4j from 'neo4j-driver';
import { env } from '../config/env.js';
import { getMongoClient, getMongoDatabase } from '../config/mongodb.js';
import { getNeo4jDriver } from '../config/neo4j.js';

const roles = new Set(['patient', 'doctor', 'admin']);
const appointmentStatuses = new Set(['scheduled', 'completed', 'cancelled']);
const allowedTimeZone = 'UTC';

export class OperationError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function getZonedWeekdayAndTime(date, timeZone = 'UTC') {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(values.weekday);
  return { day, time: `${values.hour}:${values.minute}` };
}

const maxAppointmentDurationMinutes = 120;

export function appointmentDuration(doctor, appointment = {}) {
  const duration = Number(appointment.durationMinutes ?? doctor.availabilityDurationMinutes ?? 30);
  return Number.isInteger(duration) && duration >= 15 && duration <= maxAppointmentDurationMinutes
    ? duration
    : 30;
}

export function fitsDoctorAvailability(availability, timeZone, scheduledAt, durationMinutes) {
  if (!Array.isArray(availability) || availability.length === 0) return false;
  const endAt = new Date(scheduledAt.valueOf() + durationMinutes * 60000);
  const start = getZonedWeekdayAndTime(scheduledAt, timeZone);
  const end = getZonedWeekdayAndTime(endAt, timeZone);
  if (start.day !== end.day) return false;
  const rule = availability.find((entry) => entry.enabled && entry.day === start.day);
  if (!rule || start.time < rule.start || end.time > rule.end) return false;
  if (rule.breakStart && start.time < rule.breakEnd && end.time > rule.breakStart) return false;
  return true;
}

export function requireMinuteAlignedAppointmentTime(value) {
  const scheduledAt = new Date(value);
  if (Number.isNaN(scheduledAt.valueOf()) || scheduledAt.getUTCSeconds() !== 0 || scheduledAt.getUTCMilliseconds() !== 0) {
    throw new OperationError(400, 'Appointment time must be a valid date aligned to a whole minute.');
  }
  return scheduledAt;
}

export async function assertNoAppointmentOverlap(db, doctorId, scheduledAt, durationMinutes, exceptId, session, doctor = {}) {
  const endAt = new Date(scheduledAt.valueOf() + durationMinutes * 60000);
  const filter = {
    doctorId,
    status: 'scheduled',
    scheduledAt: { $gte: new Date(scheduledAt.valueOf() - maxAppointmentDurationMinutes * 60000), $lt: endAt },
  };
  if (exceptId) filter._id = { $ne: exceptId };
  const appointments = await db.collection('appointments').find(filter, { session }).toArray();
  const conflict = appointments.some((appointment) => {
    const existingEnd = new Date(appointment.scheduledAt.valueOf() + appointmentDuration(doctor, appointment) * 60000);
    return appointment.scheduledAt < endAt && existingEnd > scheduledAt;
  });
  if (conflict) throw new OperationError(409, 'This time overlaps another scheduled appointment for the doctor.');
}

export function appointmentMinuteReservations(doctorId, scheduledAt, durationMinutes, appointmentId) {
  const createdAt = new Date();
  return Array.from({ length: durationMinutes }, (_, minute) => ({
    doctorId,
    scheduledAt: new Date(scheduledAt.valueOf() + minute * 60000),
    appointmentId,
    createdAt,
  }));
}

function isDuplicateKey(error) {
  return error?.code === 11000;
}

function throwAppointmentConflict(error) {
  if (isDuplicateKey(error)) throw new OperationError(409, 'This time overlaps another scheduled appointment for the doctor.');
  throw error;
}

export function parseObjectId(value, label = 'ID') {
  if (typeof value !== 'string' || !ObjectId.isValid(value)) {
    throw new OperationError(400, `${label} is invalid.`);
  }
  return new ObjectId(value);
}

export function pageOptions(query) {
  const page = Number.parseInt(query.page || '1', 10);
  const limit = Number.parseInt(query.limit || '20', 10);
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new OperationError(400, 'Page must be positive and page size must be between 1 and 100.');
  }
  return { page, limit, skip: (page - 1) * limit };
}

function safeSearch(value) {
  return typeof value === 'string'
    ? value.trim().slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    : '';
}

export async function audit(actor, action, entity, entityId, metadata = {}) {
  await getMongoDatabase().collection('audit_logs').insertOne({
    actorId: actor.id,
    actorName: actor.name,
    action,
    entity,
    entityId: String(entityId),
    metadata,
    createdAt: new Date(),
  });
}

export async function ensureAdminIndexes() {
  const db = getMongoDatabase();
  await Promise.all([
    db.collection('users').createIndex({ email: 1 }, { unique: true }),
    db.collection('patients').createIndex({ userId: 1 }, { unique: true }),
    db.collection('doctors').createIndex({ userId: 1 }, { unique: true }),
    db.collection('appointments').createIndex({ patientId: 1, scheduledAt: 1 }),
    db.collection('appointments').createIndex({ doctorId: 1, scheduledAt: 1, status: 1 }),
    db.collection('appointment_slots').createIndex({ doctorId: 1, scheduledAt: 1 }, { unique: true }),
    db.collection('audit_logs').createIndex({ createdAt: -1 }),
  ]);
}

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function requireText(value, label, max = 120) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw new OperationError(400, `${label} is required and must be no longer than ${max} characters.`);
  }
  return value.trim();
}

function validEmail(value) {
  const email = normalizeEmail(value);
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new OperationError(400, 'Enter a valid email address.');
  }
  return email;
}

function safeUser(user) {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    role: user.role,
    isActive: user.isActive !== false,
    createdAt: user.createdAt,
  };
}

export async function createAccount({ name, email, password, role, details }) {
  if (!roles.has(role) || role === 'admin') throw new OperationError(400, 'This account role cannot be created here.');
  if (typeof password !== 'string' || password.length < 10 || password.length > 128) {
    throw new OperationError(400, 'Set an initial password between 10 and 128 characters.');
  }

  const db = getMongoDatabase();
  const now = new Date();
  const user = {
    name,
    email,
    role,
    passwordHash: await bcrypt.hash(password, 12),
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };
  const result = await db.collection('users').insertOne(user);

  try {
    const profile = {
      ...details,
      userId: result.insertedId,
      name,
      email,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };
    const profileResult = await db.collection(role === 'patient' ? 'patients' : 'doctors').insertOne(profile);
    profile._id = profileResult.insertedId;
    return { user: { ...user, _id: result.insertedId }, profile };
  } catch (error) {
    await db.collection('users').deleteOne({ _id: result.insertedId });
    throw error;
  }
}

async function syncAppointmentToGraph(appointment, patient, doctor) {
  const driver = getNeo4jDriver();
  if (!driver) throw new Error('Neo4j driver is unavailable.');
  const session = driver.session({ database: env.neo4jDatabase || 'neo4j' });

  try {
    await session.executeWrite((tx) => tx.run(
      `MERGE (p:Patient {patient_id: $patientId})
       ON CREATE SET p.name = $patientName
       SET p.name = $patientName
       MERGE (d:Doctor {doctor_id: $doctorId})
       ON CREATE SET d.name = $doctorName
       SET d.name = $doctorName
       MERGE (a:Appointment {appointment_id: $appointmentId})
       SET a.scheduled_at = $scheduledAt, a.status = $status
       WITH p, d, a
       OPTIONAL MATCH (oldPatient:Patient)-[oldBooked:BOOKED]->(a)
       DELETE oldBooked
       WITH p, d, a
       OPTIONAL MATCH (a)-[oldDoctor:WITH_DOCTOR]->(:Doctor)
       DELETE oldDoctor
       WITH p, d, a
       MERGE (p)-[:BOOKED]->(a)
       MERGE (a)-[:WITH_DOCTOR]->(d)
       FOREACH (_ IN CASE WHEN $status = 'completed' THEN [1] ELSE [] END |
         MERGE (p)-[:CONSULTED_DOCTOR]->(d)
       )`,
      {
        patientId: appointment.patientId,
        patientName: patient.name,
        doctorId: appointment.doctorId,
        doctorName: doctor.name,
        appointmentId: appointment.appointmentId,
        scheduledAt: appointment.scheduledAt.toISOString(),
        status: appointment.status,
      },
    ));
  } finally {
    await session.close();
  }
}

async function syncAndRecord(appointment, patient, doctor) {
  const appointments = getMongoDatabase().collection('appointments');
  try {
    await syncAppointmentToGraph(appointment, patient, doctor);
    await appointments.updateOne(
      { _id: appointment._id },
      { $set: { graphSync: { status: 'synced', updatedAt: new Date(), error: null } } },
    );
    return true;
  } catch (error) {
    await appointments.updateOne(
      { _id: appointment._id },
      { $set: { graphSync: { status: 'failed', updatedAt: new Date(), error: 'Graph synchronization failed.' } } },
    );
    console.error('[admin:graph-sync]', 'Appointment synchronization failed.');
    return false;
  }
}

async function countLinkedProfiles(profileCollection, role, { activeOnly = false, from, to } = {}) {
  const pipeline = [
    { $lookup: { from: 'users', localField: 'userId', foreignField: '_id', as: 'account' } },
    { $unwind: '$account' },
    { $match: { 'account.role': role } },
  ];
  if (activeOnly) {
    pipeline.push({ $match: { isActive: true, 'account.isActive': true } });
  }
  if (from || to) {
    pipeline.push({ $addFields: { linkedCreatedAt: { $ifNull: ['$createdAt', '$account.createdAt'] } } });
    pipeline.push({ $match: { linkedCreatedAt: { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) } } });
  }
  pipeline.push({ $count: 'count' });
  const [result] = await getMongoDatabase().collection(profileCollection).aggregate(pipeline).toArray();
  return result?.count || 0;
}

export async function getAdminDashboard(fromDate, toDate) {
  const db = getMongoDatabase();
  const now = new Date();
  const start = fromDate ? new Date(fromDate) : new Date(now.getTime() - 29 * 86400000);
  const end = toDate ? new Date(toDate) : now;
  if (Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf()) || start > end) {
    throw new OperationError(400, 'Date range is invalid.');
  }
  const todayStart = new Date(now); todayStart.setUTCHours(0, 0, 0, 0);
  const tomorrow = new Date(todayStart); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const [totalPatients, recentPatients, activeDoctors, todayAppointments, upcomingAppointments, statusCounts, trend, schedule, recentActivity, graphFailures] = await Promise.all([
    countLinkedProfiles('patients', 'patient'),
    countLinkedProfiles('patients', 'patient', { from: start, to: end }),
    countLinkedProfiles('doctors', 'doctor', { activeOnly: true }),
    db.collection('appointments').countDocuments({ scheduledAt: { $gte: todayStart, $lt: tomorrow }, status: { $ne: 'cancelled' } }),
    db.collection('appointments').countDocuments({ scheduledAt: { $gte: now }, status: 'scheduled' }),
    db.collection('appointments').aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]).toArray(),
    db.collection('appointments').aggregate([
      { $match: { scheduledAt: { $gte: start, $lte: end } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$scheduledAt', timezone: allowedTimeZone } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]).toArray(),
    db.collection('appointments').aggregate([
      { $match: { scheduledAt: { $gte: todayStart, $lt: tomorrow } } },
      { $sort: { scheduledAt: 1 } },
      { $limit: 20 },
      { $lookup: { from: 'patients', let: { id: '$patientId' }, pipeline: [{ $match: { $expr: { $eq: [{ $toString: '$userId' }, '$$id'] } } }, { $project: { name: 1 } }], as: 'patient' } },
      { $lookup: { from: 'doctors', let: { id: '$doctorId' }, pipeline: [{ $match: { $expr: { $eq: [{ $toString: '$userId' }, '$$id'] } } }, { $project: { name: 1, specialization: 1 } }], as: 'doctor' } },
      { $project: { appointmentId: 1, scheduledAt: 1, status: 1, reason: 1, patientName: { $arrayElemAt: ['$patient.name', 0] }, doctorName: { $arrayElemAt: ['$doctor.name', 0] }, specialization: { $arrayElemAt: ['$doctor.specialization', 0] } } },
    ]).toArray(),
    db.collection('audit_logs').find({}, { projection: { actorName: 1, action: 1, entity: 1, entityId: 1, createdAt: 1 } }).sort({ createdAt: -1 }).limit(8).toArray(),
    db.collection('appointments').countDocuments({ 'graphSync.status': 'failed' }),
  ]);

  const statuses = { scheduled: 0, completed: 0, cancelled: 0 };
  for (const entry of statusCounts) if (entry._id in statuses) statuses[entry._id] = entry.count;
  return {
    generatedAt: now.toISOString(),
    period: { from: start.toISOString(), to: end.toISOString() },
    metrics: { totalPatients, newPatients: recentPatients, activeDoctors, todayAppointments, upcomingAppointments, appointmentsByStatus: statuses },
    trend: trend.map((item) => ({ date: item._id, count: item.count })),
    todaySchedule: schedule,
    recentActivity,
    alerts: { unsyncedAppointments: graphFailures },
  };
}

export async function listPatients(query) {
  const db = getMongoDatabase();
  const { page, limit, skip } = pageOptions(query);
  const accounts = await db.collection('users').find({ role: 'patient' }, {
    projection: { _id: 1, name: 1, email: 1, isActive: 1, createdAt: 1, updatedAt: 1 },
  }).toArray();
  const accountsById = new Map(accounts.map((account) => [account._id.toString(), account]));
  if (!accounts.length) return { items: [], page, limit, total: 0, pages: 0 };
  const filter = { userId: { $in: accounts.map((account) => account._id) } };
  const search = safeSearch(query.search);
  if (search) {
    const expression = { $regex: search, $options: 'i' };
    const matchingUsers = accounts.filter((account) => new RegExp(search, 'i').test(account.name || '') || new RegExp(search, 'i').test(account.email || ''));
    filter.$and = [{
      $or: [
        { name: expression },
        { email: expression },
        { patientId: expression },
        { userId: { $in: matchingUsers.map((account) => account._id) } },
      ],
    }];
  }
  const [items, total] = await Promise.all([
    db.collection('patients').find(filter, { projection: { medicalHistory: 0, records: 0, passwordHash: 0 } }).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(),
    db.collection('patients').countDocuments(filter),
  ]);
  return {
    items: items.map((item) => {
      const account = accountsById.get(item.userId?.toString());
      return {
        _id: item._id.toString(),
        userId: item.userId?.toString(),
        patientId: item.patientId,
        name: account?.name || item.name || '',
        email: account?.email || item.email || '',
        phone: item.phone || '',
        isActive: item.isActive === true && account?.isActive === true,
        createdAt: item.createdAt || account?.createdAt,
        updatedAt: item.updatedAt || account?.updatedAt,
      };
    }),
    page, limit, total, pages: Math.ceil(total / limit),
  };
}

export async function listDoctors(query) {
  const db = getMongoDatabase();
  const { page, limit, skip } = pageOptions(query);
  const accounts = await db.collection('users').find({ role: 'doctor' }, {
    projection: { _id: 1, name: 1, email: 1, isActive: 1, createdAt: 1, updatedAt: 1 },
  }).toArray();
  const accountsById = new Map(accounts.map((account) => [account._id.toString(), account]));
  if (!accounts.length) return { items: [], page, limit, total: 0, pages: 0 };
  const filter = { userId: { $in: accounts.map((account) => account._id) } };
  const and = [];
  if (query.status === 'active') {
    filter.userId = { $in: accounts.filter((account) => account.isActive === true).map((account) => account._id) };
    filter.isActive = true;
  }
  if (query.status === 'inactive') {
    and.push({ $or: [
      { isActive: { $ne: true } },
      { userId: { $in: accounts.filter((account) => account.isActive !== true).map((account) => account._id) } },
    ] });
  }
  if (query.specialization) filter.specialization = String(query.specialization).slice(0, 100);
  const search = safeSearch(query.search);
  if (search) {
    const expression = { $regex: search, $options: 'i' };
    const matchingUsers = accounts.filter((account) => new RegExp(search, 'i').test(account.name || '') || new RegExp(search, 'i').test(account.email || ''));
    and.push({
      $or: [
        ...['name', 'email', 'doctorId', 'specialization', 'department'].map((field) => ({ [field]: expression })),
        { userId: { $in: matchingUsers.map((account) => account._id) } },
      ],
    });
  }
  if (and.length) filter.$and = and;
  const [items, total] = await Promise.all([
    db.collection('doctors').find(filter, { projection: { password: 0, passwordHash: 0, medicalHistory: 0 } }).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(),
    db.collection('doctors').countDocuments(filter),
  ]);
  return {
    items: items.map((item) => {
      const account = accountsById.get(item.userId?.toString());
      return {
        _id: item._id.toString(),
        userId: item.userId?.toString(),
        doctorId: item.doctorId,
        name: account?.name || item.name || '',
        email: account?.email || item.email || '',
        phone: item.phone || '',
        specialization: item.specialization || '',
        department: item.department || '',
        qualifications: item.qualifications || '',
        isActive: item.isActive === true && account?.isActive === true,
        createdAt: item.createdAt || account?.createdAt,
        updatedAt: item.updatedAt || account?.updatedAt,
      };
    }),
    page, limit, total, pages: Math.ceil(total / limit),
  };
}

export async function listAppointments(query) {
  const db = getMongoDatabase();
  const { page, limit, skip } = pageOptions(query);
  const filter = {};
  if (query.search) {
    const safeSearch = String(query.search).trim().slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const expression = { $regex: safeSearch, $options: 'i' };
    const [patientMatches, doctorMatches] = await Promise.all([
      db.collection('patients').find(
        { $or: [{ name: expression }, { email: expression }, { patientId: expression }] },
        { projection: { userId: 1 } },
      ).toArray(),
      db.collection('doctors').find(
        { $or: [{ name: expression }, { email: expression }, { specialization: expression }, { department: expression }] },
        { projection: { userId: 1 } },
      ).toArray(),
    ]);
    filter.$or = [
      { appointmentId: expression },
      { patientId: { $in: patientMatches.map((item) => item.userId?.toString()).filter(Boolean) } },
      { doctorId: { $in: doctorMatches.map((item) => item.userId?.toString()).filter(Boolean) } },
    ];
  }
  if (query.status && query.status !== 'all') {
    if (!appointmentStatuses.has(query.status)) throw new OperationError(400, 'Appointment status is invalid.');
    filter.status = query.status;
  }
  if (query.from || query.to) {
    const range = {};
    if (query.from) { const from = new Date(query.from); if (Number.isNaN(from.valueOf())) throw new OperationError(400, 'Start date is invalid.'); range.$gte = from; }
    if (query.to) { const to = new Date(query.to); if (Number.isNaN(to.valueOf())) throw new OperationError(400, 'End date is invalid.'); range.$lte = to; }
    filter.scheduledAt = range;
  }
  const [rows, total] = await Promise.all([
    db.collection('appointments').find(filter).sort({ scheduledAt: -1 }).skip(skip).limit(limit).toArray(),
    db.collection('appointments').countDocuments(filter),
  ]);
  const patientIds = [...new Set(rows.map((row) => row.patientId))].filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id));
  const doctorIds = [...new Set(rows.map((row) => row.doctorId))].filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id));
  const [patients, doctors] = await Promise.all([
    db.collection('patients').find({ userId: { $in: patientIds } }, { projection: { userId: 1, name: 1 } }).toArray(),
    db.collection('doctors').find({ userId: { $in: doctorIds } }, { projection: { userId: 1, name: 1, specialization: 1 } }).toArray(),
  ]);
  const patientNames = new Map(patients.map((item) => [item.userId.toString(), item.name]));
  const doctorNames = new Map(doctors.map((item) => [item.userId.toString(), { name: item.name, specialization: item.specialization }]));
  const items = rows.map((item) => ({
    id: item._id.toString(),
    appointmentId: item.appointmentId,
    patientId: item.patientId,
    patientName: patientNames.get(item.patientId) || 'Patient',
    doctorId: item.doctorId,
    doctorName: doctorNames.get(item.doctorId)?.name || 'Doctor',
    specialization: doctorNames.get(item.doctorId)?.specialization || '',
    scheduledAt: item.scheduledAt,
    reason: item.reason,
    status: item.status,
    graphSync: item.graphSync?.status || 'pending',
  }));
  return { items, page, limit, total, pages: Math.ceil(total / limit) };
}

export async function getAppointmentReferences(patientId, doctorId, scheduledAt, exceptId, durationMinutes, session) {
  const db = getMongoDatabase();
  const patientUserId = new ObjectId(patientId);
  const doctorUserId = new ObjectId(doctorId);
  const [patient, doctor, patientAccount, doctorAccount] = await Promise.all([
    db.collection('patients').findOne({ userId: patientUserId, isActive: { $ne: false } }, { session }),
    db.collection('doctors').findOne({ userId: doctorUserId, isActive: true }, { session }),
    db.collection('users').findOne({ _id: patientUserId, role: 'patient', isActive: { $ne: false } }, { projection: { _id: 1 }, session }),
    db.collection('users').findOne({ _id: doctorUserId, role: 'doctor', isActive: true }, { projection: { _id: 1 }, session }),
  ]);
  if (!patient || !patientAccount) throw new OperationError(404, 'Active linked patient account was not found.');
  if (!doctor || !doctorAccount) throw new OperationError(404, 'Active linked doctor account was not found.');

  const slotTime = requireMinuteAlignedAppointmentTime(scheduledAt);
  if (Number.isNaN(slotTime.valueOf()) || slotTime <= new Date()) {
    throw new OperationError(400, 'Appointment date must be a valid future date and time.');
  }
  if (!Array.isArray(doctor.availability) || doctor.availability.length === 0) {
    throw new OperationError(409, 'This doctor has not configured availability. Ask them to save a schedule before booking.');
  }
  const duration = durationMinutes || appointmentDuration(doctor);
  if (!fitsDoctorAvailability(doctor.availability, doctor.availabilityTimeZone || 'UTC', slotTime, duration)) {
    throw new OperationError(409, 'This appointment does not fit within the doctor’s saved availability or break periods.');
  }
  await assertNoAppointmentOverlap(db, doctorId, slotTime, duration, exceptId, session, doctor);
  if (session) {
    await db.collection('doctors').updateOne({ _id: doctor._id }, { $inc: { appointmentScheduleRevision: 1 } }, { session });
  }
  return { patient, doctor, scheduledAt: slotTime, durationMinutes: duration };
}

export async function createAppointment(actor, input) {
  const db = getMongoDatabase();
  const patientId = parseObjectId(input.patientId, 'Patient ID').toString();
  const doctorId = parseObjectId(input.doctorId, 'Doctor ID').toString();
  const reason = requireText(input.reason, 'Reason', 500);
  const scheduledAt = requireMinuteAlignedAppointmentTime(input.scheduledAt);
  await ensureAdminIndexes();
  const appointmentId = `APT-${randomUUID()}`;
  let appointment;
  let patient;
  let doctor;
  const session = getMongoClient().startSession();
  try {
    await session.withTransaction(async () => {
      const references = await getAppointmentReferences(patientId, doctorId, scheduledAt, null, null, session);
      patient = references.patient;
      doctor = references.doctor;
      const { durationMinutes } = references;
      await db.collection('appointment_slots').insertMany(
        appointmentMinuteReservations(doctorId, scheduledAt, durationMinutes, appointmentId),
        { session, ordered: true },
      );
      appointment = {
        appointmentId,
        patientId,
        doctorId,
        scheduledAt,
        durationMinutes,
        reason,
        status: 'scheduled',
        graphSync: { status: 'pending', updatedAt: new Date(), error: null },
        createdBy: actor.id,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const inserted = await db.collection('appointments').insertOne(appointment, { session });
      appointment._id = inserted.insertedId;
    });
  } catch (error) {
    throwAppointmentConflict(error);
  } finally {
    await session.endSession();
  }

  const synced = await syncAndRecord(appointment, patient, doctor);
  await audit(actor, 'appointment.created', 'appointment', appointmentId, { graphSync: synced ? 'synced' : 'failed' });
  return { appointment: { ...appointment, id: appointment._id.toString() }, graphSync: synced ? 'synced' : 'failed' };
}

export async function updateAppointment(actor, id, input) {
  const db = getMongoDatabase();
  const _id = parseObjectId(id, 'Appointment ID');
  const appointments = db.collection('appointments');
  const appointment = await appointments.findOne({ _id });
  if (!appointment) throw new OperationError(404, 'Appointment was not found.');
  if (appointment.status === 'cancelled') throw new OperationError(409, 'Cancelled appointments cannot be changed.');

  const patientId = input.patientId ? parseObjectId(input.patientId, 'Patient ID').toString() : appointment.patientId;
  const doctorId = input.doctorId ? parseObjectId(input.doctorId, 'Doctor ID').toString() : appointment.doctorId;
  const requestedTime = input.scheduledAt || appointment.scheduledAt.toISOString();
  const reason = input.reason === undefined ? appointment.reason : requireText(input.reason, 'Reason', 500);
  const scheduledAt = requireMinuteAlignedAppointmentTime(requestedTime);
  const movedSlot = doctorId !== appointment.doctorId || scheduledAt.valueOf() !== appointment.scheduledAt.valueOf();
  const updated = { ...appointment, patientId, doctorId, scheduledAt, reason, updatedAt: new Date() };
  let patient;
  let doctor;
  const session = getMongoClient().startSession();
  try {
    await session.withTransaction(async () => {
      const references = await getAppointmentReferences(patientId, doctorId, scheduledAt, _id, appointment.durationMinutes || null, session);
      patient = references.patient;
      doctor = references.doctor;
      const durationMinutes = references.durationMinutes;
      if (movedSlot) {
        await db.collection('appointment_slots').deleteMany({ appointmentId: appointment.appointmentId }, { session });
        await db.collection('appointment_slots').insertMany(
          appointmentMinuteReservations(doctorId, scheduledAt, durationMinutes, appointment.appointmentId),
          { session, ordered: true },
        );
      }
      const result = await appointments.updateOne(
        { _id, updatedAt: appointment.updatedAt, status: { $ne: 'cancelled' } },
        { $set: { patientId, doctorId, scheduledAt, durationMinutes, reason, updatedAt: updated.updatedAt, graphSync: { status: 'pending', updatedAt: new Date(), error: null } } },
        { session },
      );
      if (!result.modifiedCount) throw new OperationError(409, 'This appointment changed during your update. Refresh and try again.');
      updated.durationMinutes = durationMinutes;
    });
  } catch (error) {
    throwAppointmentConflict(error);
  } finally {
    await session.endSession();
  }

  const synced = await syncAndRecord(updated, patient, doctor);
  await audit(actor, 'appointment.updated', 'appointment', appointment.appointmentId, { graphSync: synced ? 'synced' : 'failed' });
  return { appointment: updated, graphSync: synced ? 'synced' : 'failed' };
}

export async function changeAppointmentStatus(actor, id, status, { patientId } = {}) {
  if (!appointmentStatuses.has(status)) throw new OperationError(400, 'Appointment status is invalid.');
  const db = getMongoDatabase();
  const _id = parseObjectId(id, 'Appointment ID');
  const appointmentFilter = { _id, ...(patientId ? { patientId } : {}) };
  const appointment = await db.collection('appointments').findOne(appointmentFilter);
  if (!appointment) throw new OperationError(404, 'Appointment was not found.');
  if (appointment.status !== 'scheduled' && appointment.status !== status) {
    throw new OperationError(409, 'Completed or cancelled appointments cannot be reopened.');
  }

  const result = await db.collection('appointments').updateOne(
    { ...appointmentFilter, updatedAt: appointment.updatedAt },
    { $set: { status, updatedAt: new Date(), graphSync: { status: 'pending', updatedAt: new Date(), error: null } } },
  );
  if (!result.modifiedCount) throw new OperationError(409, 'This appointment changed during your update. Refresh and try again.');
  if (status !== 'scheduled') await db.collection('appointment_slots').deleteMany({ appointmentId: appointment.appointmentId });
  const patient = await db.collection('patients').findOne({ userId: new ObjectId(appointment.patientId) });
  const doctor = await db.collection('doctors').findOne({ userId: new ObjectId(appointment.doctorId) });
  const updated = { ...appointment, status };
  const synced = patient && doctor ? await syncAndRecord(updated, patient, doctor) : false;
  if (!patient || !doctor) await db.collection('appointments').updateOne({ _id }, { $set: { graphSync: { status: 'failed', updatedAt: new Date(), error: 'Related account is missing.' } } });
  await audit(actor, `appointment.${status}`, 'appointment', appointment.appointmentId, { graphSync: synced ? 'synced' : 'failed' });
  return { graphSync: synced ? 'synced' : 'failed' };
}

export async function queryGraph({ search = '', limit = 100 }) {
  const driver = getNeo4jDriver();
  if (!driver) throw new OperationError(503, 'Graph database is not available.');
  const session = driver.session({ database: env.neo4jDatabase || 'neo4j' });
  const safeLimit = neo4j.int(Math.max(1, Math.min(200, Math.trunc(Number(limit) || 100))));
  const safeSearch = String(search).trim().slice(0, 100);
  try {
    const result = await session.run(
      `MATCH (p:Patient)-[booked:BOOKED]->(a:Appointment)-[withDoctor:WITH_DOCTOR]->(d:Doctor)
       WHERE $search = '' OR toLower(coalesce(p.name, '') + ' ' + coalesce(p.patient_id, '') + ' ' + coalesce(d.name, '') + ' ' + coalesce(d.doctor_id, '') + ' ' + coalesce(a.appointment_id, '')) CONTAINS toLower($search)
       OPTIONAL MATCH (p)-[consulted:CONSULTED_DOCTOR]->(d)
       RETURN p.patient_id AS patientId, p.name AS patientName, a.appointment_id AS appointmentId,
              a.scheduled_at AS scheduledAt, a.status AS status, d.doctor_id AS doctorId, d.name AS doctorName,
              count(consulted) > 0 AS consulted
       ORDER BY a.scheduled_at DESC LIMIT $limit`,
      { search: safeSearch, limit: safeLimit },
    );
    return result.records.map((record) => ({
      patientId: record.get('patientId'),
      patientName: record.get('patientName'),
      appointmentId: record.get('appointmentId'),
      scheduledAt: record.get('scheduledAt'),
      status: record.get('status'),
      doctorId: record.get('doctorId'),
      doctorName: record.get('doctorName'),
      consulted: record.get('consulted'),
    }));
  } finally {
    await session.close();
  }
}

export async function reconcileGraph(actor) {
  const db = getMongoDatabase();
  const failed = await db.collection('appointments').find({ 'graphSync.status': { $ne: 'synced' } }).limit(100).toArray();
  let synced = 0;
  let failedCount = 0;
  for (const appointment of failed) {
    const [patient, doctor] = await Promise.all([
      db.collection('patients').findOne({ userId: new ObjectId(appointment.patientId) }),
      db.collection('doctors').findOne({ userId: new ObjectId(appointment.doctorId) }),
    ]);
    if (!patient || !doctor || !(await syncAndRecord(appointment, patient, doctor))) failedCount += 1;
    else synced += 1;
  }
  await audit(actor, 'relationships.reconciled', 'appointment', 'batch', { synced, failed: failedCount });
  return { examined: failed.length, synced, failed: failedCount };
}

export async function appointmentReport(from, to) {
  const start = new Date(from);
  const end = new Date(to);
  if (Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf()) || start > end || end - start > 366 * 86400000) {
    throw new OperationError(400, 'Select a valid report range of no more than 366 days.');
  }
  const db = getMongoDatabase();
  const [byStatus, byDate, byDoctor, patientRegistrations] = await Promise.all([
    db.collection('appointments').aggregate([{ $match: { scheduledAt: { $gte: start, $lte: end } } }, { $group: { _id: '$status', count: { $sum: 1 } } }]).toArray(),
    db.collection('appointments').aggregate([{ $match: { scheduledAt: { $gte: start, $lte: end } } }, { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$scheduledAt', timezone: allowedTimeZone } }, count: { $sum: 1 } } }, { $sort: { _id: 1 } }]).toArray(),
    db.collection('appointments').aggregate([{ $match: { scheduledAt: { $gte: start, $lte: end } } }, { $group: { _id: '$doctorId', count: { $sum: 1 }, cancelled: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } } } }, { $sort: { count: -1 } }, { $limit: 50 }]).toArray(),
    countLinkedProfiles('patients', 'patient', { from: start, to: end }),
  ]);
  const doctorIds = byDoctor.map((item) => item._id).filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id));
  const doctors = doctorIds.length
    ? await db.collection('doctors').find({ userId: { $in: doctorIds } }, { projection: { userId: 1, name: 1 } }).toArray()
    : [];
  const doctorNames = new Map(doctors.map((doctor) => [doctor.userId.toString(), doctor.name]));
  return {
    range: { from: start.toISOString(), to: end.toISOString() },
    appointmentsByStatus: Object.fromEntries(byStatus.map((item) => [item._id || 'unknown', item.count])),
    appointmentsByDate: byDate.map((item) => ({ date: item._id, count: item.count })),
    doctorWorkload: byDoctor.map((item) => ({ doctorId: item._id, doctorName: doctorNames.get(item._id) || 'Doctor', appointments: item.count, cancellations: item.cancelled })),
    newPatientRegistrations: patientRegistrations,
  };
}
