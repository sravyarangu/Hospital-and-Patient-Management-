import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { env } from '../config/env.js';
import { getMongoDatabase } from '../config/mongodb.js';
import requireAuth from '../middleware/requireAuth.js';
import requireRole from '../middleware/requireRole.js';
import {
  appointmentReport,
  audit,
  changeAppointmentStatus,
  createAccount,
  createAppointment,
  ensureAdminIndexes,
  getAdminDashboard,
  listAppointments,
  listDoctors,
  listPatients,
  OperationError,
  pageOptions,
  parseObjectId,
  queryGraph,
  reconcileGraph,
  updateAppointment,
} from '../services/adminOperations.service.js';

const router = Router();
router.use(requireAuth, requireRole('admin'));

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function patientProfileInput(body, required = true) {
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const phone = typeof body?.phone === 'string' ? body.phone.trim() : '';
  if (required && (name.length < 2 || name.length > 100)) throw new OperationError(400, 'Name must be between 2 and 100 characters.');
  if (required && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)) throw new OperationError(400, 'Enter a valid email address.');
  if (phone.length > 40) throw new OperationError(400, 'Phone number is too long.');
  return { name, email, phone };
}

function doctorProfileInput(body, required = true) {
  const base = patientProfileInput(body, required);
  const specialization = typeof body?.specialization === 'string' ? body.specialization.trim() : '';
  const department = typeof body?.department === 'string' ? body.department.trim() : '';
  if (required && !specialization) throw new OperationError(400, 'Specialization is required.');
  if (required && !department) throw new OperationError(400, 'Department is required.');
  if (specialization.length > 100 || department.length > 100) throw new OperationError(400, 'Specialization and department must be at most 100 characters.');
  return { ...base, specialization, department };
}

router.get('/dashboard', asyncRoute(async (req, res) => {
  const data = await getAdminDashboard(req.query.from, req.query.to);
  res.json(data);
}));

router.get('/patients', asyncRoute(async (req, res) => {
  await ensureAdminIndexes();
  res.json(await listPatients(req.query));
}));

router.post('/patients', asyncRoute(async (req, res) => {
  await ensureAdminIndexes();
  const profile = patientProfileInput(req.body);
  const password = req.body?.temporaryPassword;
  const created = await createAccount({ ...profile, password, role: 'patient', details: { phone: profile.phone } });
  await audit(req.user, 'patient.created', 'patient', created.user._id.toString());
  res.status(201).json({ patient: { id: created.profile._id.toString(), userId: created.user._id.toString(), name: created.profile.name, email: created.profile.email, phone: created.profile.phone, isActive: true, createdAt: created.profile.createdAt } });
}));

router.get('/patients/:id', asyncRoute(async (req, res) => {
  const id = parseObjectId(req.params.id, 'Patient ID');
  const db = getMongoDatabase();
  const patient = await db.collection('patients').findOne({ $or: [{ _id: id }, { userId: id }] }, { projection: { medicalHistory: 0, records: 0 } });
  if (!patient) throw new OperationError(404, 'Patient was not found.');
  const user = patient.userId ? await db.collection('users').findOne({ _id: patient.userId }, { projection: { isActive: 1 } }) : null;
  const appointments = await db.collection('appointments').find({ patientId: patient.userId?.toString() || id.toString() }).sort({ scheduledAt: -1 }).limit(50).project({ appointmentId: 1, scheduledAt: 1, status: 1, reason: 1, doctorId: 1 }).toArray();
  res.json({ patient: { ...patient, id: patient._id.toString(), userId: patient.userId?.toString(), isActive: user?.isActive !== false && patient.isActive !== false }, appointments: appointments.map((item) => ({ ...item, id: item._id.toString() })) });
}));

router.patch('/patients/:id', asyncRoute(async (req, res) => {
  const id = parseObjectId(req.params.id, 'Patient ID');
  const db = getMongoDatabase();
  const patient = await db.collection('patients').findOne({ $or: [{ _id: id }, { userId: id }] });
  if (!patient) throw new OperationError(404, 'Patient was not found.');
  const changes = {};
  if (req.body?.name !== undefined) changes.name = patientProfileInput({ ...patient, ...req.body }, false).name || patient.name;
  if (req.body?.phone !== undefined) changes.phone = patientProfileInput({ ...patient, ...req.body }, false).phone;
  if (req.body?.email !== undefined) {
    const email = patientProfileInput({ ...patient, ...req.body }, false).email;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new OperationError(400, 'Enter a valid email address.');
    const duplicate = await db.collection('users').findOne({ email, _id: { $ne: patient.userId } }, { projection: { _id: 1 } });
    if (duplicate) throw new OperationError(409, 'An account with this email already exists.');
    changes.email = email;
  }
  if (req.body?.isActive !== undefined) {
    if (typeof req.body.isActive !== 'boolean') throw new OperationError(400, 'isActive must be a boolean.');
    changes.isActive = req.body.isActive;
  }
  if (!Object.keys(changes).length) throw new OperationError(400, 'Provide at least one editable patient field.');
  if (changes.name && changes.name.length < 2) throw new OperationError(400, 'Name must be at least 2 characters.');
  changes.updatedAt = new Date();
  await db.collection('patients').updateOne({ _id: patient._id }, { $set: changes });
  if (patient.userId) {
    const userChanges = {};
    if (changes.name) userChanges.name = changes.name;
    if (changes.email) userChanges.email = changes.email;
    if (changes.isActive !== undefined) userChanges.isActive = changes.isActive;
    userChanges.updatedAt = changes.updatedAt;
    await db.collection('users').updateOne({ _id: patient.userId }, { $set: userChanges });
  }
  const action = changes.isActive === false ? 'patient.deactivated' : changes.isActive === true ? 'patient.activated' : 'patient.updated';
  await audit(req.user, action, 'patient', patient._id.toString(), { fields: Object.keys(changes).filter((key) => key !== 'updatedAt') });
  res.json({ patient: { id: patient._id.toString(), userId: patient.userId?.toString(), ...changes } });
}));

router.get('/doctors', asyncRoute(async (req, res) => {
  await ensureAdminIndexes();
  res.json(await listDoctors(req.query));
}));

router.post('/doctors', asyncRoute(async (req, res) => {
  await ensureAdminIndexes();
  const profile = doctorProfileInput(req.body);
  const created = await createAccount({ ...profile, password: req.body?.temporaryPassword, role: 'doctor', details: { phone: profile.phone, specialization: profile.specialization, department: profile.department } });
  await audit(req.user, 'doctor.created', 'doctor', created.user._id.toString());
  res.status(201).json({ doctor: { id: created.profile._id.toString(), userId: created.user._id.toString(), name: created.profile.name, email: created.profile.email, phone: created.profile.phone, specialization: created.profile.specialization, department: created.profile.department, isActive: true, createdAt: created.profile.createdAt } });
}));

router.patch('/doctors/:id', asyncRoute(async (req, res) => {
  const id = parseObjectId(req.params.id, 'Doctor ID');
  const db = getMongoDatabase();
  const doctor = await db.collection('doctors').findOne({ $or: [{ _id: id }, { userId: id }] });
  if (!doctor) throw new OperationError(404, 'Doctor was not found.');
  const changes = {};
  for (const key of ['name', 'email', 'phone', 'specialization', 'department']) {
    if (req.body?.[key] !== undefined) changes[key] = req.body[key];
  }
  const validated = doctorProfileInput({ ...doctor, ...changes }, false);
  if (changes.name !== undefined && validated.name.length < 2) throw new OperationError(400, 'Name must be at least 2 characters.');
  if (changes.email !== undefined) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(validated.email) || validated.email.length > 254) throw new OperationError(400, 'Enter a valid email address.');
    if (await db.collection('users').findOne({ email: validated.email, _id: { $ne: doctor.userId } }, { projection: { _id: 1 } })) throw new OperationError(409, 'An account with this email already exists.');
    changes.email = validated.email;
  }
  if (changes.specialization !== undefined && !changes.specialization.trim()) throw new OperationError(400, 'Specialization cannot be empty.');
  if (changes.department !== undefined && !changes.department.trim()) throw new OperationError(400, 'Department cannot be empty.');
  if (req.body?.isActive !== undefined) {
    if (typeof req.body.isActive !== 'boolean') throw new OperationError(400, 'isActive must be a boolean.');
    changes.isActive = req.body.isActive;
  }
  if (!Object.keys(changes).length) throw new OperationError(400, 'Provide at least one editable doctor field.');
  changes.updatedAt = new Date();
  await db.collection('doctors').updateOne({ _id: doctor._id }, { $set: changes });
  if (doctor.userId) {
    const userChanges = { updatedAt: changes.updatedAt };
    for (const key of ['name', 'email', 'isActive']) if (changes[key] !== undefined) userChanges[key] = changes[key];
    await db.collection('users').updateOne({ _id: doctor.userId }, { $set: userChanges });
  }
  const action = changes.isActive === false ? 'doctor.deactivated' : changes.isActive === true ? 'doctor.activated' : 'doctor.updated';
  await audit(req.user, action, 'doctor', doctor._id.toString(), { fields: Object.keys(changes).filter((key) => key !== 'updatedAt') });
  res.json({ doctor: { id: doctor._id.toString(), userId: doctor.userId?.toString(), ...changes } });
}));

router.get('/appointments', asyncRoute(async (req, res) => {
  await ensureAdminIndexes();
  res.json(await listAppointments(req.query));
}));

router.post('/appointments', asyncRoute(async (req, res) => {
  const result = await createAppointment(req.user, req.body || {});
  res.status(result.graphSync === 'synced' ? 201 : 202).json({
    ...result,
    message: result.graphSync === 'synced'
      ? 'Appointment created and synchronized.'
      : 'Appointment saved in MongoDB, but graph synchronization failed. Retry reconciliation.',
  });
}));

router.patch('/appointments/:id', asyncRoute(async (req, res) => {
  const result = await updateAppointment(req.user, req.params.id, req.body || {});
  res.status(result.graphSync === 'synced' ? 200 : 202).json({
    ...result,
    message: result.graphSync === 'synced'
      ? 'Appointment updated and synchronized.'
      : 'Appointment updated in MongoDB, but graph synchronization failed. Retry reconciliation.',
  });
}));

router.patch('/appointments/:id/status', asyncRoute(async (req, res) => {
  const result = await changeAppointmentStatus(req.user, req.params.id, req.body?.status);
  res.status(result.graphSync === 'synced' ? 200 : 202).json({
    ...result,
    message: result.graphSync === 'synced'
      ? 'Appointment status updated and synchronized.'
      : 'Appointment status updated in MongoDB, but graph synchronization failed.',
  });
}));

router.get('/relationships/graph', asyncRoute(async (req, res) => {
  const rows = await queryGraph({ search: req.query.search, limit: req.query.limit });
  const failedSync = await getMongoDatabase().collection('appointments').countDocuments({ 'graphSync.status': 'failed' });
  res.json({
    nodes: [
      ...new Map(rows.map((row) => [row.patientId, { id: row.patientId, type: 'patient', name: row.patientName }])).values(),
      ...new Map(rows.map((row) => [row.doctorId, { id: row.doctorId, type: 'doctor', name: row.doctorName }])).values(),
      ...rows.map((row) => ({ id: row.appointmentId, type: 'appointment', name: row.appointmentId, scheduledAt: row.scheduledAt, status: row.status })),
    ],
    relationships: rows.flatMap((row) => [
      { from: row.patientId, to: row.appointmentId, type: 'BOOKED' },
      { from: row.appointmentId, to: row.doctorId, type: 'WITH_DOCTOR' },
      ...(row.consulted ? [{ from: row.patientId, to: row.doctorId, type: 'CONSULTED_DOCTOR' }] : []),
    ]),
    syncFailures: failedSync,
  });
}));

router.get('/relationships/patients/:patientId', asyncRoute(async (req, res) => {
  const id = parseObjectId(req.params.patientId, 'Patient ID').toString();
  res.json({ relationships: await queryGraph({ search: id, limit: 100 }) });
}));

router.get('/relationships/doctors/:doctorId', asyncRoute(async (req, res) => {
  const id = parseObjectId(req.params.doctorId, 'Doctor ID').toString();
  res.json({ relationships: await queryGraph({ search: id, limit: 100 }) });
}));

router.post('/relationships/reconcile', asyncRoute(async (req, res) => {
  const result = await reconcileGraph(req.user);
  res.status(result.failed ? 202 : 200).json(result);
}));

router.get('/reports/appointments', asyncRoute(async (req, res) => {
  const from = req.query.from || new Date(Date.now() - 29 * 86400000).toISOString();
  const to = req.query.to || new Date().toISOString();
  res.json(await appointmentReport(from, to));
}));

router.get('/reports/appointments.csv', asyncRoute(async (req, res) => {
  const from = req.query.from || new Date(Date.now() - 29 * 86400000).toISOString();
  const to = req.query.to || new Date().toISOString();
  const report = await appointmentReport(from, to);
  const lines = ['date,count,status'];
  lines.push(...report.appointmentsByDate.map((item) => `${item.date},${item.count},all`));
  for (const [status, count] of Object.entries(report.appointmentsByStatus)) lines.push(`range total,${count},${status}`);
  res.type('text/csv').attachment('medicare-appointment-report.csv').send(lines.join('\r\n'));
}));

router.get('/audit-logs', asyncRoute(async (req, res) => {
  const { page, limit, skip } = pageOptions(req.query);
  const db = getMongoDatabase();
  const [items, total] = await Promise.all([
    db.collection('audit_logs').find({}, { projection: { actorId: 1, actorName: 1, action: 1, entity: 1, entityId: 1, createdAt: 1 } }).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(),
    db.collection('audit_logs').countDocuments(),
  ]);
  res.json({ items: items.map((item) => ({ ...item, id: item._id.toString() })), page, limit, total, pages: Math.ceil(total / limit) });
}));

router.get('/settings', asyncRoute(async (req, res) => {
  const preference = await getMongoDatabase().collection('admin_settings').findOne({ key: 'hospital' });
  const user = await getMongoDatabase().collection('users').findOne({ _id: new ObjectId(req.user.id) }, { projection: { name: 1, email: 1 } });
  res.json({
    hospital: preference?.value || { name: 'MediCare' },
    administrator: { name: user?.name || req.user.name, email: user?.email || req.user.email },
    session: { expiresIn: '8 hours', cookieHttpOnly: true, secureCookie: env.nodeEnv === 'production' },
  });
}));

router.patch('/settings', asyncRoute(async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const hospitalName = typeof req.body?.hospitalName === 'string' ? req.body.hospitalName.trim() : '';
  if (name.length < 2 || name.length > 100) throw new OperationError(400, 'Administrator name must be between 2 and 100 characters.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new OperationError(400, 'Enter a valid administrator email.');
  if (hospitalName.length < 2 || hospitalName.length > 120) throw new OperationError(400, 'Hospital name must be between 2 and 120 characters.');
  const db = getMongoDatabase();
  if (await db.collection('users').findOne({ email, role: 'admin', _id: { $ne: new ObjectId(req.user.id) } }, { projection: { _id: 1 } })) {
    throw new OperationError(409, 'This administrator email is already in use.');
  }
  await db.collection('users').updateOne({ _id: new ObjectId(req.user.id) }, { $set: { name, email, updatedAt: new Date() } });
  await db.collection('admin_settings').updateOne(
    { key: 'hospital' },
    { $set: { value: { name: hospitalName }, updatedAt: new Date() }, $setOnInsert: { key: 'hospital' } },
    { upsert: true },
  );
  await audit(req.user, 'settings.updated', 'administrator', req.user.id, { fields: ['name', 'email', 'hospitalName'] });
  res.json({ message: 'Settings updated. Sign in again to refresh your account details.' });
}));

router.get('/departments', asyncRoute(async (req, res) => {
  const result = await getMongoDatabase().collection('doctors').aggregate([
    { $match: { isActive: { $ne: false }, department: { $type: 'string', $ne: '' } } },
    { $group: { _id: '$department', doctors: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]).toArray();
  res.json({ items: result.map((item) => ({ name: item._id, activeDoctors: item.doctors })) });
}));

router.use((error, req, res, next) => {
  if (error instanceof OperationError) {
    res.status(error.status).json({ error: true, message: error.message });
    return;
  }
  if (error?.code === 11000) {
    res.status(409).json({ error: true, message: 'A record with the same unique identifier already exists.' });
    return;
  }
  next(error);
});

export default router;
