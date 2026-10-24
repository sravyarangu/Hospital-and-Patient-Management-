import { Router } from 'express';
import requireAuth from '../middleware/requireAuth.js';
import requireRole from '../middleware/requireRole.js';
import { OperationError } from '../services/adminOperations.service.js';
import {
  changeDoctorAppointmentStatus,
  createDoctorRecord,
  getDoctorAppointment,
  getDoctorAvailability,
  getDoctorDashboard,
  getDoctorPatient,
  getDoctorProfile,
  listDoctorAppointments,
  listDoctorConsultations,
  listDoctorFollowUps,
  listDoctorPatients,
  listDoctorRecords,
  rescheduleDoctorAppointment,
  saveDoctorConsultation,
  updateDoctorAvailability,
  updateDoctorFollowUp,
  updateDoctorProfile,
  saveDoctorRecord,
} from '../services/doctorWorkspace.service.js';

const router = Router();
router.use(requireAuth, requireRole('doctor'));

function endpoint(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

router.get('/dashboard', endpoint(async (req, res) => res.json(await getDoctorDashboard(req.user))));
router.get('/appointments', endpoint(async (req, res) => res.json(await listDoctorAppointments(req.user, req.query))));
router.get('/appointments/:id', endpoint(async (req, res) => res.json(await getDoctorAppointment(req.user, req.params.id))));
router.patch('/appointments/:id/status', endpoint(async (req, res) => {
  const result = await changeDoctorAppointmentStatus(req.user, req.params.id, req.body?.status);
  res.status(result.graphSync === 'failed' ? 202 : 200).json(result);
}));
router.patch('/appointments/:id/reschedule', endpoint(async (req, res) => {
  const result = await rescheduleDoctorAppointment(req.user, req.params.id, req.body || {});
  res.status(result.graphSync === 'failed' ? 202 : 200).json(result);
}));
router.get('/patients', endpoint(async (req, res) => res.json(await listDoctorPatients(req.user, req.query))));
router.get('/patients/:id', endpoint(async (req, res) => res.json(await getDoctorPatient(req.user, req.params.id))));
router.get('/consultations', endpoint(async (req, res) => res.json(await listDoctorConsultations(req.user, req.query))));
router.post('/consultations', endpoint(async (req, res) => {
  const result = await saveDoctorConsultation(req.user, req.body || {});
  res.status(result.graphSync === 'failed' ? 202 : 200).json(result);
}));
router.patch('/consultations/:id', endpoint(async (req, res) => {
  const result = await saveDoctorConsultation(req.user, { ...(req.body || {}), id: req.params.id });
  res.status(result.graphSync === 'failed' ? 202 : 200).json(result);
}));
router.get('/medical-records', endpoint(async (req, res) => res.json(await listDoctorRecords(req.user, req.query))));
router.post('/medical-records', endpoint(async (req, res) => res.status(201).json(await createDoctorRecord(req.user, req.body || {}))));
router.patch('/medical-records/:id', endpoint(async (req, res) => res.json(await saveDoctorRecord(req.user, req.body || {}, req.params.id))));
router.get('/follow-ups', endpoint(async (req, res) => res.json(await listDoctorFollowUps(req.user, req.query))));
router.patch('/follow-ups/:id', endpoint(async (req, res) => res.json(await updateDoctorFollowUp(req.user, req.params.id, req.body || {}))));
router.get('/availability', endpoint(async (req, res) => res.json(await getDoctorAvailability(req.user))));
router.patch('/availability', endpoint(async (req, res) => res.json(await updateDoctorAvailability(req.user, req.body || {}))));
router.get('/profile', endpoint(async (req, res) => res.json(await getDoctorProfile(req.user))));
router.patch('/profile', endpoint(async (req, res) => res.json(await updateDoctorProfile(req.user, req.body || {}))));

router.use((error, req, res, next) => {
  if (error instanceof OperationError) {
    res.status(error.status).json({ error: true, message: error.message });
    return;
  }
  if (error?.code === 11000) {
    res.status(409).json({ error: true, message: 'A consultation or record with the same identifier already exists.' });
    return;
  }
  next(error);
});

export default router;
