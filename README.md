# MediCare Patient Portal

A React + Vite patient portal with a Node.js/Express API, MongoDB-backed patient accounts, secure cookie sessions, and role-aware routes.

## Configure and run locally

Requirements: Node.js 18+ and npm. Configure `backend/.env` from `backend/.env.example` with valid MongoDB, Neo4j, and random JWT/session secrets. Keep `.env` files private; do not commit them.

```bash
npm install
npm --prefix backend install
npm run backend:dev
```

In another terminal:

```bash
npm run dev
```

Open the local URL printed by Vite (usually http://localhost:5173). The public home page is `/`. Patient registration is `/signup`, login is `/login`, and protected dashboards are `/patient/dashboard`, `/doctor/dashboard`, and `/admin/dashboard`.

## Demo accounts

Set unique passwords (at least 10 characters; 12 or more is recommended) in `DEMO_ADMIN_PASSWORD`, `DEMO_DOCTOR_PASSWORD`, and `DEMO_PATIENT_PASSWORD` in `backend/.env`, then run:

```bash
npm --prefix backend run seed:demo
```

The seed script creates or verifies `admin@medicare.demo`, `doctor@medicare.demo`, and `patient@medicare.demo`. It does not reset an existing account's password or change an existing role.

## Verify the frontend

```bash
npm run build
npm --prefix backend test
```

## Deployment routing

The frontend uses browser history routes. Configure the production web host to serve `index.html` as the fallback for unknown paths (for example `/login` and `/patient/dashboard`) while serving existing static assets normally. The backend API routes must remain routed to Express rather than the frontend fallback.

## Dashboard design

The patient dashboard uses a health-journal layout and displays only records loaded for the signed-in patient. It does not generate sample appointments, doctor profiles, medical records, or wellness measurements. Wellness insights remain empty until real readings are stored through a supported health-data integration.

## Other features

- Active doctor directory with specialty filters and schedule-backed appointment booking
- Patient-scoped appointment list and cancellation
- Patient-scoped medical records list, search/filter, and record detail modal
- Health insights and profile editing
- Notification-center empty state, toast feedback, responsive sidebar and mobile layout

## Administrator operations

Sign in with an account whose stored role is `admin` and open `/admin/dashboard`. The operations portal reads registered patients, doctors, appointments, and audit events from MongoDB. It supports patient and doctor account management, appointment booking/rescheduling/status changes, department summaries, date-range reports and CSV export, administrator settings, and a Neo4j relationship explorer with reconciliation.

The `/api/admin` endpoints require an authenticated administrator session. Appointment booking prevents simultaneous duplicate doctor/time slots; a graph synchronization failure is reported separately from the MongoDB appointment save and can be retried from Relationships. This dashboard intentionally excludes clinical notes and is not a substitute for a clinical record system.

## Doctor clinical workspace

Sign in with an active account whose stored role is `doctor`; the session opens `/doctor/dashboard`. The workspace uses doctor-scoped `/api/doctor` endpoints for appointments, assigned patients, consultations, medical records, follow-ups, weekly availability, and professional profile data. Patient details and clinical writes are authorized on the server against appointments, consultations, or records linked to that doctor. A finalized consultation completes its appointment and attempts to synchronize the existing Patient–Appointment–Doctor graph; failed graph synchronization is shown as a partial success rather than reported as complete.

The `/doctor/appointments` page opens in a full month-grid view, with day and week time-grid alternatives. It fetches doctor-assigned appointments for the displayed date range, supports status/search filters, and uses each appointment's persisted start time and duration. Historical records without a duration use a 30-minute display duration.

Availability is stored on the doctor profile and interpreted in its saved IANA time zone. The doctor can configure all seven weekdays, breaks, and a 15-to-120-minute appointment duration; the page also shows upcoming appointments and server-calculated open slots. A doctor without a saved schedule cannot accept new appointments or reschedule existing ones. Administrator booking and doctor rescheduling must fit entirely within the configured working hours and avoid breaks and overlapping appointments. MongoDB transactions and unique minute-level appointment reservations prevent concurrent overlapping bookings; patient profile name/email changes are also synchronized across the account and profile in a transaction. Availability changes that conflict with already scheduled visits are rejected without modifying appointments. Clinical measurements, diagnoses, notes, and prescription summaries are only stored when explicitly entered by an authorized doctor; the portal does not generate clinical content or send follow-up messages.

Doctor availability uses `GET /api/doctor/availability`, `PATCH /api/doctor/availability`, and `GET /api/doctor/availability/slots?date=YYYY-MM-DD`. The profile stores the legacy-compatible weekly `availability` array, `availabilityTimeZone`, `availabilityDurationMinutes`, and `availabilityUpdatedAt`; no schedule is written automatically for new doctors. MongoDB's `appointments` and `appointment_slots` collections remain the operational source of truth. Bookings and reschedules use transactions, so the configured MongoDB deployment must support multi-document transactions (as MongoDB Atlas does).

## Integration status

Patient registration persists a user and patient profile in MongoDB. Authentication uses an HttpOnly, SameSite cookie containing a short-lived signed session token; role authorization is based on the account stored in MongoDB. Patient profile, active doctor discovery, available appointment slots, appointments, cancellations, and medical records use authenticated `/api/patient` endpoints. Patient identity for bookings is taken from the session, and appointment reads/cancellations are scoped to that patient. Doctor discovery and administrator patient/doctor directories only include profiles linked to an account with the expected role; inactive accounts are excluded from patient discovery and active-doctor counts. Wellness insights remain empty until real readings are stored. Administrator operational counts use linked database records and will be empty when the corresponding collections have no records.

Patient endpoints are `GET/PATCH /api/patient/profile`, `GET /api/patient/doctors`, `GET /api/patient/doctors/:doctorId/slots?date=YYYY-MM-DD`, `GET /api/patient/appointments`, `POST /api/patient/appointments`, `PATCH /api/patient/appointments/:id/cancel`, and `GET /api/patient/records`. Medical records are queried by the authenticated patient profile's MongoDB ID; clinical details are not accepted from the client when booking.
