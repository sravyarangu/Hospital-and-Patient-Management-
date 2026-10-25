import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Activity, AlertTriangle, ArrowRight, CalendarClock, CalendarDays,
  Check, ChevronLeft, ChevronRight, ClipboardList, Clock3, FileHeart, FileText, HeartPulse,
  LayoutDashboard, LogOut, Menu, Network, Plus, RefreshCw, Search, Settings,
  ShieldCheck, Stethoscope, UserRound, UsersRound, X,
} from 'lucide-react';
import { requestApi } from './api.js';

const doctorNavigation = [
  { label: 'Overview', path: '/doctor/dashboard', icon: LayoutDashboard },
  { label: 'My appointments', path: '/doctor/appointments', icon: CalendarDays },
  { label: 'My patients', path: '/doctor/patients', icon: UsersRound },
  { label: 'Consultations', path: '/doctor/consultations', icon: Stethoscope },
  { label: 'Medical records', path: '/doctor/medical-records', icon: FileHeart },
  { label: 'Follow-ups', path: '/doctor/follow-ups', icon: CalendarClock },
  { label: 'My availability', path: '/doctor/availability', icon: Clock3 },
  { label: 'My profile', path: '/doctor/profile', icon: UserRound },
];
const calendarStartHour = 0;
const calendarEndHour = 24;
const defaultAppointmentDurationMinutes = 30;
const weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const weekdays = [1, 2, 3, 4, 5, 6, 0];

function blankAvailability() {
  return weekdays.map((day) => ({ day, enabled: false, start: '', end: '', breakStart: '', breakEnd: '' }));
}

function startOfDay(value) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function startOfWeek(value) {
  const date = startOfDay(value);
  date.setDate(date.getDate() - date.getDay());
  return date;
}

function startOfMonth(value) {
  const date = new Date(value);
  date.setDate(1);
  date.setHours(0, 0, 0, 0);
  return date;
}

function addDays(value, count) {
  const date = new Date(value);
  date.setDate(date.getDate() + count);
  return date;
}

function calendarRange(date, view) {
  if (view === 'month') {
    const firstDay = startOfMonth(date);
    const start = startOfWeek(firstDay);
    const nextMonth = new Date(firstDay.getFullYear(), firstDay.getMonth() + 1, 1);
    const end = startOfWeek(nextMonth);
    return { start, end: end < nextMonth ? addDays(end, 7) : end };
  }
  const start = view === 'day' ? startOfDay(date) : startOfWeek(date);
  const end = addDays(start, view === 'day' ? 1 : 7);
  return { start, end };
}

function calendarDays(start, end) {
  const dates = [];
  for (let date = startOfDay(start); date < end; date = addDays(date, 1)) dates.push(date);
  return dates;
}

function localDateKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatRangeLabel(start, end, view) {
  if (view === 'month') return start.toLocaleDateString([], { month: 'long', year: 'numeric' });
  if (view === 'day') return start.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const lastDay = addDays(end, -1);
  const startLabel = start.toLocaleDateString([], { month: 'short', day: 'numeric' });
  const endLabel = lastDay.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  return `${startLabel} – ${endLabel}`;
}

function localDateTimeValue(value) {
  const date = new Date(value);
  return new Date(date.valueOf() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function appointmentEnd(item) {
  const explicitEnd = item.endsAt || item.endAt;
  const durationMinutes = Number(item.durationMinutes || item.duration);
  const start = new Date(item.scheduledAt);
  if (explicitEnd && !Number.isNaN(new Date(explicitEnd).valueOf())) return new Date(explicitEnd);
  return new Date(start.valueOf() + (Number.isFinite(durationMinutes) && durationMinutes > 0 ? durationMinutes : defaultAppointmentDurationMinutes) * 60000);
}

function layoutDayAppointments(items, day) {
  const dayKey = localDateKey(day);
  const gridStart = new Date(day);
  gridStart.setHours(calendarStartHour, 0, 0, 0);
  const gridEnd = new Date(day);
  gridEnd.setHours(calendarEndHour, 0, 0, 0);
  const appointments = items.map((item) => {
    const start = new Date(item.scheduledAt);
    const end = appointmentEnd(item);
    if (!item._id || Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf()) || end <= start || start >= gridEnd || end <= gridStart) return null;
    const visibleStart = new Date(Math.max(start.valueOf(), gridStart.valueOf()));
    const visibleEnd = new Date(Math.min(end.valueOf(), gridEnd.valueOf()));
    if (visibleEnd <= visibleStart) return null;
    return {
      ...item,
      start,
      end,
      visibleStart,
      visibleEnd,
      continuesFromPreviousDay: localDateKey(start) !== dayKey,
      top: (visibleStart.valueOf() - gridStart.valueOf()) / 60000,
      height: Math.max(24, (visibleEnd.valueOf() - visibleStart.valueOf()) / 60000),
    };
  }).filter(Boolean).sort((a, b) => a.start - b.start || a.end - b.end);
  const columns = [];
  appointments.forEach((appointment) => {
    let column = columns.findIndex((end) => end <= appointment.start);
    if (column < 0) column = columns.length;
    columns[column] = appointment.end;
    appointment.column = column;
  });
  appointments.forEach((appointment) => {
    const overlaps = appointments.filter((other) => other.start < appointment.end && other.end > appointment.start);
    appointment.columnCount = Math.max(1, ...overlaps.map((other) => other.column + 1));
  });
  return appointments;
}

function displayDate(value, withTime = true) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? '—' : date.toLocaleString([], withTime
    ? { dateStyle: 'medium', timeStyle: 'short' }
    : { dateStyle: 'medium' });
}

function displayTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? '—' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function displayDateInTimeZone(value, timeZone) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? '—' : date.toLocaleString([], { timeZone, dateStyle: 'medium', timeStyle: 'short' });
}

function dateKeyInTimeZone(value, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value)).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function Badge({ value }) {
  const status = String(value || 'unknown').toLowerCase();
  return <span className={`doctor-badge ${status}`}>{String(value || 'Unknown').replaceAll('_', ' ')}</span>;
}

function useResource(path, dependencies = []) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const reload = useCallback(async (signal) => {
    setLoading(true);
    setError('');
    try {
      setData(await requestApi(path, { signal }));
    } catch (loadError) {
      if (loadError.name !== 'AbortError') setError(loadError.message);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [path]);
  useEffect(() => {
    const controller = new AbortController();
    reload(controller.signal);
    return () => controller.abort();
  }, [reload]);
  return { data, setData, loading, error, reload };
}

function useAllAppointments(path) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const reload = useCallback(async (signal) => {
    setLoading(true);
    setError('');
    try {
      const firstPage = await requestApi(path, { signal });
      const [pathname, queryString = ''] = path.split('?');
      const pageCount = Number.isInteger(firstPage.pages) && firstPage.pages > 0 ? firstPage.pages : 1;
      const pageRequests = Array.from({ length: pageCount - 1 }, (_, index) => {
        const query = new URLSearchParams(queryString);
        query.set('page', String(index + 2));
        return requestApi(`${pathname}?${query}`, { signal });
      });
      const remainingPages = await Promise.all(pageRequests);
      const uniqueItems = new Map([...(firstPage.items || []), ...remainingPages.flatMap((page) => page.items || [])].map((item) => [item._id, item]));
      setData({ ...firstPage, items: [...uniqueItems.values()] });
    } catch (loadError) {
      if (loadError.name !== 'AbortError') setError(loadError.message);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [path]);
  useEffect(() => {
    const controller = new AbortController();
    reload(controller.signal);
    return () => controller.abort();
  }, [reload]);
  return { data, loading, error, reload };
}

function LoadingState({ label = 'Loading clinical workspace…' }) {
  return <div className="doctor-loading" role="status"><span/>{label}</div>;
}

function ErrorState({ message, retry }) {
  return <div className="doctor-error" role="alert"><AlertTriangle size={17}/><span>{message}</span>{retry && <button onClick={retry}><RefreshCw size={14}/> Retry</button>}</div>;
}

function EmptyState({ title, message, action }) {
  return <div className="doctor-empty"><FileHeart size={25}/><h2>{title}</h2><p>{message}</p>{action}</div>;
}

function PageHeading({ eyebrow = 'CLINICAL WORKSPACE', title, subtitle, action }) {
  return <div className="doctor-heading"><div><span className="doctor-eyebrow">{eyebrow}</span><h1>{title}</h1><p>{subtitle}</p></div>{action}</div>;
}

function DoctorLayout({ user, onLogout }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const current = doctorNavigation.find((item) => item.path === window.location.pathname) || doctorNavigation[0];
  async function signOut() {
    setError('');
    try {
      await onLogout();
      navigate('/', { replace: true });
    } catch (logoutError) {
      setError(logoutError.message);
    }
  }
  function keepDoctorNavigationInTab(event) {
    const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (!anchor || anchor.hasAttribute('download')) return;

    const destination = new URL(anchor.href, window.location.href);
    if (destination.origin !== window.location.origin
      || (destination.pathname !== '/doctor' && !destination.pathname.startsWith('/doctor/'))) return;

    event.preventDefault();
    navigate(`${destination.pathname}${destination.search}${destination.hash}`);
  }
  const message = (result, fallback) => {
    if (result?.graphSync === 'failed') {
      setError(`${fallback} The MongoDB change was saved, but graph synchronization failed; contact your administrator for reconciliation.`);
      setNotice('');
      return;
    }
    setNotice(fallback);
    setError('');
  };
  const actions = { message, clearNotice: () => setNotice(''), setError };
  return <div className="doctor-app" onClickCapture={keepDoctorNavigationInTab}>
    <aside className={`doctor-sidebar ${menuOpen ? 'open' : ''}`}>
      <Link to="/doctor/dashboard" className="doctor-brand"><span><HeartPulse size={20}/></span><b>medicare<em>.</em><small>DOCTOR WORKSPACE</small></b></Link>
      <div className="doctor-account"><span><Stethoscope size={17}/></span><div><strong>{user.name}</strong><small>Clinical team</small></div><ShieldCheck size={15}/></div>
      <nav aria-label="Doctor workspace navigation"><small className="doctor-nav-heading">MY WORKSPACE</small>{doctorNavigation.map(({ label, path, icon: Icon }) => <NavLink key={path} to={path} end={path === '/doctor/dashboard'} onClick={() => setMenuOpen(false)} className={({ isActive }) => `doctor-nav-link${isActive ? ' active' : ''}`}><Icon size={17}/><span>{label}</span></NavLink>)}</nav>
      <div className="doctor-sidebar-bottom"><div><ShieldCheck size={15}/><span>Patient information is limited to your care assignments.</span></div><button className="doctor-nav-link sign-out" onClick={signOut}><LogOut size={17}/> Sign out securely</button><small>© 2026 MediCare</small></div>
    </aside>
    {menuOpen && <button className="doctor-scrim" onClick={() => setMenuOpen(false)} aria-label="Close navigation"/>}
    <main className="doctor-main">
      <header className="doctor-topbar"><button className="doctor-menu-button" aria-label="Open navigation" onClick={() => setMenuOpen(true)}><Menu size={19}/></button><div className="doctor-crumb"><span>Clinical workspace</span><ChevronRight size={14}/><strong>{current.label}</strong></div><span className="doctor-session"><ShieldCheck size={14}/> Secure doctor session</span><span className="doctor-user-initial">{user.name?.slice(0, 1).toUpperCase()}</span></header>
      <div className="doctor-content">
        {notice && <div className="doctor-message success"><Check size={15}/>{notice}<button onClick={actions.clearNotice} aria-label="Dismiss"><X size={14}/></button></div>}
        {error && <div className="doctor-message error"><AlertTriangle size={15}/>{error}<button onClick={() => setError('')} aria-label="Dismiss"><X size={14}/></button></div>}
        <Routes>
          <Route index element={<Navigate to="dashboard" replace/>}/>
          <Route path="dashboard" element={<DoctorOverview user={user} {...actions}/>}/>
          <Route path="appointments" element={<DoctorAppointments {...actions}/>}/>
          <Route path="patients" element={<DoctorPatients/>}/>
          <Route path="patients/:patientId" element={<DoctorPatientDetails/>}/>
          <Route path="consultations" element={<DoctorConsultations/>}/>
          <Route path="consultations/new/:appointmentId" element={<ConsultationForm {...actions}/>}/>
          <Route path="medical-records" element={<DoctorMedicalRecords {...actions}/>}/>
          <Route path="follow-ups" element={<DoctorFollowUps {...actions}/>}/>
          <Route path="availability" element={<DoctorAvailability {...actions}/>}/>
          <Route path="profile" element={<DoctorProfile {...actions}/>}/>
          <Route path="*" element={<Navigate to="/doctor/dashboard" replace/>}/>
        </Routes>
        <footer className="doctor-footer"><ShieldCheck size={14}/> Clinical information is shown only for patients linked to your care.</footer>
      </div>
    </main>
  </div>;
}

export default function DoctorPortal({ user, onLogout }) {
  return <DoctorLayout user={user} onLogout={onLogout}/>;
}

function AppointmentCalendar({ compact = false, message }) {
  const [searchParams] = useSearchParams();
  const [date, setDate] = useState(() => {
    const requestedDate = searchParams.get('date');
    const parsedDate = requestedDate ? new Date(`${requestedDate}T00:00:00`) : new Date();
    return Number.isNaN(parsedDate.valueOf()) ? new Date() : parsedDate;
  });
  const [view, setView] = useState(compact ? 'week' : 'month');
  const [presentation, setPresentation] = useState('calendar');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [selectedId, setSelectedId] = useState(() => searchParams.get('appointment') || '');
  const [rescheduleAt, setRescheduleAt] = useState('');
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState('');
  const [relatedConsultation, setRelatedConsultation] = useState(null);
  const [expandedDays, setExpandedDays] = useState(() => new Set());
  const range = calendarRange(date, view);
  const query = new URLSearchParams({
    page: '1',
    limit: '100',
    status,
    from: addDays(range.start, -1).toISOString(),
    to: new Date(range.end.valueOf() - 1).toISOString(),
  });
  if (search.trim()) query.set('search', search.trim());
  const path = `/doctor/appointments?${query}`;
  const { data, loading, error, reload } = useAllAppointments(path);
  const items = [...new Map((data?.items || [])
    .filter((item) => {
      const start = new Date(item.scheduledAt);
      if (!item._id || Number.isNaN(start.valueOf())) return false;
      const end = appointmentEnd(item);
      return !Number.isNaN(end.valueOf()) && end > range.start && start < range.end;
    })
    .map((item) => [item._id, item])).values()];
  const selected = items.find((item) => item._id === selectedId) || null;
  const dates = view === 'day' ? [startOfDay(date)] : Array.from({ length: view === 'week' ? 7 : 0 }, (_, index) => addDays(range.start, index));
  const monthDates = view === 'month' ? calendarDays(range.start, range.end) : [];
  const now = new Date();

  useEffect(() => {
    let active = true;
    setRelatedConsultation(null);
    setActionError('');
    if (!selectedId) return () => { active = false; };
    requestApi(`/doctor/consultations?appointmentId=${encodeURIComponent(selectedId)}`)
      .then((result) => {
        if (active) setRelatedConsultation(result.items?.[0] || null);
      })
      .catch((requestError) => {
        if (active) setActionError(requestError.message);
      });
    return () => { active = false; };
  }, [selectedId]);

  async function updateStatus(appointment, nextStatus) {
    if (nextStatus === 'cancelled' && !window.confirm('Cancel this appointment?')) return;
    setSaving(true);
    setActionError('');
    try {
      const result = await requestApi(`/doctor/appointments/${appointment._id}/status`, { method: 'PATCH', body: { status: nextStatus } });
      message?.(result, `Appointment ${nextStatus}.`);
      await reload();
    } catch (requestError) {
      setActionError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  async function reschedule(event) {
    event.preventDefault();
    if (!selected || !rescheduleAt) return;
    setSaving(true);
    setActionError('');
    try {
      const result = await requestApi(`/doctor/appointments/${selected._id}/reschedule`, {
        method: 'PATCH',
        body: { scheduledAt: new Date(rescheduleAt).toISOString() },
      });
      message?.(result, 'Appointment rescheduled.');
      setSelectedId('');
      setRescheduleAt('');
      await reload();
    } catch (requestError) {
      setActionError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  function moveDate(direction) {
    setDate((current) => {
      if (view === 'month') return new Date(current.getFullYear(), current.getMonth() + direction, 1);
      return addDays(current, direction * (view === 'day' ? 1 : 7));
    });
  }

  function inspectDay(day) {
    setDate(startOfDay(day));
    setView('day');
    setPresentation('calendar');
  }

  function toggleExpanded(dayKey) {
    setExpandedDays((current) => {
      const next = new Set(current);
      if (next.has(dayKey)) next.delete(dayKey);
      else next.add(dayKey);
      return next;
    });
  }

  return <>
    {!compact && <PageHeading title="My appointments" subtitle="View and manage your doctor-scoped schedule."/>}
    <section className={`doctor-panel doctor-calendar-panel${compact ? ' compact' : ''}`} aria-label="Appointment calendar">
      <div className="doctor-calendar-toolbar">
        <div className="doctor-calendar-navigation" role="group" aria-label="Calendar date navigation">
          <button className="doctor-calendar-icon-button" type="button" onClick={() => moveDate(-1)} aria-label={view === 'month' ? 'Previous month' : view === 'day' ? 'Previous day' : 'Previous week'}><ChevronLeft size={16}/></button>
          <button className="doctor-calendar-today" type="button" onClick={() => setDate(new Date())}>Today</button>
          <button className="doctor-calendar-icon-button" type="button" onClick={() => moveDate(1)} aria-label={view === 'month' ? 'Next month' : view === 'day' ? 'Next day' : 'Next week'}><ChevronRight size={16}/></button>
        </div>
        <div className="doctor-calendar-date" aria-live="polite">
          <strong>{formatRangeLabel(date, range.end, view)}</strong>
          <span>{items.length} appointment{items.length === 1 ? '' : 's'} in view</span>
        </div>
        <div className="doctor-calendar-controls">
          <div className="doctor-view-switch" role="group" aria-label="Calendar time range">
            {!compact && <button type="button" className={view === 'month' ? 'active' : ''} aria-pressed={view === 'month'} onClick={() => setView('month')}>Month</button>}
            <button type="button" className={view === 'week' ? 'active' : ''} aria-pressed={view === 'week'} onClick={() => setView('week')}>Week</button>
            <button type="button" className={view === 'day' ? 'active' : ''} aria-pressed={view === 'day'} onClick={() => setView('day')}>Day</button>
          </div>
          {!compact && <div className="doctor-view-switch" role="group" aria-label="Calendar presentation">
            <button type="button" className={presentation === 'calendar' ? 'active' : ''} aria-pressed={presentation === 'calendar'} onClick={() => setPresentation('calendar')}>Calendar</button>
            <button type="button" className={presentation === 'list' ? 'active' : ''} aria-pressed={presentation === 'list'} onClick={() => setPresentation('list')}>List</button>
          </div>}
        </div>
      </div>
      {!compact && <div className="doctor-calendar-filters">
        <label className="doctor-search"><Search size={15}/><input aria-label="Search appointments" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search patient or appointment ID"/></label>
        <label className="doctor-calendar-status">Status
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="all">All statuses</option><option value="scheduled">Scheduled</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option>
          </select>
        </label>
        <button className="doctor-calendar-icon-button" type="button" onClick={() => reload()} aria-label="Refresh appointments"><RefreshCw size={14}/></button>
      </div>}
      <p className="doctor-calendar-duration-note">Appointments use their stored end time or duration when available; otherwise, the calendar displays a 30-minute slot.</p>
      {actionError && <ErrorState message={actionError}/>}
      {loading ? <LoadingState label="Loading appointments…"/> : error ? <ErrorState message={error} retry={() => reload()}/> : presentation === 'list' && !compact
        ? items.length
          ? <AppointmentsTable items={items} onView={(item) => setSelectedId(item._id)} onStatus={updateStatus} saving={saving}/>
          : <EmptyState title="No appointments in this date range" message="Try another date range, status, or search."/>
        : view === 'month' && !compact
          ? <MonthAppointmentGrid dates={monthDates} items={items} today={now} expandedDays={expandedDays} emptyMessage={search || status !== 'all' ? 'No appointments match the selected search or status.' : 'No appointments scheduled for this month.'} onExpand={toggleExpanded} onInspectDay={inspectDay} onSelectAppointment={(item) => setSelectedId(item._id)}/>
          : <TimeAppointmentGrid dates={dates} view={view} items={items} now={now} onSelectAppointment={(item) => setSelectedId(item._id)} />}
    </section>
    {selected && <div className="doctor-dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setSelectedId('')}><section className="doctor-dialog" role="dialog" aria-modal="true" aria-labelledby="appointment-detail-title">
      <header><div><span className="doctor-eyebrow">APPOINTMENT DETAIL</span><h2 id="appointment-detail-title">{selected.appointmentId || 'Appointment'}</h2></div><button className="doctor-icon-link" type="button" onClick={() => setSelectedId('')} aria-label="Close appointment details"><X size={18}/></button></header>
      <dl><div><dt>Patient</dt><dd>{selected.patient?.name || 'Patient'}</dd></div><div><dt>Patient identifier</dt><dd>{selected.patient?.patientIdentifier || 'Not available'}</dd></div><div><dt>Scheduled time</dt><dd>{displayDate(selected.scheduledAt)}</dd></div><div><dt>Display end time</dt><dd>{displayDate(appointmentEnd(selected))}</dd></div><div><dt>Reason</dt><dd>{selected.reason || 'Not provided'}</dd></div><div><dt>Status</dt><dd><Badge value={selected.status}/></dd></div><div><dt>Graph sync</dt><dd><Badge value={selected.graphSync?.status || 'pending'}/></dd></div></dl>
      {relatedConsultation && <section className="doctor-calendar-related"><span className="doctor-eyebrow">RELATED CONSULTATION · {relatedConsultation.status}</span><strong>{relatedConsultation.diagnosis || 'Consultation draft'}</strong><p>{relatedConsultation.notes || 'No clinical notes entered yet.'}</p><Link to={`/doctor/consultations?appointmentId=${encodeURIComponent(selected._id)}`} onClick={() => setSelectedId('')}>View consultation</Link></section>}
      {actionError && <ErrorState message={actionError}/>}
      <div className="doctor-dialog-actions">
        {selected.patient?.id && <Link className="doctor-button outline" to={`/doctor/patients/${selected.patient.id}`} onClick={() => setSelectedId('')}>Patient details</Link>}
        {selected.status === 'scheduled' && <>{relatedConsultation?.status !== 'finalized' && <Link className="doctor-button primary" to={`/doctor/consultations/new/${selected._id}`} onClick={() => setSelectedId('')}>{relatedConsultation?.status === 'draft' ? 'Continue consultation' : 'Open consultation'}</Link>}{relatedConsultation?.status === 'finalized' && <button className="doctor-button outline" type="button" disabled={saving} onClick={() => updateStatus(selected, 'completed')}>Mark completed</button>}<button className="doctor-button outline" type="button" onClick={() => setRescheduleAt(localDateTimeValue(selected.scheduledAt))}>Reschedule</button><button className="doctor-button danger" type="button" disabled={saving} onClick={() => updateStatus(selected, 'cancelled')}>Cancel appointment</button></>}
      </div>
      {rescheduleAt && <form className="doctor-reschedule" onSubmit={reschedule}><label>New date and time<input type="datetime-local" required min={localDateTimeValue(new Date())} value={rescheduleAt} onChange={(event) => setRescheduleAt(event.target.value)}/></label><button className="doctor-button primary" disabled={saving}>{saving ? 'Saving…' : 'Confirm reschedule'}</button><button className="doctor-button outline" type="button" onClick={() => setRescheduleAt('')}>Keep current time</button></form>}
    </section></div>}
  </>;
}

function MonthAppointmentGrid({ dates, items, today, expandedDays, emptyMessage, onExpand, onInspectDay, onSelectAppointment }) {
  const month = dates.find((day) => day.getDate() === 1)?.getMonth();
  const weekdayLabels = Array.from({ length: 7 }, (_, index) => new Date(2023, 0, 1 + index).toLocaleDateString([], { weekday: 'long' }));
  const appointmentsByDate = new Map();
  const uniqueItems = [...new Map(items.map((item) => [item._id, item])).values()];
  dates.forEach((day) => {
    const dayStart = startOfDay(day);
    const dayEnd = addDays(dayStart, 1);
    const dayAppointments = uniqueItems.filter((item) => {
    const start = new Date(item.scheduledAt);
      const end = appointmentEnd(item);
      return item._id && !Number.isNaN(start.valueOf()) && !Number.isNaN(end.valueOf()) && end > dayStart && start < dayEnd;
    }).sort((first, second) => new Date(first.scheduledAt) - new Date(second.scheduledAt));
    appointmentsByDate.set(localDateKey(day), dayAppointments);
  });

  return <div className="doctor-month-calendar" role="region" aria-label="Monthly appointment calendar">
    <div className="doctor-month-weekdays" aria-hidden="true">{weekdayLabels.map((weekday) => <div key={weekday}>{weekday}</div>)}</div>
    <div className="doctor-month-grid">
      {dates.map((day) => {
        const key = localDateKey(day);
        const events = appointmentsByDate.get(key) || [];
        const expanded = expandedDays.has(key);
        const visibleEvents = expanded ? events : events.slice(0, 3);
        const outsideMonth = day.getMonth() !== month;
        const isToday = key === localDateKey(today);
        return <div
          key={key}
          className={`doctor-month-cell${outsideMonth ? ' outside-month' : ''}${isToday ? ' today' : ''}${events.length ? ' has-events' : ''}`}
          role="group"
          aria-label={`${day.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}, ${events.length} appointment${events.length === 1 ? '' : 's'}`}
          onClick={() => onInspectDay(day)}
        >
          <button className="doctor-month-date" type="button" onClick={(event) => { event.stopPropagation(); onInspectDay(day); }} aria-label={`Inspect ${day.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}`}>
            <span className={isToday ? 'today-number' : ''}>{day.getDate()}</span>
            {events.length > 0 && <small>{events.length}</small>}
          </button>
          <div className="doctor-month-events">
            {visibleEvents.map((appointment) => {
              const continues = localDateKey(appointment.scheduledAt) !== key;
              const endsAfterDay = localDateKey(appointmentEnd(appointment)) !== key;
              return <button
              className={`doctor-month-event ${String(appointment.status || 'unknown').toLowerCase()}`}
              key={appointment._id}
              type="button"
              onClick={(event) => { event.stopPropagation(); onSelectAppointment(appointment); }}
              aria-label={`${displayTime(appointment.scheduledAt)}, ${appointment.patient?.name || 'Patient'}, ${appointment.reason || 'reason not provided'}, ${appointment.status}`}
              title={`${displayTime(appointment.scheduledAt)} · ${appointment.patient?.name || 'Patient'}${appointment.reason ? ` · ${appointment.reason}` : ''} · ${appointment.status}`}
            >
              <span className="doctor-month-event-time">{continues ? `Continues · ${displayTime(day)}` : displayTime(appointment.scheduledAt)}{endsAfterDay ? ' · Continues' : ''}</span>
              <strong>{appointment.patient?.name || 'Patient'}</strong>
              {appointment.reason && <small>{appointment.reason}</small>}
              <em>{appointment.status || 'Unknown'}</em>
            </button>;
            })}
            {events.length > 3 && <button className="doctor-month-more" type="button" onClick={(event) => { event.stopPropagation(); onExpand(key); }}>
              {expanded ? 'Show fewer' : `+${events.length - 3} more`}
            </button>}
            {!events.length && <span className="doctor-month-empty-cell">No appointments</span>}
          </div>
        </div>;
      })}
    </div>
    {items.length === 0 && <p className="doctor-month-empty-message">{emptyMessage}</p>}
  </div>;
}

function TimeAppointmentGrid({ dates, view, items, now, onSelectAppointment }) {
  const nowMinutes = (now.getHours() - calendarStartHour) * 60 + now.getMinutes();
  return <div className="doctor-calendar-scroll" role="region" aria-label="Scrollable appointment calendar">
    <div className={`doctor-calendar-grid ${view === 'day' ? 'day-view' : 'week-view'}`}>
      <div className="doctor-calendar-corner">LOCAL TIME</div>
      {dates.map((day) => <div className={`doctor-calendar-day-heading${localDateKey(day) === localDateKey(now) ? ' today' : ''}`} key={localDateKey(day)}>
        <span>{day.toLocaleDateString([], { weekday: view === 'day' ? 'long' : 'short' })}</span>
        <strong>{day.toLocaleDateString([], { month: 'short', day: 'numeric' })}</strong>
      </div>)}
      <div className="doctor-calendar-time-axis" aria-hidden="true">
        {Array.from({ length: calendarEndHour - calendarStartHour }, (_, index) => {
          const hour = calendarStartHour + index;
          return <div key={hour}><span>{new Date(2000, 0, 1, hour).toLocaleTimeString([], { hour: 'numeric' })}</span></div>;
        })}
      </div>
      {dates.map((day) => {
        const dayEvents = layoutDayAppointments(items, day);
        const isToday = localDateKey(day) === localDateKey(now);
        return <div className={`doctor-calendar-day${isToday ? ' today' : ''}`} key={localDateKey(day)}>
          <div className="doctor-calendar-hour-lines" aria-hidden="true">
            {Array.from({ length: calendarEndHour - calendarStartHour }, (_, index) => <div key={index}/>)}
          </div>
          {isToday && nowMinutes >= 0 && nowMinutes <= (calendarEndHour - calendarStartHour) * 60 && <div className="doctor-calendar-now" style={{ top: `${nowMinutes * 2 / 3}px` }} aria-label={`Current time ${displayTime(now)}`}><i/><span>{displayTime(now)}</span></div>}
          {dayEvents.map((appointment) => <button
            key={appointment._id}
            type="button"
            className={`doctor-calendar-event ${String(appointment.status || 'unknown').toLowerCase()}`}
            style={{
              top: `${appointment.top * 2 / 3}px`,
              height: `${Math.max(24, appointment.height * 2 / 3)}px`,
              left: `calc(${appointment.column * 100 / appointment.columnCount}% + 2px)`,
              width: `calc(${100 / appointment.columnCount}% - 4px)`,
            }}
            onClick={() => onSelectAppointment(appointment)}
            aria-label={`${displayTime(appointment.visibleStart)} to ${displayTime(appointment.visibleEnd)}, ${appointment.patient?.name || 'Patient'}, ${appointment.reason || 'reason not provided'}, ${appointment.status}`}
          >
            <strong>{appointment.continuesFromPreviousDay
              ? `Continued · ${displayTime(appointment.visibleStart)}`
              : `${displayTime(appointment.start)}–${localDateKey(appointment.end) !== localDateKey(day) ? 'continues' : displayTime(appointment.end)}`}</strong>
            <span>{appointment.patient?.name || 'Patient'}</span>
            {appointment.reason && <small>{appointment.reason}</small>}
            <em>{appointment.status || 'Unknown'}</em>
          </button>)}
        </div>;
      })}
    </div>
  </div>;
}

function DoctorOverview({ user, message }) {
  const { data, loading, error, reload } = useResource('/doctor/dashboard');
  if (loading) return <LoadingState/>;
  if (error) return <><PageHeading title="Good day" subtitle={`Welcome to your clinical workspace, Dr. ${user.name}.`}/><ErrorState message={error} retry={() => reload()}/></>;
  const metrics = data?.metrics || {};
  return <>
    <PageHeading eyebrow="YOUR CARE TEAM, TODAY" title={`Good day, Dr. ${user.name}.`} subtitle="Your clinical work at a glance, based on assigned care and saved records."/>
    <section className="doctor-metrics" aria-label="Clinical summary">
      <article><span>TODAY'S VISITS</span><strong>{metrics.todayAppointments ?? 0}</strong><small>Scheduled for today</small></article>
      <article><span>UPCOMING</span><strong>{metrics.upcomingAppointments ?? 0}</strong><small>Future scheduled visits</small></article>
      <article><span>CONSULTATIONS</span><strong>{metrics.completedConsultations ?? 0}</strong><small>Finalized records</small></article>
      <article><span>MY PATIENTS</span><strong>{metrics.assignedPatients ?? 0}</strong><small>Linked through care activity</small></article>
      <article><span>FOLLOW-UPS</span><strong>{metrics.followUpsDueSoon ?? 0}</strong><small>{metrics.overdueFollowUps ?? 0} overdue</small></article>
    </section>
    {data?.graphSyncFailures > 0 && <div className="doctor-message error"><Network size={15}/>{data.graphSyncFailures} graph update(s) need administrator reconciliation.</div>}
    <section className="doctor-dashboard-calendar">
      <div className="doctor-panel-heading"><div><span className="doctor-eyebrow">YOUR SCHEDULE</span><h2>Appointment calendar</h2></div><Link className="doctor-text-link" to="/doctor/appointments">View all appointments <ArrowRight size={14}/></Link></div>
      <AppointmentCalendar compact message={message}/>
    </section>
    <section className="doctor-panel doctor-recent"><div className="doctor-panel-heading"><div><span className="doctor-eyebrow">RECENTLY UPDATED</span><h2>Clinical activity</h2></div><Link className="doctor-text-link" to="/doctor/consultations">Consultation history <ArrowRight size={14}/></Link></div>
      {data?.recentActivity?.length ? <div className="doctor-activity-list">{data.recentActivity.map((item) => <div key={`${item.type}-${item.id}`}><span className="doctor-activity-icon">{item.type === 'consultation' ? <Stethoscope size={16}/> : <FileText size={16}/>}</span><div><strong>{item.title}</strong><small>{item.patientName} · {item.type}</small></div><time>{displayDate(item.updatedAt)}</time><Badge value={item.status}/></div>)}</div> : <p className="doctor-muted">Saved consultations and records will appear here when you create them.</p>}
    </section>
  </>;
}

function DoctorAppointments({ message }) {
  return <AppointmentCalendar message={message}/>;
}

function AppointmentsTable({ items, onView, onStatus, saving }) {
  return <div className="doctor-panel doctor-table-wrap"><div className="doctor-table-scroll"><table className="doctor-table"><thead><tr><th>TIME</th><th>PATIENT</th><th>REASON</th><th>STATUS</th><th>GRAPH SYNC</th><th>ACTIONS</th></tr></thead><tbody>{items.map((item) => <tr key={item._id}><td>{displayDate(item.scheduledAt)}</td><td><strong>{item.patient?.name}</strong><small>{item.patient?.patientIdentifier}</small></td><td>{item.reason || 'Not provided'}</td><td><Badge value={item.status}/></td><td><Badge value={item.graphSync?.status || 'pending'}/></td><td><div className="doctor-row-actions"><button onClick={() => onView(item)}>Details</button>{item.status === 'scheduled' && <><Link to={`/doctor/consultations/new/${item._id}`}>Consult</Link><button disabled={saving} onClick={() => onStatus(item, 'cancelled')}>Cancel</button></>}</div></td></tr>)}</tbody></table></div></div>;
}

function DoctorPatients() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const path = `/doctor/patients?page=${page}&limit=20&search=${encodeURIComponent(search)}`;
  const { data, loading, error, reload } = useResource(path, [path]);
  return <><PageHeading title="My patients" subtitle="Only patients linked to your appointments, consultations, or records are listed."/><label className="doctor-search doctor-wide-search"><Search size={16}/><input placeholder="Search name or patient identifier" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }}/></label>{loading ? <LoadingState/> : error ? <ErrorState message={error} retry={() => reload()}/> : data?.items?.length ? <><div className="doctor-panel doctor-table-wrap"><div className="doctor-table-scroll"><table className="doctor-table"><thead><tr><th>PATIENT</th><th>IDENTIFIER</th><th>CONTACT</th><th>ALLERGIES</th><th>NEXT APPOINTMENT</th><th></th></tr></thead><tbody>{data.items.map((patient) => <tr key={patient._id}><td><strong>{patient.name}</strong><small>Patient</small></td><td>{patient.patientIdentifier}</td><td>{patient.phone || 'Not provided'}</td><td>{Array.isArray(patient.allergies) ? patient.allergies.join(', ') || 'Not recorded' : patient.allergies || 'Not recorded'}</td><td>{displayDate(patient.nextAppointment)}</td><td><Link className="doctor-text-link" to={`/doctor/patients/${patient._id}`}>Open record <ArrowRight size={14}/></Link></td></tr>)}</tbody></table></div></div><Pagination page={page} pages={data.pages} onPage={setPage} total={data.total}/></> : <EmptyState title="No assigned patients yet" message="Patients appear here after an appointment, consultation, or record is associated with your doctor account."/>}</>;
}

function Pagination({ page, pages, total, onPage }) {
  return <div className="doctor-pagination"><span>{total} patient(s) · page {page} of {Math.max(1, pages)}</span><div><button disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button><button disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button></div></div>;
}

function DoctorPatientDetails() {
  const { patientId } = useParams();
  const { data, loading, error, reload } = useResource(`/doctor/patients/${patientId}`, [patientId]);
  if (loading) return <LoadingState label="Loading authorized patient record…"/>;
  if (error) return <><PageHeading title="Patient details" subtitle="Patient-specific access is verified by the server."/><ErrorState message={error} retry={() => reload()}/><Link className="doctor-button outline" to="/doctor/patients">Back to my patients</Link></>;
  const patient = data.patient;
  return <>
    <PageHeading eyebrow="AUTHORIZED PATIENT RECORD" title={patient.name || 'Patient'} subtitle={`Patient identifier · ${patient.patientIdentifier}` } action={<Link className="doctor-button outline" to="/doctor/patients">Back to patients</Link>}/>
    <div className="doctor-detail-grid">
      <section className="doctor-panel"><span className="doctor-eyebrow">PATIENT SUMMARY</span><h2>Demographics &amp; relevant information</h2><dl className="doctor-profile-details"><div><dt>Date of birth</dt><dd>{patient.dateOfBirth || patient.dob ? displayDate(patient.dateOfBirth || patient.dob, false) : 'Not recorded'}</dd></div><div><dt>Phone</dt><dd>{patient.phone || 'Not recorded'}</dd></div><div><dt>Email</dt><dd>{patient.email || 'Not recorded'}</dd></div><div><dt>Blood group</dt><dd>{patient.bloodGroup || patient.blood || 'Not recorded'}</dd></div><div><dt>Allergies</dt><dd>{Array.isArray(patient.allergies) ? patient.allergies.join(', ') || 'Not recorded' : patient.allergies || 'Not recorded'}</dd></div><div><dt>Medical history</dt><dd>{typeof patient.medicalHistory === 'string' ? patient.medicalHistory : 'Review documented consultations and records below.'}</dd></div></dl></section>
      <section className="doctor-panel"><span className="doctor-eyebrow">VITAL-SIGN HISTORY</span><h2>Measurements on record</h2>{data.consultations.some((item) => Object.keys(item.vitals || {}).length) ? <div className="doctor-vitals">{data.consultations.filter((item) => Object.keys(item.vitals || {}).length).map((item) => <div key={item._id}><strong>{displayDate(item.createdAt)}</strong>{Object.entries(item.vitals).map(([key, value]) => <span key={key}>{key === 'systolic' ? 'Blood pressure systolic' : key === 'diastolic' ? 'Blood pressure diastolic' : key === 'temperatureC' ? 'Temperature °C' : key === 'oxygenSaturation' ? 'SpO₂ %' : key === 'heartRate' ? 'Heart rate' : key} · {value}</span>)}</div>)}</div> : <p className="doctor-muted">No measurements have been recorded. Empty measurements are not interpreted as normal.</p>}</section>
    </div>
    <section className="doctor-panel doctor-history"><div className="doctor-panel-heading"><div><span className="doctor-eyebrow">CARE HISTORY</span><h2>Appointments</h2></div></div>{data.appointments.length ? <div className="doctor-history-list">{data.appointments.map((item) => <div key={item._id}><div><strong>{item.appointmentId}</strong><small>{item.reason || 'Reason not recorded'}</small></div><span>{displayDate(item.scheduledAt)}</span><Badge value={item.status}/>{item.status === 'scheduled' && <Link to={`/doctor/consultations/new/${item._id}`}>Open consultation</Link>}</div>)}</div> : <p className="doctor-muted">No appointment history is available.</p>}</section>
    <section className="doctor-panel doctor-history"><div className="doctor-panel-heading"><div><span className="doctor-eyebrow">SAVED CLINICAL NOTES</span><h2>Consultations &amp; medical records</h2></div></div>{[...data.consultations.map((item) => ({ ...item, type: 'Consultation' })), ...data.records.map((item) => ({ ...item, type: item.recordType || 'Medical record' }))].length ? <div className="doctor-record-history">{[...data.consultations.map((item) => ({ ...item, type: 'Consultation' })), ...data.records.map((item) => ({ ...item, type: item.recordType || 'Medical record' }))].map((item) => <article key={`${item.type}-${item._id}`}><div><span>{item.type} · {displayDate(item.createdAt)}</span><h3>{item.diagnosis || item.title || 'Clinical record'}</h3></div><Badge value={item.status || item.recordType}/><p>{item.notes || item.content || item.treatmentPlan || 'No additional text recorded.'}</p>{item.prescriptionSummary && <small>Prescription summary: {item.prescriptionSummary}</small>}{item.followUp?.recommendation && <small>Follow-up: {item.followUp.recommendation} · {displayDate(item.followUp.dueAt, false)}</small>}</article>)}</div> : <p className="doctor-muted">No consultation or medical record history is available.</p>}</section>
  </>;
}

function DoctorConsultations() {
  const [status, setStatus] = useState('all');
  const [searchParams] = useSearchParams();
  const appointmentId = searchParams.get('appointmentId');
  const query = new URLSearchParams();
  if (status !== 'all') query.set('status', status);
  if (appointmentId) query.set('appointmentId', appointmentId);
  const path = `/doctor/consultations${query.size ? `?${query}` : ''}`;
  const { data, loading, error, reload } = useResource(path, [path]);
  return <><PageHeading title="Consultations" subtitle="Review your persisted drafts and finalized consultation notes."/><div className="doctor-toolbar"><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All consultations</option><option value="draft">Drafts</option><option value="finalized">Finalized</option></select></div>{loading ? <LoadingState/> : error ? <ErrorState message={error} retry={() => reload()}/> : data?.items?.length ? <div className="doctor-panel doctor-record-history">{data.items.map((item) => <article key={item._id}><div><span>{item.patientName} · {displayDate(item.updatedAt)}</span><h3>{item.diagnosis || 'Consultation draft'}</h3></div><Badge value={item.status}/><p>{item.notes || 'No clinical notes entered yet.'}</p><small>{item.treatmentPlan || 'No treatment plan recorded.'}</small>{item.status === 'draft' && <Link to={`/doctor/consultations/new/${item.appointmentId}`}>Continue draft</Link>}</article>)}</div> : <EmptyState title="No consultations recorded" message="Start a consultation from an eligible appointment to create a clinical record." action={<Link className="doctor-button outline" to="/doctor/appointments">Find an appointment</Link>}/>}</>;
}

function ConsultationForm({ message, setError }) {
  const { appointmentId } = useParams();
  const navigate = useNavigate();
  const { data, loading, error } = useResource(`/doctor/appointments/${appointmentId}`, [appointmentId]);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ diagnosis: '', notes: '', treatmentPlan: '', prescriptionSummary: '', followRecommendation: '', followDate: '', systolic: '', diastolic: '', heartRate: '', temperatureC: '', oxygenSaturation: '' });
  useEffect(() => {
    if (!data) return;
    requestApi(`/doctor/consultations?appointmentId=${encodeURIComponent(appointmentId)}`).then((result) => {
      const existing = result.items?.find((item) => item.appointmentId === appointmentId);
      if (existing?.status === 'draft') setForm({
        diagnosis: existing.diagnosis || '', notes: existing.notes || '', treatmentPlan: existing.treatmentPlan || '', prescriptionSummary: existing.prescriptionSummary || '',
        followRecommendation: existing.followUp?.recommendation || '', followDate: existing.followUp?.dueAt ? new Date(new Date(existing.followUp.dueAt).getTime() - new Date(existing.followUp.dueAt).getTimezoneOffset() * 60000).toISOString().slice(0, 10) : '',
        systolic: existing.vitals?.systolic ?? '', diastolic: existing.vitals?.diastolic ?? '', heartRate: existing.vitals?.heartRate ?? '', temperatureC: existing.vitals?.temperatureC ?? '', oxygenSaturation: existing.vitals?.oxygenSaturation ?? '',
      });
    }).catch((loadError) => setError(loadError.message));
  }, [appointmentId, data, setError]);
  function change(field) { return (event) => setForm((previous) => ({ ...previous, [field]: event.target.value })); }
  async function submit(event, status) {
    event.preventDefault(); setSaving(true); setError('');
    const body = {
      appointmentId, status, diagnosis: form.diagnosis, notes: form.notes, treatmentPlan: form.treatmentPlan, prescriptionSummary: form.prescriptionSummary,
      followUp: { recommendation: form.followRecommendation, dueAt: form.followDate ? new Date(`${form.followDate}T12:00:00`).toISOString() : '' },
      vitals: Object.fromEntries(['systolic', 'diastolic', 'heartRate', 'temperatureC', 'oxygenSaturation'].filter((key) => form[key] !== '').map((key) => [key, Number(form[key])])),
    };
    try {
      const result = await requestApi('/doctor/consultations', { method: 'POST', body });
      message(result, status === 'draft' ? 'Consultation draft saved.' : 'Consultation finalized.');
      if (status === 'finalized') navigate('/doctor/consultations');
    } catch (saveError) { setError(saveError.message); }
    finally { setSaving(false); }
  }
  if (loading) return <LoadingState label="Verifying appointment access…"/>;
  if (error) return <ErrorState message={error}/>;
  if (!data) return null;
  return <><PageHeading eyebrow="AUTHORIZED APPOINTMENT" title="Consultation note" subtitle={`${data.patient.name} · ${data.appointment.appointmentId} · ${displayDate(data.appointment.scheduledAt)}`} action={<Link className="doctor-button outline" to="/doctor/appointments">Back to appointments</Link>}/><form className="doctor-panel doctor-form" onSubmit={(event) => submit(event, 'finalized')}><p className="doctor-clinical-warning"><ShieldCheck size={15}/> Enter only clinician-observed or verified information. Measurements and prescription summaries are never generated by the portal.</p><div className="doctor-form-grid"><label>Diagnosis<input maxLength="1000" value={form.diagnosis} onChange={change('diagnosis')} placeholder="Clinician-entered diagnosis"/></label><label>Follow-up recommendation<input maxLength="1000" value={form.followRecommendation} onChange={change('followRecommendation')} placeholder="Optional recommendation"/></label><label>Follow-up due date<input type="date" value={form.followDate} onChange={change('followDate')}/></label><label>Treatment plan<textarea maxLength="5000" rows="3" value={form.treatmentPlan} onChange={change('treatmentPlan')}/></label><label>Prescription summary<textarea maxLength="3000" rows="3" value={form.prescriptionSummary} onChange={change('prescriptionSummary')} placeholder="Summary supplied by the treating clinician"/></label><label className="doctor-field-wide">Clinical notes<textarea maxLength="10000" rows="5" value={form.notes} onChange={change('notes')} placeholder="Record your consultation notes"/></label></div><div className="doctor-vital-inputs"><span className="doctor-eyebrow">MEASUREMENTS (OPTIONAL · ENTER ONLY MEASURED VALUES)</span><div>{[['systolic','BP systolic'],['diastolic','BP diastolic'],['heartRate','Heart rate'],['temperatureC','Temperature °C'],['oxygenSaturation','SpO₂ %']].map(([key,label]) => <label key={key}>{label}<input type="number" step="any" value={form[key]} onChange={change(key)}/></label>)}</div></div><div className="doctor-form-actions"><Link className="doctor-button outline" to="/doctor/appointments">Cancel</Link><button className="doctor-button outline" type="button" disabled={saving} onClick={(event) => submit(event, 'draft')}>{saving ? 'Saving…' : 'Save draft'}</button><button className="doctor-button primary" disabled={saving}>{saving ? 'Saving…' : 'Finalize consultation'} <Check size={15}/></button></div></form></>;
}

function DoctorMedicalRecords({ message, setError }) {
  const [search, setSearch] = useState('');
  const [recordType, setRecordType] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const path = `/doctor/medical-records?limit=100&search=${encodeURIComponent(search)}&type=${recordType}${from ? `&from=${encodeURIComponent(new Date(`${from}T00:00:00`).toISOString())}` : ''}${to ? `&to=${encodeURIComponent(new Date(`${to}T23:59:59`).toISOString())}` : ''}`;
  const { data, loading, error, reload } = useResource(path, [path]);
  const [patients, setPatients] = useState([]);
  const [newRecord, setNewRecord] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ patientId: '', title: '', recordType: 'clinical note', content: '' });
  useEffect(() => { requestApi('/doctor/patients?limit=100').then((result) => setPatients(result.items || [])).catch((loadError) => setError(loadError.message)); }, [setError]);
  async function submit(event) {
    event.preventDefault(); setSaving(true);
    try { await requestApi(editing ? `/doctor/medical-records/${editing}` : '/doctor/medical-records', { method: editing ? 'PATCH' : 'POST', body: form }); message({}, editing ? 'Medical record updated; the prior version was retained.' : 'Medical record saved.'); setForm({ patientId: '', title: '', recordType: 'clinical note', content: '' }); setEditing(null); setNewRecord(false); await reload(); }
    catch (saveError) { setError(saveError.message); }
    finally { setSaving(false); }
  }
  function editRecord(record) {
    setEditing(record._id);
    setForm({ patientId: record.patientId, title: record.title, recordType: record.recordType, content: record.content });
    setNewRecord(true);
  }
  return <><PageHeading title="Medical records" subtitle="Search and maintain records for patients assigned to your care." action={<button className="doctor-button primary" onClick={() => { setEditing(null); setForm({ patientId: '', title: '', recordType: 'clinical note', content: '' }); setNewRecord((value) => !value); }}><Plus size={15}/> Add record</button>}/>{newRecord && <form className="doctor-panel doctor-form doctor-record-form" onSubmit={submit}><div className="doctor-form-grid"><label>Patient<select required disabled={Boolean(editing)} value={form.patientId} onChange={(event) => setForm({ ...form, patientId: event.target.value })}><option value="">Choose assigned patient</option>{patients.map((patient) => <option key={patient._id} value={patient._id}>{patient.name} · {patient.patientIdentifier}</option>)}</select></label><label>Record type<select value={form.recordType} onChange={(event) => setForm({ ...form, recordType: event.target.value })}><option>clinical note</option><option>consultation</option><option>lab report</option><option>imaging</option><option>other</option></select></label><label>Title<input required maxLength="160" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })}/></label><label className="doctor-field-wide">Record content<textarea required maxLength="10000" rows="4" value={form.content} onChange={(event) => setForm({ ...form, content: event.target.value })}/></label></div><div className="doctor-form-actions"><button className="doctor-button outline" type="button" onClick={() => { setNewRecord(false); setEditing(null); }}>Cancel</button><button className="doctor-button primary" disabled={saving}>{saving ? 'Saving…' : editing ? 'Save record changes' : 'Save record'}</button></div></form>}<div className="doctor-toolbar"><label className="doctor-search"><Search size={16}/><input placeholder="Search record ID, title, or patient ID" value={search} onChange={(event) => setSearch(event.target.value)}/></label><select value={recordType} onChange={(event) => setRecordType(event.target.value)}><option value="all">All record types</option><option value="consultation">Consultation</option><option value="clinical note">Clinical note</option><option value="lab report">Lab report</option><option value="imaging">Imaging</option><option value="other">Other</option></select><label>From<input type="date" value={from} onChange={(event) => setFrom(event.target.value)}/></label><label>To<input type="date" value={to} onChange={(event) => setTo(event.target.value)}/></label></div>{loading ? <LoadingState/> : error ? <ErrorState message={error} retry={() => reload()}/> : data?.items?.length ? <div className="doctor-panel doctor-table-wrap"><div className="doctor-table-scroll"><table className="doctor-table"><thead><tr><th>RECORD</th><th>PATIENT</th><th>TYPE</th><th>DATE</th><th>AUTHOR</th><th>ACTION</th></tr></thead><tbody>{data.items.map((item) => <tr key={item._id}><td><strong>{item.title}</strong><small>{item.recordId}</small></td><td>{item.patient?.name || 'Patient'}</td><td><Badge value={item.recordType}/></td><td>{displayDate(item.createdAt)}</td><td>{item.authorName || 'You'}</td><td><button className="doctor-row-button" onClick={() => editRecord(item)}>Open / edit</button></td></tr>)}</tbody></table></div></div> : <EmptyState title="No medical records found" message="Records you save for authorized patients will appear here."/>}</>;
}

function DoctorFollowUps({ message, setError }) {
  const [status, setStatus] = useState('upcoming');
  const { data, loading, error, reload } = useResource(`/doctor/follow-ups?status=${status}`, [status]);
  async function complete(item) {
    try { await requestApi(`/doctor/follow-ups/${item.consultationId}`, { method: 'PATCH', body: { status: 'completed' } }); message({}, 'Follow-up marked complete.'); await reload(); }
    catch (updateError) { setError(updateError.message); }
  }
  return <><PageHeading title="Follow-ups" subtitle="In-app reminders from consultation recommendations; no email or SMS messages are sent."/><div className="doctor-toolbar"><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="upcoming">Upcoming</option><option value="today">Due today</option><option value="overdue">Overdue</option><option value="completed">Completed</option><option value="all">All open</option></select></div>{loading ? <LoadingState/> : error ? <ErrorState message={error} retry={() => reload()}/> : data?.items?.length ? <div className="doctor-panel doctor-table-wrap"><div className="doctor-table-scroll"><table className="doctor-table"><thead><tr><th>DUE</th><th>PATIENT</th><th>RECOMMENDATION</th><th>RELATED VISIT</th><th>STATUS</th><th></th></tr></thead><tbody>{data.items.map((item) => <tr key={item.id}><td>{displayDate(item.dueAt, false)}</td><td><Link to={`/doctor/patients/${item.patientId}`}>{item.patientName}</Link></td><td>{item.recommendation}</td><td>{item.appointmentId || 'Consultation'}</td><td><Badge value={item.status}/></td><td>{item.status !== 'completed' && <button className="doctor-row-button" onClick={() => complete(item)}>Mark complete</button>}</td></tr>)}</tbody></table></div></div> : <EmptyState title="No follow-ups in this view" message="Follow-up recommendations entered in finalized consultations appear here."/>}</>;
}

function DoctorAvailability({ message, setError }) {
  const { data, loading, error, reload } = useResource('/doctor/availability');
  const [days, setDays] = useState(blankAvailability);
  const [timeZone, setTimeZone] = useState('UTC');
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [savedDraft, setSavedDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [availabilityDate, setAvailabilityDate] = useState(() => localDateKey(new Date()));
  const [slotResult, setSlotResult] = useState(null);
  const [slotLoading, setSlotLoading] = useState(false);
  const [slotError, setSlotError] = useState('');
  useEffect(() => {
    if (!data) return;
    setTimeZone(data.timeZone || 'UTC');
    const saved = new Map((data.availability || []).map((entry) => [entry.day, entry]));
    const nextDays = weekdays.map((day) => saved.has(day)
      ? { breakStart: '', breakEnd: '', ...saved.get(day) }
      : { day, enabled: false, start: '', end: '', breakStart: '', breakEnd: '' });
    const nextDraft = {
      days: nextDays,
      timeZone: data.timeZone || 'UTC',
      durationMinutes: data.durationMinutes || 30,
    };
    setDays(nextDays);
    setDurationMinutes(nextDraft.durationMinutes);
    setSavedDraft(nextDraft);
    setAvailabilityDate(dateKeyInTimeZone(new Date(), nextDraft.timeZone));
  }, [data]);
  const currentDraft = { days, timeZone, durationMinutes };
  const hasUnsavedChanges = Boolean(savedDraft) && JSON.stringify(currentDraft) !== JSON.stringify(savedDraft);
  const slotsPath = `/doctor/availability/slots?date=${encodeURIComponent(availabilityDate)}`;
  const loadSlots = useCallback(async (signal) => {
    if (!data?.configured || !availabilityDate) {
      setSlotResult(null);
      setSlotError('');
      setSlotLoading(false);
      return;
    }
    setSlotLoading(true);
    setSlotError('');
    try {
      setSlotResult(await requestApi(slotsPath, { signal }));
    } catch (loadError) {
      if (loadError.name !== 'AbortError') setSlotError(loadError.message);
    } finally {
      if (!signal?.aborted) setSlotLoading(false);
    }
  }, [availabilityDate, data?.configured, slotsPath]);
  useEffect(() => {
    const controller = new AbortController();
    loadSlots(controller.signal);
    return () => controller.abort();
  }, [loadSlots]);
  function update(day, changes) { setDays((previous) => previous.map((entry) => entry.day === day ? { ...entry, ...changes } : entry)); }
  function discardChanges() {
    if (!hasUnsavedChanges || !window.confirm('Discard your unsaved availability changes?')) return;
    setDays(savedDraft.days.map((entry) => ({ ...entry })));
    setTimeZone(savedDraft.timeZone);
    setDurationMinutes(savedDraft.durationMinutes);
    setError('');
  }
  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await requestApi('/doctor/availability', { method: 'PATCH', body: { availability: days, timeZone, durationMinutes } });
      message({}, 'Weekly availability saved. Existing appointments were not changed.');
      await reload();
    }
    catch (saveError) { setError(saveError.message); }
    finally { setSaving(false); }
  }
  if (loading) return <LoadingState/>;
  if (error) return <><PageHeading title="My availability" subtitle="Configure your weekly appointment hours."/><ErrorState message={error} retry={() => reload()}/></>;
  return <>
    <PageHeading title="My availability" subtitle={data.configured ? `Appointment times are checked in ${timeZone}.` : 'Set your weekly hours and time zone before appointments can be booked.'}/>
    {!data.configured && <div className="doctor-message"><Clock3 size={15}/>No schedule is saved yet. New appointments cannot be booked until you save your working hours.</div>}
    <form className="doctor-panel doctor-availability" onSubmit={save}>
      <div className="doctor-availability-heading">
        <div><span className="doctor-eyebrow">WEEKLY HOURS</span><h2>Working days and breaks</h2>{data.updatedAt && <small className="doctor-availability-updated">Saved {displayDate(data.updatedAt)}</small>}</div>
        <span>Schedule changes never cancel appointments. Changes that conflict with booked visits are rejected.</span>
      </div>
      <div className="doctor-availability-settings">
        <label className="doctor-time-zone">Time zone (IANA)
          <input required maxLength="80" value={timeZone} onChange={(event) => setTimeZone(event.target.value)} placeholder="e.g. Asia/Kolkata"/>
        </label>
        <label>Appointment duration
          <select required value={durationMinutes} onChange={(event) => setDurationMinutes(Number(event.target.value))}>
            {[15, 30, 45, 60, 75, 90, 105, 120].map((minutes) => <option key={minutes} value={minutes}>{minutes} minutes</option>)}
          </select>
        </label>
      </div>
      {days.map((entry) => <div className={`doctor-day-row ${entry.enabled ? '' : 'disabled'}`} key={entry.day}>
        <label className="doctor-day-toggle"><input type="checkbox" checked={entry.enabled} onChange={(event) => update(entry.day, { enabled: event.target.checked })}/><strong>{weekdayNames[entry.day]}</strong><span>{entry.enabled ? 'Working' : 'Unavailable'}</span></label>
        <label>Start<input type="time" required={entry.enabled} disabled={!entry.enabled} value={entry.start || ''} onChange={(event) => update(entry.day, { start: event.target.value })}/></label>
        <label>End<input type="time" required={entry.enabled} disabled={!entry.enabled} value={entry.end || ''} onChange={(event) => update(entry.day, { end: event.target.value })}/></label>
        <label>Break starts<input type="time" disabled={!entry.enabled} value={entry.breakStart || ''} onChange={(event) => update(entry.day, { breakStart: event.target.value })}/></label>
        <label>Break ends<input type="time" disabled={!entry.enabled} value={entry.breakEnd || ''} onChange={(event) => update(entry.day, { breakEnd: event.target.value })}/></label>
      </div>)}
      <div className="doctor-form-actions">
        {hasUnsavedChanges && <button className="doctor-button outline" type="button" disabled={saving} onClick={discardChanges}>Discard unsaved changes</button>}
        <button className="doctor-button primary" disabled={saving || !hasUnsavedChanges}>{saving ? 'Saving…' : 'Save availability'} <Check size={15}/></button>
      </div>
    </form>
    <section className="doctor-panel doctor-availability-results">
      <div className="doctor-panel-heading"><div><span className="doctor-eyebrow">SCHEDULED VISITS</span><h2>Upcoming appointments</h2></div><button className="doctor-calendar-icon-button" type="button" onClick={() => reload()} aria-label="Refresh upcoming appointments"><RefreshCw size={14}/></button></div>
      {data.upcomingAppointments?.length
        ? <div className="doctor-availability-appointments">{data.upcomingAppointments.map((appointment) => {
          const date = localDateKey(appointment.scheduledAt);
          return <article key={appointment.id}>
            <div><strong>{appointment.patient?.name || 'Patient name unavailable'}</strong><small>{appointment.appointmentId} · {appointment.reason || 'Reason not recorded'}</small></div>
            <span>{displayDateInTimeZone(appointment.scheduledAt, timeZone)} · {appointment.durationMinutes} min</span>
            <Badge value={appointment.status}/>
            <Link className="doctor-text-link" to={`/doctor/appointments?appointment=${encodeURIComponent(appointment.id)}&date=${encodeURIComponent(date)}`}>Inspect appointment</Link>
          </article>;
        })}</div> : <p className="doctor-muted">No upcoming scheduled appointments were found.</p>}
    </section>
    <section className="doctor-panel doctor-availability-results">
      <div className="doctor-panel-heading"><div><span className="doctor-eyebrow">OPEN APPOINTMENT TIMES</span><h2>Available slots</h2></div></div>
      <label className="doctor-slot-date">Date in {timeZone}<input type="date" required value={availabilityDate} onChange={(event) => setAvailabilityDate(event.target.value)}/></label>
      {!data.configured ? <p className="doctor-muted">Save a schedule to calculate appointment slots.</p>
        : !availabilityDate ? <p className="doctor-muted">Choose a date to calculate available appointment slots.</p>
        : slotLoading ? <LoadingState label="Calculating available slots…"/>
          : slotError ? <ErrorState message={slotError} retry={() => loadSlots()}/>
            : slotResult?.slots?.length ? <div className="doctor-availability-slots">{slotResult.slots.map((slot) => <span key={slot.startAt}>{slot.time}</span>)}</div>
              : <p className="doctor-muted">No available appointment slots were found for this date.</p>}
    </section>
  </>;
}

function DoctorProfile({ message, setError }) {
  const { data, loading, error, reload } = useResource('/doctor/profile');
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (data?.profile) setForm(data.profile); }, [data]);
  function change(key) { return (event) => setForm((previous) => ({ ...previous, [key]: event.target.value })); }
  async function save(event) {
    event.preventDefault(); setSaving(true);
    try { await requestApi('/doctor/profile', { method: 'PATCH', body: form }); message({}, 'Professional profile updated.'); await reload(); }
    catch (saveError) { setError(saveError.message); }
    finally { setSaving(false); }
  }
  if (loading) return <LoadingState/>;
  if (error) return <><PageHeading title="My profile" subtitle="Manage permitted professional details."/><ErrorState message={error} retry={() => reload()}/></>;
  if (!form) return null;
  return <><PageHeading title="My profile" subtitle="Update your professional contact and profile details. Role and account permissions cannot be changed here."/><form className="doctor-panel doctor-form doctor-profile-form" onSubmit={save}><div className="doctor-form-grid"><label>Full name<input required minLength="2" maxLength="100" value={form.name} onChange={change('name')}/></label><label>Email<input type="email" required maxLength="254" value={form.email} onChange={change('email')}/></label><label>Phone<input maxLength="40" value={form.phone} onChange={change('phone')}/></label><label>Specialization<input required maxLength="100" value={form.specialization} onChange={change('specialization')}/></label><label>Department<input required maxLength="100" value={form.department} onChange={change('department')}/></label><label>Qualifications<input maxLength="1000" value={form.qualifications} onChange={change('qualifications')}/></label></div><p className="doctor-muted">Your account role, user ID, and administrative permissions are read-only.</p><div className="doctor-form-actions"><button className="doctor-button primary" disabled={saving}>{saving ? 'Saving…' : 'Save profile'} <Check size={15}/></button></div></form></>;
}
