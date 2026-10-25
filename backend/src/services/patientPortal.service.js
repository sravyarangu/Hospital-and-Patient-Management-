import { ObjectId } from 'mongodb';
import { env } from '../config/env.js';
import { getMongoClient, getMongoDatabase } from '../config/mongodb.js';
import {
  changeAppointmentStatus,
  createAppointment,
  OperationError,
  pageOptions,
} from './adminOperations.service.js';
import { getAvailableSlotsForDoctor } from './doctorWorkspace.service.js';

function parseId(value, label) {
  if (typeof value !== 'string' || !ObjectId.isValid(value)) {
    throw new OperationError(400, `${label} is invalid.`);
  }
  return new ObjectId(value);
}

function searchExpression(value) {
  return String(value || '').trim().slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function currentPatient(actor) {
  if (actor.role !== 'patient') throw new OperationError(403, 'A patient account is required.');
  const db = getMongoDatabase();
  const userId = parseId(actor.id, 'Account ID');
  const [user, profile] = await Promise.all([
    db.collection('users').findOne({ _id: userId, role: 'patient', isActive: { $ne: false } }, { projection: { passwordHash: 0 } }),
    db.collection('patients').findOne({ userId, isActive: { $ne: false } }),
  ]);
  if (!user) throw new OperationError(401, 'The patient account is inactive or unavailable.');
  if (!profile) throw new OperationError(404, 'A patient profile linked to this account was not found.');
  return { user, profile };
}

export async function getPatientProfile(actor) {
  const { user, profile } = await currentPatient(actor);
  return {
    profile: {
      id: profile._id.toString(),
      userId: user._id.toString(),
      name: profile.name || user.name,
      email: profile.email || user.email,
      phone: profile.phone || '',
      dateOfBirth: profile.dateOfBirth || profile.dob || '',
      bloodGroup: profile.bloodGroup || profile.blood || '',
      emergencyContact: profile.emergencyContact || '',
      isActive: profile.isActive !== false && user.isActive !== false,
      createdAt: profile.createdAt || user.createdAt,
    },
  };
}

export async function updatePatientProfile(actor, input) {
  const { user, profile } = await currentPatient(actor);
  const allowedFields = new Set(['name', 'email', 'phone', 'dateOfBirth', 'bloodGroup', 'emergencyContact']);
  if (!Object.keys(input).length || Object.keys(input).some((field) => !allowedFields.has(field))) {
    throw new OperationError(400, 'Provide valid profile fields to update.');
  }
  const changes = {};
  const accountChanges = {};
  if (input.name !== undefined) {
    if (typeof input.name !== 'string' || input.name.trim().length < 2 || input.name.trim().length > 100) {
      throw new OperationError(400, 'Name must be between 2 and 100 characters.');
    }
    changes.name = input.name.trim();
    accountChanges.name = changes.name;
  }
  if (input.email !== undefined) {
    if (typeof input.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim()) || input.email.trim().length > 254) {
      throw new OperationError(400, 'Enter a valid email address.');
    }
    changes.email = input.email.trim().toLowerCase();
    accountChanges.email = changes.email;
  }
  if (input.phone !== undefined) {
    if (typeof input.phone !== 'string' || input.phone.trim().length > 40) {
      throw new OperationError(400, 'Phone number must be no longer than 40 characters.');
    }
    changes.phone = input.phone.trim();
  }
  if (input.dateOfBirth !== undefined) {
    const parsedDate = typeof input.dateOfBirth === 'string' ? new Date(`${input.dateOfBirth}T00:00:00Z`) : null;
    if (typeof input.dateOfBirth !== 'string' || (input.dateOfBirth && (!/^\d{4}-\d{2}-\d{2}$/.test(input.dateOfBirth) || Number.isNaN(parsedDate.valueOf()) || parsedDate.toISOString().slice(0, 10) !== input.dateOfBirth))) {
      throw new OperationError(400, 'Date of birth must use YYYY-MM-DD format.');
    }
    changes.dateOfBirth = input.dateOfBirth;
  }
  if (input.bloodGroup !== undefined) {
    if (typeof input.bloodGroup !== 'string' || input.bloodGroup.length > 10) {
      throw new OperationError(400, 'Blood group is invalid.');
    }
    changes.bloodGroup = input.bloodGroup.trim();
  }
  if (input.emergencyContact !== undefined) {
    if (typeof input.emergencyContact !== 'string' || input.emergencyContact.trim().length > 120) {
      throw new OperationError(400, 'Emergency contact must be no longer than 120 characters.');
    }
    changes.emergencyContact = input.emergencyContact.trim();
  }
  const db = getMongoDatabase();
  if (changes.email && await db.collection('users').findOne({ email: changes.email, _id: { $ne: user._id } }, { projection: { _id: 1 } })) {
    throw new OperationError(409, 'An account with this email already exists.');
  }
  const now = new Date();
  changes.updatedAt = now;
  accountChanges.updatedAt = now;
  if (Object.keys(accountChanges).length > 1) {
    const session = getMongoClient().startSession();
    try {
      await session.withTransaction(async () => {
        const patientResult = await db.collection('patients').updateOne(
          { _id: profile._id, userId: user._id },
          { $set: changes },
          { session },
        );
        if (!patientResult.matchedCount) throw new OperationError(404, 'Patient profile is no longer available.');
        const accountResult = await db.collection('users').updateOne(
          { _id: user._id, role: 'patient', isActive: { $ne: false } },
          { $set: accountChanges },
          { session },
        );
        if (!accountResult.matchedCount) throw new OperationError(401, 'The patient account is inactive or unavailable.');
      });
    } catch (error) {
      if (error?.code === 11000 && changes.email) throw new OperationError(409, 'An account with this email already exists.');
      throw error;
    } finally {
      await session.endSession();
    }
  } else {
    const result = await db.collection('patients').updateOne(
      { _id: profile._id, userId: user._id },
      { $set: changes },
    );
    if (!result.matchedCount) throw new OperationError(404, 'Patient profile is no longer available.');
  }
  return getPatientProfile(actor);
}

export async function listDiscoverableDoctors(actor, query) {
  await currentPatient(actor);
  const db = getMongoDatabase();
  const { page, limit, skip } = pageOptions(query);
  const match = { isActive: true };
  const expression = searchExpression(query.search);
  if (query.specialization) {
    match.specialization = String(query.specialization).trim().slice(0, 100);
  }
  const stages = [
    { $match: match },
    { $lookup: { from: 'users', localField: 'userId', foreignField: '_id', as: 'account' } },
    { $unwind: '$account' },
    { $match: { 'account.role': 'doctor', 'account.isActive': true } },
  ];
  if (expression) {
    const regex = { $regex: expression, $options: 'i' };
    stages.push({ $match: { $or: [
      { name: regex },
      { 'account.name': regex },
      { specialization: regex },
      { department: regex },
      { doctorId: regex },
    ] } });
  }
  const [result] = await db.collection('doctors').aggregate([
    {
      $facet: {
        items: [
          ...stages,
          { $sort: { name: 1, _id: 1 } },
          { $skip: skip },
          { $limit: limit },
          { $project: {
            _id: 1,
            userId: 1,
            name: { $cond: [{ $eq: [{ $type: '$name' }, 'string'] }, { $cond: [{ $eq: ['$name', ''] }, '$account.name', '$name'] }, '$account.name'] },
            specialization: 1,
            department: 1,
            qualifications: 1,
            availabilityTimeZone: 1,
            availabilityDurationMinutes: 1,
            hasAvailability: {
              $gt: [
                {
                  $size: {
                    $filter: {
                      input: { $ifNull: ['$availability', []] },
                      as: 'day',
                      cond: { $eq: ['$$day.enabled', true] },
                    },
                  },
                },
                0,
              ],
            },
          } },
        ],
        total: [...stages, { $count: 'count' }],
        ...(env.nodeEnv === 'development' ? {
          diagnostic: [
            { $lookup: { from: 'users', localField: 'userId', foreignField: '_id', as: 'account' } },
            { $unwind: { path: '$account', preserveNullAndEmptyArrays: true } },
            { $group: {
              _id: null,
              doctorProfiles: { $sum: 1 },
              linkedDoctorAccounts: { $sum: { $cond: [{ $eq: ['$account.role', 'doctor'] }, 1, 0] } },
              activeLinkedProfiles: { $sum: { $cond: [{ $and: [{ $eq: ['$isActive', true] }, { $eq: ['$account.role', 'doctor'] }, { $eq: ['$account.isActive', true] }] }, 1, 0] } },
            } },
          ],
        } : {}),
      },
    },
  ]).toArray();
  const items = result.items.map((doctor) => ({
    id: doctor.userId.toString(),
    profileId: doctor._id.toString(),
    name: doctor.name || '',
    specialization: doctor.specialization || '',
    department: doctor.department || '',
    qualifications: doctor.qualifications || '',
    timeZone: doctor.availabilityTimeZone || 'UTC',
    durationMinutes: doctor.availabilityDurationMinutes || 30,
    hasAvailability: doctor.hasAvailability,
  }));
  const total = result.total[0]?.count || 0;
  if (env.nodeEnv === 'development') {
    const diagnostic = result.diagnostic?.[0] || { doctorProfiles: 0, linkedDoctorAccounts: 0, activeLinkedProfiles: 0 };
    console.info('[patient:doctors]', JSON.stringify({
      doctorProfiles: diagnostic.doctorProfiles,
      linkedDoctorAccounts: diagnostic.linkedDoctorAccounts,
      activeLinkedProfiles: diagnostic.activeLinkedProfiles,
      eligibleAfterFilters: total,
    }));
  }
  return { items, page, limit, total, pages: Math.ceil(total / limit) };
}

export async function getPatientDoctorSlots(actor, doctorId, date) {
  await currentPatient(actor);
  return getAvailableSlotsForDoctor(doctorId, date);
}

export async function listPatientAppointments(actor, query) {
  await currentPatient(actor);
  const db = getMongoDatabase();
  const { page, limit, skip } = pageOptions(query);
  const filter = { patientId: actor.id };
  if (query.status && query.status !== 'all') {
    if (!['scheduled', 'completed', 'cancelled'].includes(query.status)) {
      throw new OperationError(400, 'Appointment status is invalid.');
    }
    filter.status = query.status;
  }
  const [appointments, total, statusRows] = await Promise.all([
    db.collection('appointments').find(filter).sort({ scheduledAt: 1 }).skip(skip).limit(limit).toArray(),
    db.collection('appointments').countDocuments(filter),
    db.collection('appointments').aggregate([
      { $match: { patientId: actor.id } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]).toArray(),
  ]);
  const statusCounts = { scheduled: 0, completed: 0, cancelled: 0 };
  for (const row of statusRows) if (row._id in statusCounts) statusCounts[row._id] = row.count;
  const doctorIds = [...new Set(appointments.map((item) => item.doctorId).filter(ObjectId.isValid))]
    .map((id) => new ObjectId(id));
  const doctors = doctorIds.length
    ? await db.collection('doctors').find({ userId: { $in: doctorIds } }, {
      projection: { userId: 1, name: 1, specialization: 1, department: 1, availabilityTimeZone: 1 },
    }).toArray()
    : [];
  const doctorsByUserId = new Map(doctors.map((doctor) => [doctor.userId.toString(), doctor]));
  return {
    items: appointments.map((appointment) => {
      const doctor = doctorsByUserId.get(appointment.doctorId);
      return {
        id: appointment._id.toString(),
        appointmentId: appointment.appointmentId,
        doctorId: appointment.doctorId,
        doctorName: doctor?.name || '',
        specialization: doctor?.specialization || '',
        department: doctor?.department || '',
        timeZone: doctor?.availabilityTimeZone || 'UTC',
        scheduledAt: appointment.scheduledAt,
        durationMinutes: appointment.durationMinutes || 30,
        reason: appointment.reason || '',
        status: appointment.status,
        graphSync: appointment.graphSync?.status || 'pending',
      };
    }),
    page,
    limit,
    total,
    statusCounts,
    pages: Math.ceil(total / limit),
  };
}

export async function listPatientRecords(actor, query) {
  const { profile } = await currentPatient(actor);
  const db = getMongoDatabase();
  const { page, limit, skip } = pageOptions(query);
  const pipeline = [
    { $match: { patientId: profile._id } },
    { $project: {
      _id: 1,
      recordId: { $ifNull: ['$recordId', { $toString: '$_id' }] },
      title: { $ifNull: ['$title', ''] },
      recordType: { $ifNull: ['$recordType', 'record'] },
      content: { $ifNull: ['$content', ''] },
      doctorId: 1,
      createdAt: 1,
      updatedAt: 1,
    } },
    {
      $unionWith: {
        coll: 'consultations',
        pipeline: [
          { $match: { patientId: profile._id, status: 'finalized' } },
          { $project: {
            _id: 1,
            recordId: { $concat: ['CONS-', { $ifNull: [{ $toString: '$appointmentId' }, { $toString: '$_id' }] }] },
            title: { $literal: 'Consultation summary' },
            recordType: { $literal: 'consultation' },
            content: { $concat: [
              'Diagnosis: ', { $ifNull: ['$diagnosis', ''] },
              '\n\nClinical notes: ', { $ifNull: ['$notes', ''] },
              '\n\nTreatment plan: ', { $ifNull: ['$treatmentPlan', ''] },
              '\n\nPrescription: ', { $ifNull: ['$prescriptionSummary', ''] },
            ] },
            doctorId: 1,
            createdAt: 1,
            updatedAt: 1,
          } },
        ],
      },
    },
  ];
  if (query.type && query.type !== 'all') {
    pipeline.push({ $match: { recordType: String(query.type).trim().toLowerCase().slice(0, 50) } });
  }
  const expression = searchExpression(query.search);
  if (expression) {
    const regex = { $regex: expression, $options: 'i' };
    pipeline.push({ $match: { $or: [{ recordId: regex }, { title: regex }, { recordType: regex }] } });
  }
  pipeline.push({
    $facet: {
      items: [{ $sort: { createdAt: -1, _id: -1 } }, { $skip: skip }, { $limit: limit }],
      total: [{ $count: 'count' }],
    },
  });
  const [result] = await db.collection('medical_records').aggregate(pipeline).toArray();
  const records = result?.items || [];
  const total = result?.total[0]?.count || 0;
  const doctorIds = [...new Set(records.map((record) => record.doctorId).filter(ObjectId.isValid))]
    .map((id) => new ObjectId(id));
  const doctors = doctorIds.length
    ? await db.collection('doctors').find({ userId: { $in: doctorIds } }, {
      projection: { userId: 1, name: 1, specialization: 1 },
    }).toArray()
    : [];
  const doctorsByUserId = new Map(doctors.map((doctor) => [doctor.userId.toString(), doctor]));
  return {
    items: records.map((record) => {
      const doctor = doctorsByUserId.get(record.doctorId?.toString());
      return {
        id: record._id.toString(),
        recordId: record.recordId || record._id.toString(),
        title: record.title || '',
        recordType: record.recordType || '',
        content: record.content || '',
        provider: doctor?.name || '',
        specialization: doctor?.specialization || '',
        createdAt: record.createdAt || null,
        updatedAt: record.updatedAt || null,
      };
    }),
    page,
    limit,
    total,
    pages: Math.ceil(total / limit),
  };
}

export async function bookPatientAppointment(actor, input) {
  const { user } = await currentPatient(actor);
  if (input.patientId !== undefined) throw new OperationError(400, 'Patient identity is taken from the authenticated session.');
  return createAppointment(actor, {
    patientId: user._id.toString(),
    doctorId: input.doctorId,
    scheduledAt: input.scheduledAt,
    reason: input.reason,
  });
}

export async function cancelPatientAppointment(actor, id) {
  await currentPatient(actor);
  const _id = parseId(id, 'Appointment ID');
  const appointment = await getMongoDatabase().collection('appointments').findOne({
    _id,
    patientId: actor.id,
  }, { projection: { status: 1 } });
  if (!appointment) throw new OperationError(404, 'Appointment was not found for this patient.');
  return changeAppointmentStatus(actor, id, 'cancelled', { patientId: actor.id });
}

export { OperationError };
