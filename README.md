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
```

## Deployment routing

The frontend uses browser history routes. Configure the production web host to serve `index.html` as the fallback for unknown paths (for example `/login` and `/patient/dashboard`) while serving existing static assets normally. The backend API routes must remain routed to Express rather than the frontend fallback.

## Dashboard design

The patient dashboard uses an editorial health-journal layout with an organic movement progress ring, a weekly activity curve, a care timeline, and a compact health snapshot instead of repeated statistic cards.

## Phone motion sensor prototype

On a compatible mobile browser, use **Connect phone sensor** on the dashboard and allow motion access if prompted. The browser listens for `devicemotion` events and uses a simple acceleration threshold to estimate step-like movements while the page remains open. This is an educational prototype only: readings can be inaccurate, it may not work on all devices/browsers, it does not count reliably in the background, and it is not a medical-grade pedometer. On iOS, sensor access may require a user gesture and permission. Production-grade steps should come from a supported health platform such as Android Health Connect (usually via a native/companion app) or Apple Health via an iOS integration, with explicit user consent.

The dashboard starts with illustrative demo data; sensor session counts start at zero when connected, and manual step entry is available. Heart rate and other health readings remain explicitly labeled sample data; ordinary web pages cannot measure heart rate by themselves.

## Other features

- Doctor directory with specialty filters and appointment booking
- Appointment list and cancellation
- Medical records list, search/filter, and record detail modal
- Health insights and profile editing
- Notifications, toast feedback, responsive sidebar and mobile layout
- Fictional demo data only

## Administrator operations

Sign in with an account whose stored role is `admin` and open `/admin/dashboard`. The operations portal reads registered patients, doctors, appointments, and audit events from MongoDB. It supports patient and doctor account management, appointment booking/rescheduling/status changes, department summaries, date-range reports and CSV export, administrator settings, and a Neo4j relationship explorer with reconciliation.

The `/api/admin` endpoints require an authenticated administrator session. Appointment booking prevents simultaneous duplicate doctor/time slots; a graph synchronization failure is reported separately from the MongoDB appointment save and can be retried from Relationships. This dashboard intentionally excludes clinical notes and is not a substitute for a clinical record system.

## Doctor clinical workspace

Sign in with an active account whose stored role is `doctor`; the session opens `/doctor/dashboard`. The workspace uses doctor-scoped `/api/doctor` endpoints for appointments, assigned patients, consultations, medical records, follow-ups, weekly availability, and professional profile data. Patient details and clinical writes are authorized on the server against appointments, consultations, or records linked to that doctor. A finalized consultation completes its appointment and attempts to synchronize the existing Patient–Appointment–Doctor graph; failed graph synchronization is shown as a partial success rather than reported as complete.

The `/doctor/appointments` page opens in a full month-grid view, with day and week time-grid alternatives. It fetches all pages of doctor-assigned appointments for the displayed date range, supports status/search filters, and uses the stored appointment time. Since the appointment schema currently stores a start time only, the calendar uses a labeled 30-minute display duration unless a record supplies an end time or duration.

Availability is stored on the doctor profile and interpreted in its saved IANA time zone. A doctor without a configured weekly schedule retains the existing appointment-booking behavior; after a schedule is saved, administrator booking and doctor rescheduling must fit the configured working hours and breaks. Availability changes that conflict with already scheduled visits are rejected without modifying appointments. Clinical measurements, diagnoses, notes, and prescription summaries are only stored when explicitly entered by an authorized doctor; the portal does not generate clinical content or send follow-up messages.

## Integration status

Patient registration persists a user and patient profile in MongoDB. Authentication uses an HttpOnly, SameSite cookie containing a short-lived signed session token; role authorization is based on the account stored in MongoDB. The patient portal's appointment, record, and wellness content remains illustrative frontend demo data; do not use it for real patient care until those flows are connected to authorized backend APIs. Administrator operational counts use database records and will be empty when the corresponding collections have no records.
