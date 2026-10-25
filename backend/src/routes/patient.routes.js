import { Router } from 'express';
import requireAuth from '../middleware/requireAuth.js';
import requireRole from '../middleware/requireRole.js';
import {
  bookPatientAppointment,
  cancelPatientAppointment,
  getPatientDoctorSlots,
  getPatientProfile,
  listDiscoverableDoctors,
  listPatientAppointments,
  listPatientRecords,
  updatePatientProfile,
  OperationError,
} from '../services/patientPortal.service.js';

const router = Router();
router.use(requireAuth, requireRole('patient'));

function endpoint(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

router.get('/profile', endpoint(async (req, res) => res.json(await getPatientProfile(req.user))));
router.patch('/profile', endpoint(async (req, res) => res.json(await updatePatientProfile(req.user, req.body || {}))));
router.get('/doctors', endpoint(async (req, res) => res.json(await listDiscoverableDoctors(req.user, req.query))));
router.get('/doctors/:doctorId/slots', endpoint(async (req, res) => {
  res.json(await getPatientDoctorSlots(req.user, req.params.doctorId, req.query.date));
}));
router.get('/appointments', endpoint(async (req, res) => res.json(await listPatientAppointments(req.user, req.query))));
router.get('/records', endpoint(async (req, res) => res.json(await listPatientRecords(req.user, req.query))));
router.post('/appointments', endpoint(async (req, res) => {
  const result = await bookPatientAppointment(req.user, req.body || {});
  const graphSync = result.graphSync;
  res.status(graphSync === 'synced' ? 201 : 202).json({
    ...result,
    message: graphSync === 'synced'
      ? 'Appointment created and synchronized.'
      : 'Appointment saved, but graph synchronization failed. The hospital can retry reconciliation.',
  });
}));
router.patch('/appointments/:id/cancel', endpoint(async (req, res) => {
  const result = await cancelPatientAppointment(req.user, req.params.id);
  res.status(result.graphSync === 'failed' ? 202 : 200).json({
    ...result,
    message: result.graphSync === 'failed'
      ? 'Appointment cancelled, but graph synchronization failed. The hospital can retry reconciliation.'
      : 'Appointment cancelled.',
  });
}));

router.use((error, req, res, next) => {
  if (error instanceof OperationError) {
    res.status(error.status).json({ error: true, message: error.message });
    return;
  }
  if (error?.code === 11000) {
    res.status(409).json({ error: true, message: 'This appointment time is no longer available. Refresh the slots and try again.' });
    return;
  }
  next(error);
});

export default router;
