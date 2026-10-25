import React, { useEffect, useMemo, useState } from 'react';
import { getBackendHealth, requestApi } from './api';
import {
  Activity, ArrowRight, ArrowUpRight, Bell, CalendarDays, Check, ChevronDown,
  ChevronRight, CircleHelp, Clock3, FileHeart, FileText, HeartPulse,
  LayoutDashboard, LogOut, Menu, MessageCircle, MoreHorizontal, Plus, Search,
  Settings, ShieldCheck, Sparkles, Stethoscope, UserRound, X, Droplets, Pill,
  MapPin, CalendarCheck, ClipboardList, BadgeCheck, CheckCircle2, AlertCircle
} from 'lucide-react';

const doctorColors = ['lilac', 'peach', 'mint', 'blue'];
const recordPresentation = {
  consultation: { icon: HeartPulse, tint: 'pink' },
  lab: { icon: Droplets, tint: 'blue' },
  prescription: { icon: Pill, tint: 'orange' },
  imaging: { icon: ClipboardList, tint: 'green' },
};

function initials(name = '') {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'DR';
}

function formatDateKey(value, timeZone) {
  const date = new Date(value);
  if (timeZone) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatRecord(record) {
  const type = String(record.recordType || 'record').toLowerCase();
  const presentation = recordPresentation[type] || { icon: FileText, tint: 'blue' };
  return {
    ...record,
    category: type.charAt(0).toUpperCase() + type.slice(1),
    doctor: record.provider || 'Care team',
    date: record.createdAt ? new Date(record.createdAt).toLocaleDateString() : 'Date unavailable',
    icon: presentation.icon,
    tint: presentation.tint,
    description: record.content || 'No details were added to this record.',
  };
}

function formatAppointment(appointment, index) {
  const scheduledAt = new Date(appointment.scheduledAt);
  const status = appointment.status || 'scheduled';
  const timeZone = appointment.timeZone || 'UTC';
  return {
    ...appointment,
    date: formatDateKey(scheduledAt, timeZone),
    time: scheduledAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone }),
    doctor: appointment.doctorName ? `Dr. ${appointment.doctorName.replace(/^Dr\.\s*/i, '')}` : 'Doctor',
    specialty: appointment.specialization || appointment.department || 'Appointment',
    type: appointment.reason || 'Appointment',
    status: status.charAt(0).toUpperCase() + status.slice(1),
    initials: initials(appointment.doctorName),
    color: doctorColors[index % doctorColors.length],
  };
}

function Avatar({ initials = 'AR', color = 'blue', size = 'md' }) {
  return <div className={`avatar ${color} ${size}`}>{initials}</div>;
}
function SectionHeading({ title, subtitle, action, onAction }) {
  return <div className="section-heading"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action && <button className="text-button" onClick={onAction}>{action}<ArrowRight size={15}/></button>}</div>;
}
function Badge({ children, tone = 'neutral' }) { return <span className={`badge ${tone}`}><span className="badge-dot"/>{children}</span>; }
function Modal({ title, onClose, children, wide = false }) {
  return <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && onClose()}><div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true"><div className="modal-head"><div><h2>{title}</h2><p>Enter the details below to continue.</p></div><button className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={19}/></button></div>{children}</div></div>;
}

export function PatientDashboard({ user, onLogout }) {
  const [page, setPage] = useState('Dashboard');
  const [mobileNav, setMobileNav] = useState(false);
  const [search, setSearch] = useState('');
  const [showBooking, setShowBooking] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [appointmentsList, setAppointmentsList] = useState([]);
  const [appointmentsTotal, setAppointmentsTotal] = useState(0);
  const [appointmentStatusCounts, setAppointmentStatusCounts] = useState({ scheduled: 0, completed: 0, cancelled: 0 });
  const [doctors, setDoctors] = useState([]);
  const [doctorsTotal, setDoctorsTotal] = useState(0);
  const [records, setRecords] = useState([]);
  const [recordsTotal, setRecordsTotal] = useState(0);
  const [portalLoading, setPortalLoading] = useState(true);
  const [portalError, setPortalError] = useState('');
  const [doctorsLoading, setDoctorsLoading] = useState(true);
  const [doctorsError, setDoctorsError] = useState('');
  const [doctorRequestVersion, setDoctorRequestVersion] = useState(0);
  const [bookingSaving, setBookingSaving] = useState(false);
  const [bookingSlots, setBookingSlots] = useState([]);
  const [slotTimeZone, setSlotTimeZone] = useState('UTC');
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState('');
  const [recordFilter, setRecordFilter] = useState('All records');
  const [doctorFilter, setDoctorFilter] = useState('All specialties');
  const [profile, setProfile] = useState(() => ({ name: user?.name || '', email: user?.email || '', phone: '', dob: '', blood: '', emergency: '' }));
  const [booking, setBooking] = useState({ doctorId: '', date: formatDateKey(Date.now() + 86400000), startAt: '', reason: '' });
  const [toast, setToast] = useState('');
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [selectedDoctor, setSelectedDoctor] = useState(null);
  const [profileEditing, setProfileEditing] = useState(false);
  const [profileDraft, setProfileDraft] = useState(profile);
  const [backendHealth, setBackendHealth] = useState({ status: 'checking', message: 'Checking backend connection...' });

  useEffect(() => {
    const controller = new AbortController();

    getBackendHealth({ signal: controller.signal })
      .then((response) => {
        setBackendHealth({ status: 'ok', message: `Backend online (${response.app || 'medicare-backend'})` });
      })
      .catch(() => {
        setBackendHealth({ status: 'offline', message: 'Backend offline — start the API server to enable live checks.' });
      });

    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    Promise.allSettled([
      requestApi('/patient/profile', { signal: controller.signal }),
      requestApi('/patient/appointments?limit=100', { signal: controller.signal }),
      requestApi('/patient/records?limit=100', { signal: controller.signal }),
    ]).then(([profileResult, appointmentResult, recordsResult]) => {
      const errors = [];
      if (profileResult.status === 'fulfilled') {
        const patient = profileResult.value.profile;
        setProfile({
          name: patient.name || '',
          email: patient.email || '',
          phone: patient.phone || '',
          dob: patient.dateOfBirth || '',
          blood: patient.bloodGroup || '',
          emergency: patient.emergencyContact || '',
        });
      } else errors.push(profileResult.reason?.message || 'Profile could not be loaded.');
      if (appointmentResult.status === 'fulfilled') {
        setAppointmentsList(appointmentResult.value.items.map(formatAppointment));
        setAppointmentsTotal(appointmentResult.value.total || 0);
        setAppointmentStatusCounts(appointmentResult.value.statusCounts || { scheduled: 0, completed: 0, cancelled: 0 });
      } else errors.push(appointmentResult.reason?.message || 'Appointments could not be loaded.');
      if (recordsResult.status === 'fulfilled') {
        setRecords(recordsResult.value.items.map(formatRecord));
        setRecordsTotal(recordsResult.value.total || 0);
      } else errors.push(recordsResult.reason?.message || 'Medical records could not be loaded.');
      setPortalError(errors.join(' '));
    }).finally(() => {
      if (!controller.signal.aborted) setPortalLoading(false);
    });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setDoctorsLoading(true);
    setDoctorsError('');
    requestApi('/patient/doctors?limit=100', { signal: controller.signal })
      .then((response) => {
        if (!Array.isArray(response.items)) throw new Error('Doctor directory response is invalid.');
        setDoctors(response.items.map((doctor, index) => ({
          ...doctor,
          name: doctor.name ? `Dr. ${doctor.name.replace(/^Dr\.\s*/i, '')}` : 'Doctor',
          specialty: doctor.specialization || doctor.department || 'General care',
          initials: initials(doctor.name),
          color: doctorColors[index % doctorColors.length],
          experience: doctor.qualifications || 'Specialist',
        })));
        setDoctorsTotal(Number.isFinite(response.total) ? response.total : response.items.length);
      })
      .catch((error) => {
        if (error.name !== 'AbortError') {
          setDoctors([]);
          setDoctorsTotal(0);
          setDoctorsError(error.message || 'Could not load active doctor profiles.');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setDoctorsLoading(false);
      });
    return () => controller.abort();
  }, [doctorRequestVersion]);

  useEffect(() => setProfileDraft(profile), [profile]);

  useEffect(() => {
    if (showBooking && !booking.doctorId && doctors.length) {
      setBooking((current) => ({ ...current, doctorId: doctors[0].id }));
    }
  }, [showBooking, booking.doctorId, doctors]);

  useEffect(() => {
    if (!showBooking || !booking.doctorId || !booking.date) {
      setBookingSlots([]);
      return undefined;
    }
    const controller = new AbortController();
    setSlotsLoading(true);
    setSlotsError('');
    requestApi(`/patient/doctors/${encodeURIComponent(booking.doctorId)}/slots?date=${encodeURIComponent(booking.date)}`, { signal: controller.signal })
      .then((response) => {
        setBookingSlots(response.slots || []);
        setSlotTimeZone(response.timeZone || 'UTC');
      })
      .catch((error) => {
        if (error.name !== 'AbortError') {
          setBookingSlots([]);
          setSlotsError(error.message || 'Could not load available appointment times.');
        }
      }).finally(() => {
        if (!controller.signal.aborted) setSlotsLoading(false);
      });
    return () => controller.abort();
  }, [showBooking, booking.doctorId, booking.date]);

  const nav = [
    { label: 'OVERVIEW', items: [{ name: 'Dashboard', icon: LayoutDashboard }, { name: 'Find a doctor', icon: Stethoscope }, { name: 'Appointments', icon: CalendarDays }] },
    { label: 'MY HEALTH', items: [{ name: 'Medical records', icon: FileHeart }, { name: 'Health insights', icon: Activity }] },
    { label: 'ACCOUNT', items: [{ name: 'My profile', icon: UserRound }, { name: 'Help & support', icon: CircleHelp }] },
  ];
  const notify = (message) => { setToast(message); window.setTimeout(() => setToast(''), 3000); };
  const go = (next) => { setPage(next); setMobileNav(false); setSearch(''); };
  const filteredDoctors = useMemo(() => doctors.filter(d => (doctorFilter === 'All specialties' || d.specialty === doctorFilter) && `${d.name} ${d.specialty}`.toLowerCase().includes(search.toLowerCase())), [doctors, doctorFilter, search]);
  const filteredRecords = useMemo(() => records.filter(r => (recordFilter === 'All records' || r.category === recordFilter) && `${r.title} ${r.doctor}`.toLowerCase().includes(search.toLowerCase())), [records, recordFilter, search]);
  const pageMeta = {
    'Dashboard': [`Good morning, ${profile.name.split(' ')[0] || 'there'}`, 'Your appointments, active doctors, and saved records at a glance.'],
    'Find a doctor': ['Find your doctor', 'Care that fits your needs, from specialists you can trust.'],
    'Appointments': ['My appointments', 'Keep your care on track. Manage upcoming visits and review past appointments.'],
    'Medical records': ['My medical records', 'Your health history, organized and easy to access.'],
    'Health insights': ['Health insights', 'Understand your recent activity and everyday wellness trends.'],
    'My profile': ['My profile', 'Keep your personal information current and your care team informed.'],
    'Help & support': ['How can we help?', 'Find answers and get help with your patient portal.'],
  };
  const addBooking = async (e) => {
    e.preventDefault();
    if (!booking.startAt) return;
    setBookingSaving(true);
    try {
      const result = await requestApi('/patient/appointments', {
        method: 'POST',
        body: { doctorId: booking.doctorId, scheduledAt: booking.startAt, reason: booking.reason },
      });
      const response = await requestApi('/patient/appointments?limit=100');
      setAppointmentsList(response.items.map(formatAppointment));
      setAppointmentsTotal(response.total || 0);
      setAppointmentStatusCounts(response.statusCounts || { scheduled: 0, completed: 0, cancelled: 0 });
      setShowBooking(false);
      setBooking({ doctorId: '', date: formatDateKey(Date.now() + 86400000), startAt: '', reason: '' });
      go('Appointments');
      notify(result.message || 'Appointment request saved.');
    } catch (error) {
      notify(error.message || 'Could not save the appointment.');
    } finally {
      setBookingSaving(false);
    }
  };
  const cancelAppointment = async (id) => {
    try {
      const result = await requestApi(`/patient/appointments/${encodeURIComponent(id)}/cancel`, { method: 'PATCH' });
      const response = await requestApi('/patient/appointments?limit=100');
      setAppointmentsList(response.items.map(formatAppointment));
      setAppointmentsTotal(response.total || 0);
      setAppointmentStatusCounts(response.statusCounts || { scheduled: 0, completed: 0, cancelled: 0 });
      notify(result.message || 'Appointment cancelled.');
    } catch (error) {
      notify(error.message || 'Could not cancel this appointment.');
    }
  };

  const saveProfile = async (event) => {
    event.preventDefault();
    try {
      const response = await requestApi('/patient/profile', {
        method: 'PATCH',
        body: {
          name: profileDraft.name,
          email: profileDraft.email,
          phone: profileDraft.phone,
          dateOfBirth: profileDraft.dob,
          bloodGroup: profileDraft.blood,
          emergencyContact: profileDraft.emergency,
        },
      });
      const patient = response.profile;
      setProfile({
        name: patient.name || '',
        email: patient.email || '',
        phone: patient.phone || '',
        dob: patient.dateOfBirth || '',
        blood: patient.bloodGroup || '',
        emergency: patient.emergencyContact || '',
      });
      setProfileEditing(false);
      notify('Profile updated.');
    } catch (error) {
      notify(error.message || 'Could not update your profile.');
    }
  };

  const Sidebar = () => <aside className={`sidebar ${mobileNav ? 'mobile-open' : ''}`}>
    <div className="brand"><div className="brand-mark"><HeartPulse size={22}/></div><div className="brand-copy"><strong>medicare<span>.</span></strong><small>YOUR HEALTH SPACE</small></div><button className="icon-button sidebar-close" onClick={() => setMobileNav(false)}><X size={19}/></button></div>
    <div className="sidebar-patient"><Avatar initials={initials(profile.name)} color="blue"/><div><strong>{profile.name || 'Patient'}</strong><span>Patient account</span></div><Badge tone="green">Active</Badge></div>
    <nav className="side-nav">{nav.map(group => <div className="nav-group" key={group.label}><span className="nav-label">{group.label}</span>{group.items.map(item => <button key={item.name} className={`nav-item ${page === item.name ? 'active' : ''}`} onClick={() => go(item.name)}><item.icon size={18}/><span>{item.name}</span>{item.name === 'Appointments' && <span className="nav-count">{appointmentsList.filter(a => a.status !== 'Cancelled').length}</span>}{page === item.name && <span className="active-rail"/>}</button>)}</div>)}</nav>
    <div className="sidebar-bottom"><div className="care-card"><div className="care-card-icon"><Sparkles size={16}/></div><strong>Your health, your way.</strong><p>Wellness insights appear when readings are linked to your account.</p><button onClick={() => go('Health insights')}>Explore insights <ArrowRight size={14}/></button><div className="care-orb orb-one"/><div className="care-orb orb-two"/></div><button className="nav-item" onClick={() => notify('Account settings are not available yet.')}><Settings size={18}/><span>Settings</span></button><button className="nav-item" onClick={onLogout}><LogOut size={18}/><span>Sign out</span></button><div className="sidebar-footer">© 2026 MediCare <span>•</span> Made for your wellbeing</div></div>
  </aside>;

  const Header = () => <header className="topbar">
    <div className="topbar-left"><button className="icon-button menu-toggle" onClick={() => setMobileNav(true)} aria-label="Open menu"><Menu size={20}/></button><div className="breadcrumb"><span>Patient portal</span><ChevronRight size={14}/><strong>{page}</strong></div></div>
    <div className="topbar-right">
      <span className={`backend-pill ${backendHealth.status}`} title={backendHealth.message}>{backendHealth.status === 'ok' ? 'Backend online' : backendHealth.status === 'offline' ? 'Backend offline' : 'Checking backend...'}</span>
      <label className="global-search"><Search size={17}/><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search anything..."/><kbd>⌘ K</kbd></label>
      <div className="notification-wrap"><button className={`icon-button notification-button ${showNotifications ? 'pressed' : ''}`} onClick={() => setShowNotifications(!showNotifications)} aria-label="Notifications"><Bell size={19}/></button>{showNotifications && <div className="notification-popover"><div className="popover-title"><strong>Notifications</strong></div><div className="empty-state"><Bell size={24}/><strong>No notifications</strong><span>There are no saved notifications for your account.</span></div></div>}</div>
      <div className="topbar-divider"/><button className="top-profile" onClick={() => go('My profile')}><Avatar initials={initials(profile.name)} color="blue" size="sm"/><span><strong>{profile.name || 'Patient'}</strong><small>Patient</small></span><ChevronDown size={15}/></button>
    </div>
  </header>;

  const AppointmentCard = ({ appointment, compact = false }) => <div className={`appointment-card ${compact ? 'compact' : ''}`}>
    <div className={`date-tile ${appointment.status === 'Cancelled' ? 'cancelled' : ''}`}><span>{new Date(`${appointment.date}T12:00:00`).toLocaleDateString('en-US', { month: 'short' }).toUpperCase()}</span><strong>{new Date(`${appointment.date}T12:00:00`).getDate()}</strong><small>{new Date(`${appointment.date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short' })}</small></div>
    <Avatar initials={appointment.initials} color={appointment.color}/>
    <div className="appointment-info"><strong>{appointment.doctor}</strong><span>{appointment.specialty}</span><div className="appointment-meta"><span><Clock3 size={13}/>{appointment.time}</span><span><MapPin size={13}/>{appointment.type}</span></div></div>
    <div className="appointment-actions"><Badge tone={appointment.status === 'Scheduled' ? 'green' : appointment.status === 'Cancelled' ? 'red' : 'neutral'}>{appointment.status}</Badge>{!compact && <button className="icon-button tiny" onClick={() => notify(`Appointment ${appointment.appointmentId || appointment.id}: ${appointment.status}`)} aria-label="Appointment details"><MoreHorizontal size={18}/></button>}</div>
  </div>;

  const Dashboard = () => <div className="journal-dashboard">
    <section className="journal-intro">
      <div className="journal-kicker"><span className="journal-kicker-dot"/> YOUR HEALTH JOURNAL <span className="journal-date">{new Date().toLocaleDateString('en-IN', { weekday: 'long', month: 'short', day: 'numeric' })}</span></div>
      <h2>Your care,<br/><em>in one place.</em></h2>
      <p>{profile.name ? `Welcome, ${profile.name.split(' ')[0]}.` : 'Welcome to your patient portal.'} This dashboard shows information saved to your account.</p>
      <div className="journal-actions"><button className="btn btn-primary" onClick={() => setShowBooking(true)}><Plus size={16}/> Plan a care visit</button><button className="journal-link" onClick={() => go('Medical records')}>Explore my records <ArrowRight size={15}/></button></div>
      <div className="journal-orbit orbit-one"/><div className="journal-orbit orbit-two"/><div className="journal-flower">✳</div>
    </section>
    {portalError && <div className="info-banner"><span className="info-banner-icon"><AlertCircle size={19}/></span><div><strong>Patient data could not be loaded</strong><p>{portalError}</p></div><button className="text-button" onClick={() => window.location.reload()}>Retry</button></div>}
    <section className="journal-metrics" aria-label="Health snapshot">
      <div className="journal-metric heart-metric"><span className="metric-label"><HeartPulse size={15}/> MEDICAL RECORDS</span><div><strong>{portalLoading ? '—' : recordsTotal}</strong><span>saved</span></div><small>Records linked to your account</small></div>
      <div className="journal-metric"><span className="metric-label"><CalendarDays size={15}/> APPOINTMENTS</span><div><strong>{portalLoading ? '—' : appointmentsTotal}</strong><span>saved</span></div><small>Appointments linked to your account</small></div>
      <div className="journal-metric"><span className="metric-label"><Stethoscope size={15}/> ACTIVE DOCTORS</span><div><strong>{portalLoading ? '—' : doctorsTotal}</strong><span>available</span></div><small>Verified active doctor accounts</small></div>
    </section>
    <section className="journal-lower-grid">
      <div className="journal-activity"><div className="journal-block-head"><div><span className="journal-section-label">YOUR SAVED HEALTH DATA</span><h3>Wellness readings</h3></div><button className="journal-link" onClick={() => go('Health insights')}>Health insights <ArrowRight size={14}/></button></div><div className="empty-state"><Activity size={28}/><strong>No wellness readings saved</strong><span>Health metrics will appear here when they are recorded in your account.</span></div></div>
      <div className="care-timeline"><span className="journal-section-label"><CalendarDays size={15}/> YOUR CARE JOURNEY</span><h3>Appointments.</h3>{appointmentsList.filter((appointment) => appointment.status === 'Scheduled' && new Date(`${appointment.date}T23:59:00`) >= new Date()).slice(0, 2).map((appointment) => <div className="timeline-item" key={appointment.id}><div className="timeline-date"><span>{new Date(`${appointment.date}T12:00:00`).toLocaleDateString('en-US', { month: 'short' }).toUpperCase()}</span><strong>{new Date(`${appointment.date}T12:00:00`).getDate()}</strong></div><div className="timeline-copy"><strong>{appointment.specialty}</strong><span>{appointment.doctor}</span><small><Clock3 size={12}/> {appointment.time}</small><Badge tone="green">{appointment.status}</Badge></div></div>)}{!portalLoading && appointmentStatusCounts.scheduled === 0 && <p>No upcoming appointments are saved yet.</p>}<button className="timeline-book" onClick={() => setShowBooking(true)}>Plan a visit <ArrowRight size={15}/></button></div>
    </section>
    <section className="journal-record-strip"><div className="record-strip-intro"><span className="journal-section-label"><FileHeart size={15}/> KEEP CLOSE</span><h3>Your latest care notes.</h3><button className="journal-link" onClick={() => go('Medical records')}>All records <ArrowRight size={14}/></button></div>{records.slice(0, 2).map((record) => <button className="journal-record" key={record.id} onClick={() => setSelectedRecord(record)}><span className={`record-icon ${record.tint}`}><record.icon size={18}/></span><span><strong>{record.title}</strong><small>{record.date} · {record.doctor}</small></span><ArrowUpRight size={17}/></button>)}{!portalLoading && records.length === 0 && <p>No medical records are saved to your account yet.</p>}</section>
  </div>;

  const FindDoctorPage = () => <>
    <div className="page-intro-card doctor-intro"><div><div className="eyebrow"><span className="eyebrow-dot"/> CARE THAT FITS YOU</div><h2>Find an active care provider.</h2><p>Only active doctor accounts with linked profiles are listed. Bookings use times set by each doctor.</p><button className="btn btn-primary" onClick={() => setShowBooking(true)} disabled={!doctors.length}><CalendarDays size={16}/> Book a consultation</button></div><div className="doctor-intro-art"><div className="doctor-art-circle"><Stethoscope size={62}/></div><span className="float-star">✦</span><span className="float-plus"><Plus size={20}/></span></div></div>
    <div className="section-heading"><div><h2>Available doctors</h2><p>Verified active doctor accounts</p></div><span className="results-count">{doctorsLoading ? 'Loading…' : doctorsError ? 'Unavailable' : `${filteredDoctors.length} doctors available`}</span></div>
    <div className="filter-row"><div className="search-field"><Search size={17}/><input placeholder="Search doctor or specialty" value={search} onChange={e => setSearch(e.target.value)}/></div><select className="filter-select" value={doctorFilter} onChange={e => setDoctorFilter(e.target.value)}><option>All specialties</option>{[...new Set(doctors.map((doctor) => doctor.specialty))].map(specialty => <option key={specialty}>{specialty}</option>)}</select></div>
    {doctorsLoading ? <div className="empty-state"><Stethoscope size={28}/><strong>Loading doctors</strong><span>Fetching active profiles from the hospital directory.</span></div> : doctorsError ? <div className="empty-state"><AlertCircle size={28}/><strong>Doctor directory unavailable</strong><span>{doctorsError}</span><button className="btn btn-outline" onClick={() => setDoctorRequestVersion(version => version + 1)}>Retry</button></div> : filteredDoctors.length === 0 ? <div className="empty-state"><Stethoscope size={28}/><strong>{doctors.length ? 'No matching doctors found' : 'No active doctors found'}</strong><span>{doctors.length ? 'Try a different name or specialty.' : 'There are no active, linked doctor profiles available.'}</span></div> : <div className="doctor-grid">{filteredDoctors.map((doctor) => <div className="doctor-card" key={doctor.id}><div className="doctor-card-top"><Avatar initials={doctor.initials} color={doctor.color} size="xl"/><button className="icon-button tiny" onClick={() => setSelectedDoctor(doctor)} aria-label="Doctor details"><MoreHorizontal size={18}/></button></div><h3>{doctor.name} <Badge tone="green"><BadgeCheck size={12}/> Active</Badge></h3><p>{doctor.specialty}{doctor.department ? ` · ${doctor.department}` : ''}</p><div className="doctor-experience"><span><ShieldCheck size={15}/>{doctor.experience}</span></div><div className="doctor-availability"><span className="availability-dot"/><div><small>Appointment schedule</small><strong>{doctor.hasAvailability ? 'View available times' : 'Schedule not configured'}</strong></div></div><div className="doctor-card-bottom"><span/><button className="btn btn-primary" onClick={() => { setBooking({ ...booking, doctorId: doctor.id, startAt: '' }); setShowBooking(true); }}>Book visit <ArrowRight size={14}/></button></div></div>)}</div>}
  </>;

  const AppointmentsPage = () => <>
    <div className="page-actions"><div className="mini-stat"><span className="mini-stat-icon teal"><CalendarCheck size={18}/></span><div><strong>{appointmentsList.filter((appointment) => appointment.status === 'Scheduled').length}</strong><small>Scheduled visits</small></div></div><button className="btn btn-primary" onClick={() => setShowBooking(true)} disabled={!doctors.length}><Plus size={17}/> Book appointment</button></div>
    <div className="appointment-summary-grid"><div className="summary-tile"><span className="summary-icon blue"><CalendarDays size={18}/></span><span>Scheduled visits</span><strong>{appointmentStatusCounts.scheduled.toString().padStart(2, '0')}</strong><small>Saved to your account</small></div><div className="summary-tile"><span className="summary-icon green"><CheckCircle2 size={18}/></span><span>Completed visits</span><strong>{appointmentStatusCounts.completed.toString().padStart(2, '0')}</strong><small>Saved to your account</small></div><div className="summary-tile"><span className="summary-icon orange"><Clock3 size={18}/></span><span>Cancelled visits</span><strong>{appointmentStatusCounts.cancelled.toString().padStart(2, '0')}</strong><small>Saved to your account</small></div></div>
    <section className="panel page-panel"><SectionHeading title="Your appointments" subtitle="Appointments saved to your account"/>{portalLoading ? <div className="empty-state">Loading appointments…</div> : <div className="appointment-list">{appointmentsList.map((appointment) => <div className="appointment-list-row" key={appointment.id}><AppointmentCard appointment={appointment}/>{appointment.status === 'Scheduled' && <button className="subtle-link" onClick={() => cancelAppointment(appointment.id)}>Cancel visit</button>}</div>)}</div>}{!portalLoading && appointmentsList.length === 0 && <div className="empty-state"><CalendarDays size={30}/><strong>No appointments yet</strong><span>Your booked visits will appear here.</span></div>}</section>
    <div className="info-banner"><span className="info-banner-icon"><AlertCircle size={19}/></span><div><strong>Need to reschedule?</strong><p>Cancel a scheduled visit, then choose another available time.</p></div><button className="text-button" onClick={() => setShowBooking(true)} disabled={!doctors.length}>Book a new time <ArrowRight size={14}/></button></div>
  </>;

  const MedicalRecordsPage = () => <>
    <div className="records-hero"><div className="records-hero-icon"><FileHeart size={28}/></div><div><h2>Your health, all in one place.</h2><p>Securely access records explicitly saved by your care team.</p></div><div className="records-hero-count"><strong>{portalLoading ? '—' : recordsTotal.toString().padStart(2, '0')}</strong><span>Documents available</span></div></div>
    <div className="section-heading records-heading"><div><h2>All documents</h2><p>Browse records linked to your patient account</p></div></div>
    <div className="filter-row"><div className="search-field"><Search size={17}/><input placeholder="Search your records" value={search} onChange={e => setSearch(e.target.value)}/></div><select className="filter-select" value={recordFilter} onChange={e => setRecordFilter(e.target.value)}><option>All records</option>{[...new Set(records.map((record) => record.category))].map(category => <option key={category}>{category}</option>)}</select></div>
    <section className="panel records-table-panel"><div className="table-scroll"><table><thead><tr><th>RECORD NAME</th><th>PROVIDER</th><th>DATE ADDED</th><th>TYPE</th><th></th></tr></thead><tbody>{filteredRecords.map((record) => <tr key={record.id}><td><button className="table-record" onClick={() => setSelectedRecord(record)}><span className={`record-icon ${record.tint}`}><record.icon size={17}/></span><span><strong>{record.title}</strong><small>{record.recordId}</small></span></button></td><td>{record.doctor}</td><td>{record.date}</td><td><span className="record-type">{record.category}</span></td><td><button className="icon-button tiny" onClick={() => setSelectedRecord(record)} aria-label="Open record"><ArrowRight size={16}/></button></td></tr>)}</tbody></table>{portalLoading ? <div className="empty-state">Loading your medical records…</div> : filteredRecords.length === 0 && <div className="empty-state"><FileText size={28}/><strong>{records.length ? 'No matching records' : 'No medical records saved'}</strong><span>{records.length ? 'Try changing your search or filter.' : 'Records will appear after your care team saves them to your account.'}</span></div>}</div></section><p className="privacy-note"><ShieldCheck size={15}/> Records are read from your account and are not generated by this portal.</p>
  </>;

  const HealthInsightsPage = () => <section className="panel health-note-panel"><div className="note-icon"><ShieldCheck size={20}/></div><div><strong>No wellness insights are available yet</strong><p>This portal does not generate health measurements. Insights will only appear after a supported health-data integration records them to your account.</p></div></section>;

  const ProfilePage = () => <div className="profile-layout">
    <section className="panel profile-card"><div className="profile-cover"><div className="cover-shape cover-shape-one"/><div className="cover-shape cover-shape-two"/></div>
      <div className="profile-main"><Avatar initials={initials(profile.name)} color="blue" size="profile"/><div className="profile-title"><h2>{profile.name || 'Patient'}</h2><p>Patient account</p><Badge tone="green"><ShieldCheck size={12}/> Verified patient</Badge></div><button className="btn btn-outline" onClick={() => { setProfileDraft(profile); setProfileEditing(true); }}><Settings size={15}/> Edit profile</button></div>
      <div className="profile-divider"/><div className="profile-section-title"><h3>Personal information</h3><span>Your details are kept private</span></div>
      <div className="profile-fields"><div><small>Full name</small><strong>{profile.name || 'Not provided'}</strong></div><div><small>Email address</small><strong>{profile.email || 'Not provided'}</strong></div><div><small>Phone number</small><strong>{profile.phone || 'Not provided'}</strong></div><div><small>Date of birth</small><strong>{profile.dob ? new Date(`${profile.dob}T12:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }) : 'Not provided'}</strong></div><div><small>Blood group</small><strong>{profile.blood || 'Not provided'}</strong></div><div><small>Emergency contact</small><strong>{profile.emergency || 'Not provided'}</strong></div></div>
    </section>
    <div className="profile-side"><section className="panel insurance-card"><div className="heading-with-icon"><span className="mini-icon teal"><ShieldCheck size={17}/></span><h3>Account & privacy</h3></div><p>Manage your account preferences and personal data.</p><div className="privacy-list"><div><span><ShieldCheck size={16}/></span><div><strong>Privacy settings</strong><small>Clinical access is limited to authorized care relationships</small></div><ChevronRight size={16}/></div><div><span><Bell size={16}/></span><div><strong>Notifications</strong><small>No notification service is configured</small></div><ChevronRight size={16}/></div><div><span><CircleHelp size={16}/></span><div><strong>Help & support</strong><small>Get assistance with your account</small></div><ChevronRight size={16}/></div></div></section><section className="panel blood-card"><div className="blood-card-icon"><Droplets size={19}/></div><span>YOUR BLOOD GROUP</span><strong>{profile.blood || 'Not provided'}</strong><p>Update this information in your profile if needed.</p></section></div>
  </div>;

  const HelpPage = () => <div className="help-layout"><section className="panel help-hero"><span className="help-hero-icon"><MessageCircle size={28}/></span><h2>We're here to help.</h2><p>Find the support you need to make the most of your patient portal.</p><button className="btn btn-primary" onClick={() => notify('Support is not configured for this portal yet.')}>Contact support <ArrowRight size={15}/></button></section><div className="help-cards"><button className="panel help-card" onClick={() => notify('FAQs are not configured for this portal yet.')}><span className="help-card-icon teal"><CircleHelp size={20}/></span><strong>Frequently asked questions</strong><p>Answers to common questions about your portal.</p><ArrowRight size={17}/></button><button className="panel help-card" onClick={() => notify('Privacy support is not configured for this portal yet.')}><span className="help-card-icon purple"><ShieldCheck size={20}/></span><strong>Privacy & security</strong><p>Learn how your health information should be protected.</p><ArrowRight size={17}/></button><button className="panel help-card" onClick={() => setShowBooking(true)}><span className="help-card-icon orange"><CalendarDays size={20}/></span><strong>Appointment assistance</strong><p>Need help planning or changing a visit?</p><ArrowRight size={17}/></button></div></div>;

  const renderPage = () => {
    if (page === 'Dashboard') return <Dashboard/>;
    if (page === 'Find a doctor') return <FindDoctorPage/>;
    if (page === 'Appointments') return <AppointmentsPage/>;
    if (page === 'Medical records') return <MedicalRecordsPage/>;
    if (page === 'Health insights') return <HealthInsightsPage/>;
    if (page === 'My profile') return <ProfilePage/>;
    return <HelpPage/>;
  };

  return <div className="app-shell"><Sidebar/>{mobileNav && <button className="mobile-overlay" onClick={() => setMobileNav(false)} aria-label="Close navigation"/>}<div className="main-shell"><Header/><main className="main-content"><div className="page-title-row"><div><h1>{pageMeta[page][0]}</h1><p>{pageMeta[page][1]}</p></div><div className="today-pill"><span className="today-dot"/><span>{new Date().toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})}</span></div></div>{renderPage()}<footer className="main-footer"><span>© 2026 MediCare Patient Portal</span><span><ShieldCheck size={14}/> Your health information deserves care.</span><button onClick={() => go('Help & support')}>Need help?</button></footer></main></div>
    {showBooking && <Modal title="Book an appointment" onClose={() => setShowBooking(false)}><form className="modal-form" onSubmit={addBooking}>
      <label>Choose a doctor<select required value={booking.doctorId} onChange={event => setBooking({ ...booking, doctorId: event.target.value, startAt: '' })}><option value="">Select a doctor</option>{doctors.map(doctor => <option key={doctor.id} value={doctor.id}>{doctor.name} · {doctor.specialty}</option>)}</select></label>
      <div className="form-two"><label>Date<input type="date" required min={formatDateKey(Date.now())} value={booking.date} onChange={event => setBooking({ ...booking, date: event.target.value, startAt: '' })}/></label>
      <label>Available time<select required value={booking.startAt} onChange={event => setBooking({ ...booking, startAt: event.target.value })} disabled={slotsLoading || !bookingSlots.length}><option value="">{slotsLoading ? 'Loading times…' : 'Select an available time'}</option>{bookingSlots.map(slot => <option key={slot.startAt} value={slot.startAt}>{slot.time} ({slotTimeZone})</option>)}</select></label></div>
      {slotsError && <p className="form-error">{slotsError}</p>}
      {!slotsLoading && booking.doctorId && !bookingSlots.length && !slotsError && <p className="modal-note"><CalendarDays size={16}/><span>{doctors.find(doctor => doctor.id === booking.doctorId)?.hasAvailability ? 'No available times for this doctor on the selected date.' : 'This doctor has not configured an appointment schedule.'}</span></p>}
      <label>Reason for visit<input value={booking.reason} onChange={event => setBooking({ ...booking, reason: event.target.value })} placeholder="Briefly describe your visit" maxLength={500} required/></label>
      <div className="modal-note"><ShieldCheck size={16}/><span>Only times available in the doctor’s saved schedule can be booked.</span></div>
      <div className="modal-actions"><button type="button" className="btn btn-outline" onClick={() => setShowBooking(false)}>Cancel</button><button type="submit" className="btn btn-primary" disabled={bookingSaving || slotsLoading || !booking.startAt || !doctors.length}>{bookingSaving ? 'Saving…' : 'Request appointment'} <ArrowRight size={15}/></button></div>
    </form></Modal>}
    {selectedRecord && <Modal title={selectedRecord.title} onClose={() => setSelectedRecord(null)}><div className="record-detail"><span className={`record-icon ${selectedRecord.tint}`}><selectedRecord.icon size={22}/></span><Badge tone="blue">{selectedRecord.category}</Badge><p>{selectedRecord.description}</p><div className="detail-line"><span>Record ID</span><strong>{selectedRecord.recordId}</strong></div><div className="detail-line"><span>Provider</span><strong>{selectedRecord.doctor}</strong></div><div className="detail-line"><span>Date</span><strong>{selectedRecord.date}</strong></div><div className="modal-note"><ShieldCheck size={16}/><span>This content is from the medical record saved to your patient account.</span></div></div></Modal>}
    {selectedDoctor && <Modal title="Doctor profile" onClose={() => setSelectedDoctor(null)}><div className="doctor-detail"><Avatar initials={selectedDoctor.initials} color={selectedDoctor.color} size="xl"/><h3>{selectedDoctor.name}</h3><p>{selectedDoctor.specialty}{selectedDoctor.department ? ` · ${selectedDoctor.department}` : ''}</p><div className="detail-line"><span>Qualifications</span><strong>{selectedDoctor.experience}</strong></div><div className="detail-line"><span>Schedule</span><strong>{selectedDoctor.hasAvailability ? 'Configured' : 'Not configured'}</strong></div><button className="btn btn-primary full-btn" onClick={() => { setBooking({ ...booking, doctorId: selectedDoctor.id, startAt: '' }); setSelectedDoctor(null); setShowBooking(true); }}>Book appointment <ArrowRight size={15}/></button></div></Modal>}
    {profileEditing && <Modal title="Edit your profile" onClose={() => setProfileEditing(false)}><form className="modal-form" onSubmit={saveProfile}><label>Full name<input required value={profileDraft.name} onChange={event => setProfileDraft({ ...profileDraft, name: event.target.value })}/></label><label>Email address<input type="email" required value={profileDraft.email} onChange={event => setProfileDraft({ ...profileDraft, email: event.target.value })}/></label><label>Phone number<input value={profileDraft.phone} onChange={event => setProfileDraft({ ...profileDraft, phone: event.target.value })}/></label><div className="form-two"><label>Date of birth<input type="date" value={profileDraft.dob} onChange={event => setProfileDraft({ ...profileDraft, dob: event.target.value })}/></label><label>Blood group<select value={profileDraft.blood} onChange={event => setProfileDraft({ ...profileDraft, blood: event.target.value })}><option value="">Not provided</option>{['A+','A-','B+','B-','AB+','AB-','O+','O-','Unknown'].map(value => <option key={value}>{value}</option>)}</select></label></div><label>Emergency contact<input value={profileDraft.emergency} onChange={event => setProfileDraft({ ...profileDraft, emergency: event.target.value })}/></label><div className="modal-actions"><button type="button" className="btn btn-outline" onClick={() => setProfileEditing(false)}>Cancel</button><button type="submit" className="btn btn-primary"><Check size={15}/> Save changes</button></div></form></Modal>}
    {toast && <div className="toast"><span><Check size={15}/></span>{toast}<button onClick={()=>setToast('')} aria-label="Dismiss notification"><X size={14}/></button></div>}
  </div>;
}
