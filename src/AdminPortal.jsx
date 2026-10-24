import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, ArrowDownToLine, ArrowLeft, ArrowRight, CalendarDays, Check, ChevronLeft, ChevronRight, ClipboardList, FileHeart, LayoutDashboard, LogOut, Menu, Network, Plus, RefreshCw, Search, Settings, ShieldCheck, Stethoscope, UserRound, UsersRound, X } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { API_BASE_URL, requestApi } from './api.js';

const navigation = [
  { name: 'Overview', icon: LayoutDashboard },
  { name: 'Patients', icon: UsersRound },
  { name: 'Doctors', icon: Stethoscope },
  { name: 'Appointments', icon: CalendarDays },
  { name: 'Departments', icon: ClipboardList },
  { name: 'Relationships', icon: Network },
  { name: 'Reports', icon: Activity },
  { name: 'Settings & audit', icon: Settings },
];
const pathByPage = {
  Overview: '/dashboard',
  Patients: '/patients',
  Doctors: '/doctors',
  Appointments: '/appointments',
  Departments: '/departments',
  Relationships: '/relationships/graph',
  Reports: '/reports/appointments',
  'Settings & audit': '/settings',
};
const isoToday = () => new Date().toISOString().slice(0, 10);
const thirtyDaysAgo = () => new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);

function textValue(value, fallback = '—') {
  return value === undefined || value === null || value === '' ? fallback : String(value);
}

function displayDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? '—' : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function StatusBadge({ status }) {
  return <span className={`admin-status ${String(status || 'unknown').toLowerCase()}`}>{textValue(status, 'Unknown')}</span>;
}

function AdminModal({ title, onClose, children }) {
  return <div className="admin-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="admin-modal" role="dialog" aria-modal="true" aria-labelledby="admin-modal-title">
      <header><div><span className="admin-kicker">MEDICARE OPERATIONS</span><h2 id="admin-modal-title">{title}</h2></div><button className="admin-icon-button" onClick={onClose} aria-label="Close"><X size={18}/></button></header>
      {children}
    </section>
  </div>;
}

function AdminFormField({ label, children }) {
  return <label className="admin-form-field"><span>{label}</span>{children}</label>;
}

export default function AdminPortal({ user, onLogout }) {
  const [page, setPage] = useState('Overview');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [pageNumber, setPageNumber] = useState(1);
  const [statusFilter, setStatusFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState(thirtyDaysAgo);
  const [dateTo, setDateTo] = useState(isoToday);
  const [modal, setModal] = useState(null);
  const [saving, setSaving] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const navigate = useNavigate();

  const load = useCallback(async (signal) => {
    setLoading(true);
    setError('');
    try {
      const suffix = page === 'Overview'
        ? `?from=${encodeURIComponent(new Date(`${dateFrom}T00:00:00Z`).toISOString())}&to=${encodeURIComponent(new Date(`${dateTo}T23:59:59Z`).toISOString())}`
        : page === 'Patients' || page === 'Doctors' || page === 'Appointments' || page === 'Settings & audit'
          ? `?page=${pageNumber}&limit=20${query ? `&search=${encodeURIComponent(query)}` : ''}${page === 'Appointments' && statusFilter !== 'all' ? `&status=${statusFilter}` : ''}`
          : page === 'Relationships'
            ? `?search=${encodeURIComponent(query)}&limit=100`
            : page === 'Reports'
              ? `?from=${encodeURIComponent(new Date(`${dateFrom}T00:00:00Z`).toISOString())}&to=${encodeURIComponent(new Date(`${dateTo}T23:59:59Z`).toISOString())}`
              : '';
      const response = await requestApi(`/admin${pathByPage[page]}${suffix}`, { signal });
      setData(response);
    } catch (requestError) {
      if (requestError.name !== 'AbortError') setError(requestError.message);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [page, pageNumber, query, statusFilter, dateFrom, dateTo]);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setPageNumber(1);
      setQuery(search.trim());
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [search]);

  const selectPage = (nextPage) => {
    setPage(nextPage);
    setPageNumber(1);
    setSearch('');
    setQuery('');
    setError('');
    setNotice('');
    setMobileMenuOpen(false);
  };

  async function save(method, path, body, successMessage, closeModal = true) {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await requestApi(path, { method, body });
      if (closeModal) setModal(null);
      setNotice(successMessage);
      await load();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  async function signOut() {
    try {
      await onLogout();
      navigate('/', { replace: true });
    } catch (logoutError) {
      setError(logoutError.message);
    }
  }

  function toggleActive(person, kind) {
    const label = kind === 'patient' ? 'patient' : 'doctor';
    const active = person.isActive !== false;
    if (!window.confirm(`${active ? 'Deactivate' : 'Reactivate'} ${person.name}'s ${label} account?`)) return;
    save('PATCH', `/admin/${kind}s/${person._id}`, { isActive: !active }, `${label} account ${active ? 'deactivated' : 'reactivated'}.`, false);
  }

  function setStatus(appointment, status) {
    if (status === 'cancelled' && !window.confirm('Cancel this appointment?')) return;
    save('PATCH', `/admin/appointments/${appointment.id}/status`, { status }, 'Appointment status updated.', false);
  }

  const pageTitle = page === 'Overview' ? 'Hospital operations' : page;
  const pageSubtitle = page === 'Overview'
    ? 'A clear view of the care being coordinated today.'
    : `Manage ${page.toLowerCase()} with current data from MediCare records.`;
  const pageRows = data?.items || [];
  const statusMetrics = data?.metrics?.appointmentsByStatus || {};
  const maximumTrend = Math.max(1, ...(data?.trend || []).map((item) => item.count));

  const openPatient = (patient) => setModal({ type: 'patient-edit', record: patient });
  const openDoctor = (doctor) => setModal({ type: 'doctor-edit', record: doctor });

  return <div className="admin-app">
    <aside className={`admin-sidebar ${mobileMenuOpen ? 'open' : ''}`}>
      <Link className="admin-brand" to="/"><span className="admin-brand-mark"><FileHeart size={20}/></span><span>medicare<span>.</span><small>HOSPITAL OPERATIONS</small></span></Link>
      <div className="admin-profile"><span className="admin-avatar"><UserRound size={18}/></span><span><strong>{user.name}</strong><small>Administrator</small></span><ShieldCheck size={15}/></div>
      <nav className="admin-nav" aria-label="Administrator navigation">
        <span className="admin-nav-label">WORKSPACE</span>
        {navigation.map(({ name, icon: Icon }) => <button key={name} className={`admin-nav-item ${page === name ? 'active' : ''}`} onClick={() => selectPage(name)}><Icon size={17}/><span>{name}</span>{page === name && <i/>}</button>)}
      </nav>
      <div className="admin-sidebar-bottom"><div className="admin-sidebar-note"><ShieldCheck size={16}/><span>Administrative access is audited. Patient clinical notes are not shown here.</span></div><button className="admin-nav-item signout" onClick={signOut}><LogOut size={17}/><span>Sign out securely</span></button><small>© 2026 MediCare</small></div>
    </aside>
    {mobileMenuOpen && <button className="admin-mobile-scrim" aria-label="Close navigation" onClick={() => setMobileMenuOpen(false)}/>}
    <main className="admin-main">
      <header className="admin-topbar">
        <button className="admin-icon-button admin-menu-toggle" aria-label="Open navigation" onClick={() => setMobileMenuOpen(true)}><Menu size={19}/></button>
        <div className="admin-breadcrumb"><span>Operations</span><ChevronRight size={14}/><strong>{page}</strong></div>
        <div className="admin-top-actions"><span className="admin-secure-label"><ShieldCheck size={14}/> Secure administrator session</span><span className="admin-top-avatar">{user.name.slice(0, 1).toUpperCase()}</span></div>
      </header>
      <div className="admin-content">
        <section className="admin-page-heading">
          <div><span className="admin-kicker">MEDICARE · OPERATIONS</span><h1>{pageTitle}</h1><p>{pageSubtitle}</p></div>
          {['Patients', 'Doctors', 'Appointments'].includes(page) && <button className="admin-button primary" onClick={() => setModal({ type: `${page.toLowerCase().slice(0, -1)}-new` })}><Plus size={16}/> {page === 'Patients' ? 'Register patient' : page === 'Doctors' ? 'Add doctor' : 'Book appointment'}</button>}
        </section>

        {notice && <div className="admin-notice success"><Check size={15}/>{notice}<button onClick={() => setNotice('')} aria-label="Dismiss"><X size={14}/></button></div>}
        {error && <div className="admin-notice error"><AlertTriangle size={15}/>{error}<button onClick={() => setError('')} aria-label="Dismiss"><X size={14}/></button></div>}

        {loading ? <div className="admin-loading"><span/>Loading current operational data…</div> : error && !data ? <section className="admin-empty"><AlertTriangle size={24}/><h2>Could not load this page</h2><p>{error}</p><button className="admin-button outline" onClick={() => load()}>Try again <RefreshCw size={15}/></button></section> : <>
          {page === 'Overview' && <OverviewPage data={data} dateFrom={dateFrom} dateTo={dateTo} onDateFrom={setDateFrom} onDateTo={setDateTo} onNavigate={selectPage}/>}
          {page === 'Patients' && <PatientsPage items={pageRows} total={data?.total || 0} page={pageNumber} pages={data?.pages || 1} search={search} setSearch={setSearch} onEdit={openPatient} onToggle={toggleActive} onPage={setPageNumber} onView={(item) => setModal({ type: 'patient-view', record: item })}/>}
          {page === 'Doctors' && <DoctorsPage items={pageRows} total={data?.total || 0} page={pageNumber} pages={data?.pages || 1} search={search} setSearch={setSearch} onEdit={openDoctor} onToggle={toggleActive} onPage={setPageNumber}/>}
          {page === 'Appointments' && <AppointmentsPage items={pageRows} total={data?.total || 0} page={pageNumber} pages={data?.pages || 1} search={search} setSearch={setSearch} status={statusFilter} setStatus={setStatusFilter} onPage={setPageNumber} onStatus={setStatus} onReschedule={(record) => setModal({ type: 'appointment-edit', record })}/>}
          {page === 'Departments' && <DepartmentsPage items={data?.items || []} onNavigate={selectPage}/>}
          {page === 'Relationships' && <RelationshipsPage data={data} search={search} setSearch={setSearch} onReconcile={() => save('POST', '/admin/relationships/reconcile', {}, 'Graph reconciliation finished.', false)} saving={saving}/>}
          {page === 'Reports' && <ReportsPage data={data} from={dateFrom} to={dateTo} setFrom={setDateFrom} setTo={setDateTo}/>}
          {page === 'Settings & audit' && <SettingsPage data={data} onSave={(body) => save('PATCH', '/admin/settings', body, 'Settings saved. Refresh your session to update your header.')} onAudit={() => setModal({ type: 'audit' })} saving={saving}/>}
        </>}
        <footer className="admin-page-footer"><ShieldCheck size={14}/> Operational data from MediCare databases. No medical record contents are included in this portal.</footer>
      </div>
    </main>
    {modal && <AdminModal title={modal.type === 'patient-new' ? 'Register patient' : modal.type === 'doctor-new' ? 'Add doctor' : modal.type === 'appointment-new' ? 'Book appointment' : modal.type === 'appointment-edit' ? 'Reschedule appointment' : modal.type === 'patient-view' ? 'Patient details' : modal.type === 'audit' ? 'Recent audit activity' : modal.type === 'patient-edit' ? 'Edit patient' : modal.type === 'doctor-edit' ? 'Edit doctor' : 'Record details'} onClose={() => setModal(null)}>
      {modal.type === 'patient-new' && <PatientForm onCancel={() => setModal(null)} onSubmit={(body) => save('POST', '/admin/patients', body, 'Patient registered.')} saving={saving}/>}
      {modal.type === 'doctor-new' && <DoctorForm onCancel={() => setModal(null)} onSubmit={(body) => save('POST', '/admin/doctors', body, 'Doctor account created.')} saving={saving}/>}
      {modal.type === 'appointment-new' && <AppointmentForm onCancel={() => setModal(null)} onSubmit={(body) => save('POST', '/admin/appointments', body, 'Appointment request saved.')} saving={saving}/>}
      {modal.type === 'appointment-edit' && <AppointmentForm initial={modal.record} onCancel={() => setModal(null)} onSubmit={(body) => save('PATCH', `/admin/appointments/${modal.record.id}`, body, 'Appointment rescheduled.')} saving={saving}/>}
      {modal.type === 'patient-edit' && <PatientForm initial={modal.record} onCancel={() => setModal(null)} onSubmit={(body) => save('PATCH', `/admin/patients/${modal.record._id}`, body, 'Patient profile updated.')} saving={saving}/>}
      {modal.type === 'doctor-edit' && <DoctorForm initial={modal.record} onCancel={() => setModal(null)} onSubmit={(body) => save('PATCH', `/admin/doctors/${modal.record._id}`, body, 'Doctor profile updated.')} saving={saving}/>}
      {modal.type === 'patient-view' && <PatientDetail id={modal.record._id}/>}
      {modal.type === 'audit' && <AuditList/>}
    </AdminModal>}
  </div>;
}

function OverviewPage({ data, dateFrom, dateTo, onDateFrom, onDateTo, onNavigate }) {
  const metrics = data?.metrics || {};
  const trend = data?.trend || [];
  const schedule = data?.todaySchedule || [];
  const statusCounts = metrics.appointmentsByStatus || {};
  return <>
    <div className="admin-period"><label>From<input type="date" value={dateFrom} onChange={(event) => onDateFrom(event.target.value)}/></label><label>To<input type="date" value={dateTo} onChange={(event) => onDateTo(event.target.value)}/></label><span>Updated {displayDate(data?.generatedAt)}</span></div>
    <section className="admin-metrics">
      <article className="admin-metric featured"><span>REGISTERED PATIENTS</span><strong>{metrics.totalPatients ?? 0}</strong><small>{metrics.newPatients ?? 0} registered in this period</small></article>
      <article className="admin-metric"><span>ACTIVE DOCTORS</span><strong>{metrics.activeDoctors ?? 0}</strong><small>Available accounts</small></article>
      <article className="admin-metric"><span>TODAY'S APPOINTMENTS</span><strong>{metrics.todayAppointments ?? 0}</strong><small>{metrics.upcomingAppointments ?? 0} upcoming in total</small></article>
      <article className="admin-metric"><span>SCHEDULED</span><strong>{statusCounts.scheduled ?? 0}</strong><small>Current appointment count</small></article>
    </section>
    <section className="admin-overview-grid">
      <article className="admin-panel admin-trend-panel"><div className="admin-panel-heading"><div><span className="admin-kicker">APPOINTMENT ACTIVITY</span><h2>Visits over time</h2></div><span className="admin-panel-caption">Counts by day</span></div>
        {trend.length ? <div className="admin-bars" role="img" aria-label="Appointment counts by date">{trend.map((entry) => <div className="admin-bar-column" key={entry.date} title={`${entry.date}: ${entry.count} appointments`}><span>{entry.count}</span><i style={{ height: `${Math.max(4, (entry.count / Math.max(...trend.map((item) => item.count))) * 100)}%` }}/><small>{entry.date.slice(5)}</small></div>)}</div> : <p className="admin-inline-empty">No appointments in this date range.</p>}
        <div className="admin-status-summary"><span><i className="scheduled"/> Scheduled <strong>{statusCounts.scheduled ?? 0}</strong></span><span><i className="completed"/> Completed <strong>{statusCounts.completed ?? 0}</strong></span><span><i className="cancelled"/> Cancelled <strong>{statusCounts.cancelled ?? 0}</strong></span></div>
      </article>
      <article className="admin-panel"><div className="admin-panel-heading"><div><span className="admin-kicker">TODAY</span><h2>Care schedule</h2></div><button className="admin-text-link" onClick={() => onNavigate('Appointments')}>All appointments <ArrowRight size={14}/></button></div>
        {schedule.length ? <div className="admin-schedule">{schedule.map((item) => <div className="admin-schedule-row" key={item.appointmentId}><time>{new Date(item.scheduledAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time><div><strong>{textValue(item.patientName, 'Patient')}</strong><small>{textValue(item.doctorName, 'Doctor')} {item.specialization ? `· ${item.specialization}` : ''}</small></div><StatusBadge status={item.status}/></div>)}</div> : <p className="admin-inline-empty">No appointments scheduled for today.</p>}
      </article>
    </section>
    <section className="admin-lower-grid">
      <article className="admin-panel"><div className="admin-panel-heading"><div><span className="admin-kicker">RECENT OPERATIONS</span><h2>Audit activity</h2></div><button className="admin-text-link" onClick={() => onNavigate('Settings & audit')}>Settings &amp; audit <ArrowRight size={14}/></button></div>{data?.recentActivity?.length ? <div className="admin-activity-list">{data.recentActivity.map((item) => <div key={item._id} className="admin-activity-row"><span className="admin-activity-dot"/><div><strong>{item.action}</strong><small>{item.actorName} · {item.entity} {item.entityId}</small></div><time>{displayDate(item.createdAt)}</time></div>)}</div> : <p className="admin-inline-empty">No audit events recorded yet.</p>}</article>
      <article className={`admin-panel admin-alert-panel ${data?.alerts?.unsyncedAppointments ? 'has-alert' : ''}`}><div className="admin-panel-heading"><div><span className="admin-kicker">SYSTEM HEALTH</span><h2>Operational attention</h2></div></div>{data?.alerts?.unsyncedAppointments ? <p><AlertTriangle size={16}/>{data.alerts.unsyncedAppointments} appointment(s) need graph synchronization.</p> : <p><ShieldCheck size={16}/> No appointment graph synchronization failures reported.</p>}<button className="admin-text-link" onClick={() => onNavigate('Relationships')}>Review relationships <ArrowRight size={14}/></button></article>
    </section>
    <section className="admin-quick-actions"><span className="admin-kicker">QUICK ACTIONS</span><button onClick={() => onNavigate('Patients')}><Plus size={15}/> Register patient</button><button onClick={() => onNavigate('Doctors')}><Plus size={15}/> Add doctor</button><button onClick={() => onNavigate('Appointments')}><CalendarDays size={15}/> Book appointment</button><button onClick={() => onNavigate('Appointments')}><ArrowRight size={15}/> Today's appointments</button></section>
  </>;
}

function TableToolbar({ search, setSearch, placeholder, children }) {
  return <div className="admin-table-toolbar"><label className="admin-search"><Search size={16}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={placeholder}/></label>{children}</div>;
}

function Pagination({ page, pages, total, onPage }) {
  return <div className="admin-pagination"><span>{total} records · page {page} of {Math.max(1, pages)}</span><div><button disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page"><ChevronLeft size={16}/></button><button disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page"><ChevronRight size={16}/></button></div></div>;
}

function PatientsPage({ items, total, page, pages, search, setSearch, onEdit, onToggle, onPage, onView }) {
  return <section className="admin-panel admin-table-panel">
    <TableToolbar search={search} setSearch={setSearch} placeholder="Search name, email, or patient ID"/>
    {items.length ? <div className="admin-table-scroll"><table className="admin-table"><thead><tr><th>PATIENT</th><th>CONTACT</th><th>REGISTERED</th><th>STATUS</th><th>ACTIONS</th></tr></thead><tbody>{items.map((item) => <tr key={item._id}><td><strong>{textValue(item.name)}</strong><small className="admin-subtext">ID · {textValue(item.patientId, item.userId || item._id)}</small></td><td>{textValue(item.email)}<small className="admin-subtext">{textValue(item.phone)}</small></td><td>{displayDate(item.createdAt)}</td><td><StatusBadge status={item.isActive === false ? 'inactive' : 'active'}/></td><td><div className="admin-row-actions"><button onClick={() => onView(item)}>Details</button><button onClick={() => onEdit(item)}>Edit</button><button onClick={() => onToggle(item, 'patient')}>{item.isActive === false ? 'Activate' : 'Deactivate'}</button></div></td></tr>)}</tbody></table></div> : <EmptyTable title="No patients found" detail={search ? 'Try another search term.' : 'Patient accounts will appear here after registration.'}/>}
    <Pagination page={page} pages={pages} total={total} onPage={onPage}/>
  </section>;
}

function DoctorsPage({ items, total, page, pages, search, setSearch, onEdit, onToggle, onPage }) {
  return <section className="admin-panel admin-table-panel">
    <TableToolbar search={search} setSearch={setSearch} placeholder="Search name, email, specialty, department"/>
    {items.length ? <div className="admin-table-scroll"><table className="admin-table"><thead><tr><th>DOCTOR</th><th>SPECIALIZATION</th><th>DEPARTMENT</th><th>STATUS</th><th>ACTIONS</th></tr></thead><tbody>{items.map((item) => <tr key={item._id}><td><strong>{textValue(item.name)}</strong><small className="admin-subtext">{textValue(item.email)}</small></td><td>{textValue(item.specialization)}</td><td>{textValue(item.department)}</td><td><StatusBadge status={item.isActive === false ? 'inactive' : 'active'}/></td><td><div className="admin-row-actions"><button onClick={() => onEdit(item)}>Edit</button><button onClick={() => onToggle(item, 'doctor')}>{item.isActive === false ? 'Activate' : 'Deactivate'}</button></div></td></tr>)}</tbody></table></div> : <EmptyTable title="No doctors found" detail={search ? 'Try another search term.' : 'Add a doctor to start managing the care team.'}/>}
    <Pagination page={page} pages={pages} total={total} onPage={onPage}/>
  </section>;
}

function AppointmentsPage({ items, total, page, pages, search, setSearch, status, setStatus, onPage, onStatus, onReschedule }) {
  const filtered = useMemo(() => items.filter((item) => `${item.patientName} ${item.doctorName} ${item.appointmentId}`.toLowerCase().includes(search.toLowerCase())), [items, search]);
  return <section className="admin-panel admin-table-panel">
    <TableToolbar search={search} setSearch={setSearch} placeholder="Search patient, doctor, appointment"><select className="admin-filter" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All statuses</option><option value="scheduled">Scheduled</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select></TableToolbar>
    {filtered.length ? <div className="admin-table-scroll"><table className="admin-table"><thead><tr><th>APPOINTMENT</th><th>PATIENT</th><th>DOCTOR</th><th>WHEN</th><th>STATUS</th><th>GRAPH SYNC</th><th>ACTION</th></tr></thead><tbody>{filtered.map((item) => <tr key={item.id}><td><strong>{textValue(item.appointmentId)}</strong></td><td>{textValue(item.patientName)}</td><td>{textValue(item.doctorName)}<small className="admin-subtext">{textValue(item.specialization, '')}</small></td><td>{displayDate(item.scheduledAt)}</td><td><StatusBadge status={item.status}/></td><td><StatusBadge status={item.graphSync}/></td><td>{item.status === 'scheduled' ? <div className="admin-row-actions"><button onClick={() => onReschedule(item)}>Reschedule</button><button onClick={() => onStatus(item, 'completed')}>Complete</button><button onClick={() => onStatus(item, 'cancelled')}>Cancel</button></div> : '—'}</td></tr>)}</tbody></table></div> : <EmptyTable title="No appointments found" detail="Adjust the search or status filter, or book an appointment."/>}
    <Pagination page={page} pages={pages} total={total} onPage={onPage}/>
  </section>;
}

function EmptyTable({ title, detail }) {
  return <div className="admin-empty"><CalendarDays size={24}/><h2>{title}</h2><p>{detail}</p></div>;
}

function DepartmentsPage({ items, onNavigate }) {
  return <section className="admin-panel admin-departments"><div className="admin-panel-heading"><div><span className="admin-kicker">CARE TEAM ORGANIZATION</span><h2>Departments from doctor profiles</h2></div><button className="admin-button outline" onClick={() => onNavigate('Doctors')}>Manage doctors <ArrowRight size={15}/></button></div>{items.length ? <div className="admin-department-list">{items.map((item) => <button key={item.name} onClick={() => onNavigate('Doctors')}><span className="service-icon sage"><Stethoscope size={18}/></span><span><strong>{item.name}</strong><small>{item.activeDoctors} active doctor(s)</small></span><ArrowRight size={15}/></button>)}</div> : <EmptyTable title="No departments yet" detail="Add doctor profiles with departments to see them here."/>}</section>;
}

function RelationshipsPage({ data, search, setSearch, onReconcile, saving }) {
  const relationships = (data?.relationships || []).filter((edge) => `${edge.from} ${edge.to} ${edge.type} ${data.nodes.find((node) => node.id === edge.from)?.name || ''} ${data.nodes.find((node) => node.id === edge.to)?.name || ''}`.toLowerCase().includes(search.toLowerCase()));
  return <section className="admin-panel admin-graph-panel"><div className="admin-graph-header"><div><span className="admin-kicker">NEO4J RELATIONSHIP EXPLORER</span><h2>Patients, visits, and care teams</h2><p>Only relationships stored in Neo4j are shown; no missing edges are inferred.</p></div><button className="admin-button outline" disabled={saving} onClick={onReconcile}><RefreshCw size={15}/>{saving ? 'Reconciling…' : 'Retry synchronization'}</button></div>
    <TableToolbar search={search} setSearch={setSearch} placeholder="Search graph IDs or names"/>
    {data?.syncFailures > 0 && <div className="admin-notice error"><AlertTriangle size={15}/>{data.syncFailures} appointment(s) are not synchronized with the graph.</div>}
    {relationships.length ? <div className="admin-relationship-list">{relationships.map((edge, index) => <div key={`${edge.from}-${edge.type}-${index}`} className="admin-edge"><span className={`admin-node ${data.nodes.find((node) => node.id === edge.from)?.type || ''}`}><i/>{data.nodes.find((node) => node.id === edge.from)?.name || edge.from}</span><span className="admin-edge-label">{edge.type}<ArrowRight size={14}/></span><span className={`admin-node ${data.nodes.find((node) => node.id === edge.to)?.type || ''}`}><i/>{data.nodes.find((node) => node.id === edge.to)?.name || edge.to}</span></div>)}</div> : <EmptyTable title={search ? 'No matching relationships found' : 'No stored relationships found'} detail={data?.syncFailures ? 'Retry synchronization after checking Neo4j connectivity.' : 'Appointments synchronized with Neo4j will appear here.'}/>}
  </section>;
}

function ReportsPage({ data, from, to, setFrom, setTo }) {
  const appointments = data?.appointmentsByDate || [];
  const max = Math.max(1, ...appointments.map((item) => item.count));
  return <div className="admin-report-layout">
    <div className="admin-period"><label>From<input type="date" value={from} onChange={(event) => setFrom(event.target.value)}/></label><label>To<input type="date" value={to} onChange={(event) => setTo(event.target.value)}/></label><a className="admin-button outline" href={`${API_BASE_URL}/admin/reports/appointments.csv?from=${encodeURIComponent(new Date(`${from}T00:00:00Z`).toISOString())}&to=${encodeURIComponent(new Date(`${to}T23:59:59Z`).toISOString())}`}><ArrowDownToLine size={15}/> Export CSV</a></div>
    <section className="admin-report-summary"><div><span>APPOINTMENTS</span><strong>{Object.values(data?.appointmentsByStatus || {}).reduce((sum, count) => sum + count, 0)}</strong><small>Count in selected range</small></div><div><span>NEW PATIENTS</span><strong>{data?.newPatientRegistrations || 0}</strong><small>Registrations in selected range</small></div><div><span>CANCELLATIONS</span><strong>{data?.appointmentsByStatus?.cancelled || 0}</strong><small>Count, not cancellation rate</small></div></section>
    <section className="admin-panel admin-report-chart"><div className="admin-panel-heading"><div><span className="admin-kicker">DAILY COUNTS</span><h2>Appointment volume</h2></div></div>{appointments.length ? appointments.map((item) => <div className="admin-report-bar" key={item.date}><span>{item.date}</span><i><b style={{ width: `${Math.max(1, item.count / max * 100)}%` }}/></i><strong>{item.count}</strong></div>) : <EmptyTable title="No appointment data in this range" detail="Choose another date range to view activity."/>}</section>
    <section className="admin-panel admin-report-chart"><div className="admin-panel-heading"><div><span className="admin-kicker">WORKLOAD</span><h2>Doctor appointments</h2></div></div>{data?.doctorWorkload?.length ? <div className="admin-workload">{data.doctorWorkload.map((item) => <div key={item.doctorId}><span>{textValue(item.doctorName, item.doctorId)}</span><strong>{item.appointments} visit(s)</strong><small>{item.cancellations} cancellation(s)</small></div>)}</div> : <p className="admin-inline-empty">No doctor workload data in this period.</p>}</section>
  </div>;
}

function SettingsPage({ data, onSave, onAudit, saving }) {
  const [name, setName] = useState(data?.administrator?.name || '');
  const [email, setEmail] = useState(data?.administrator?.email || '');
  const [hospitalName, setHospitalName] = useState(data?.hospital?.name || 'MediCare');
  useEffect(() => {
    setName(data?.administrator?.name || '');
    setEmail(data?.administrator?.email || '');
    setHospitalName(data?.hospital?.name || 'MediCare');
  }, [data]);
  return <div className="admin-settings-layout"><form className="admin-panel admin-settings-form" onSubmit={(event) => { event.preventDefault(); onSave({ name, email, hospitalName }); }}><div className="admin-panel-heading"><div><span className="admin-kicker">PROFILE & ORGANIZATION</span><h2>Administrator settings</h2></div></div><AdminFormField label="Administrator name"><input required minLength="2" maxLength="100" value={name} onChange={(event) => setName(event.target.value)}/></AdminFormField><AdminFormField label="Administrator email"><input required type="email" maxLength="254" value={email} onChange={(event) => setEmail(event.target.value)}/></AdminFormField><AdminFormField label="Hospital display name"><input required minLength="2" maxLength="120" value={hospitalName} onChange={(event) => setHospitalName(event.target.value)}/></AdminFormField><p className="admin-settings-note">Role and access permissions are managed separately and cannot be changed here.</p><button className="admin-button primary" disabled={saving} type="submit">{saving ? 'Saving…' : 'Save settings'} <Check size={15}/></button></form>
    <div className="admin-settings-aside"><section className="admin-panel"><div className="admin-panel-heading"><div><span className="admin-kicker">SESSION SECURITY</span><h2>Current protection</h2></div><ShieldCheck size={19}/></div><p>Session duration <strong>{data?.session?.expiresIn || '8 hours'}</strong></p><p>HttpOnly session cookie <strong>{data?.session?.cookieHttpOnly ? 'Enabled' : 'Unavailable'}</strong></p><p>Secure cookie <strong>{data?.session?.secureCookie ? 'Enabled' : 'Development mode'}</strong></p></section><section className="admin-panel"><span className="admin-kicker">ACCOUNTABILITY</span><h2>Audit history</h2><p>Review recorded administrator activity for account and appointment changes.</p><button className="admin-button outline" onClick={onAudit}>View recent activity <ArrowRight size={15}/></button></section></div>
  </div>;
}

function PatientForm({ initial, onCancel, onSubmit, saving }) {
  const [form, setForm] = useState({ name: initial?.name || '', email: initial?.email || '', phone: initial?.phone || '', temporaryPassword: '' });
  const [formError, setFormError] = useState('');
  const change = (field) => (event) => setForm({ ...form, [field]: event.target.value });
  return <form className="admin-form" onSubmit={(event) => { event.preventDefault(); setFormError(''); if (!initial && form.temporaryPassword.length < 10) return setFormError('Temporary password must be at least 10 characters.'); const body = { name: form.name.trim(), email: form.email.trim(), phone: form.phone.trim() }; if (!initial) body.temporaryPassword = form.temporaryPassword; onSubmit(body); }}>
    <AdminFormField label="Full name"><input required minLength="2" maxLength="100" value={form.name} onChange={change('name')}/></AdminFormField><AdminFormField label="Email address"><input required type="email" maxLength="254" value={form.email} onChange={change('email')}/></AdminFormField><AdminFormField label="Phone number"><input maxLength="40" value={form.phone} onChange={change('phone')}/></AdminFormField>{!initial && <AdminFormField label="Temporary password"><input required minLength="10" type="password" autoComplete="new-password" value={form.temporaryPassword} onChange={change('temporaryPassword')}/></AdminFormField>}
    {formError && <p className="auth-error" role="alert">{formError}</p>}<FormActions onCancel={onCancel} saving={saving} label={initial ? 'Save changes' : 'Register patient'}/>
  </form>;
}

function DoctorForm({ initial, onCancel, onSubmit, saving }) {
  const [form, setForm] = useState({ name: initial?.name || '', email: initial?.email || '', phone: initial?.phone || '', specialization: initial?.specialization || '', department: initial?.department || '', temporaryPassword: '' });
  const [formError, setFormError] = useState('');
  const change = (field) => (event) => setForm({ ...form, [field]: event.target.value });
  return <form className="admin-form" onSubmit={(event) => { event.preventDefault(); setFormError(''); if (!initial && form.temporaryPassword.length < 10) return setFormError('Temporary password must be at least 10 characters.'); const body = { name: form.name.trim(), email: form.email.trim(), phone: form.phone.trim(), specialization: form.specialization.trim(), department: form.department.trim() }; if (!initial) body.temporaryPassword = form.temporaryPassword; onSubmit(body); }}>
    <AdminFormField label="Doctor name"><input required minLength="2" maxLength="100" value={form.name} onChange={change('name')}/></AdminFormField><AdminFormField label="Email address"><input required type="email" maxLength="254" value={form.email} onChange={change('email')}/></AdminFormField><AdminFormField label="Phone number"><input maxLength="40" value={form.phone} onChange={change('phone')}/></AdminFormField><AdminFormField label="Specialization"><input required maxLength="100" value={form.specialization} onChange={change('specialization')}/></AdminFormField><AdminFormField label="Department"><input required maxLength="100" value={form.department} onChange={change('department')}/></AdminFormField>{!initial && <AdminFormField label="Temporary password"><input required minLength="10" type="password" autoComplete="new-password" value={form.temporaryPassword} onChange={change('temporaryPassword')}/></AdminFormField>}
    {formError && <p className="auth-error" role="alert">{formError}</p>}<FormActions onCancel={onCancel} saving={saving} label={initial ? 'Save changes' : 'Create doctor account'}/>
  </form>;
}

function AppointmentForm({ initial, onCancel, onSubmit, saving }) {
  const [patients, setPatients] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    patientId: initial?.patientId || '',
    doctorId: initial?.doctorId || '',
    scheduledAt: initial?.scheduledAt
      ? new Date(new Date(initial.scheduledAt).getTime() - new Date(initial.scheduledAt).getTimezoneOffset() * 60000).toISOString().slice(0, 16)
      : '',
    reason: initial?.reason || '',
  });
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      requestApi('/admin/patients?limit=100', { signal: controller.signal }),
      requestApi('/admin/doctors?status=active&limit=100', { signal: controller.signal }),
    ]).then(([patientResult, doctorResult]) => {
      setPatients(patientResult.items.filter((item) => item.isActive !== false));
      setDoctors(doctorResult.items.filter((item) => item.isActive !== false));
    }).catch((loadError) => { if (loadError.name !== 'AbortError') setError(loadError.message); });
    return () => controller.abort();
  }, []);
  const change = (field) => (event) => setForm({ ...form, [field]: event.target.value });
  return <form className="admin-form" onSubmit={(event) => { event.preventDefault(); if (!patients.length || !doctors.length) return setError('An active patient and doctor are required before booking.'); const scheduledAt = new Date(form.scheduledAt); if (Number.isNaN(scheduledAt.valueOf()) || scheduledAt <= new Date()) return setError('Choose a future appointment time.'); setError(''); onSubmit({ ...form, scheduledAt: scheduledAt.toISOString() }); }}>
    <AdminFormField label="Patient"><select required value={form.patientId} onChange={change('patientId')}><option value="">Choose a patient</option>{patients.map((item) => <option key={item.userId || item._id} value={item.userId || item._id}>{item.name} · {item.email}</option>)}</select></AdminFormField><AdminFormField label="Doctor"><select required value={form.doctorId} onChange={change('doctorId')}><option value="">Choose a doctor</option>{doctors.map((item) => <option key={item.userId || item._id} value={item.userId || item._id}>{item.name} · {item.specialization || item.department}</option>)}</select></AdminFormField><AdminFormField label="Date and time"><input required type="datetime-local" value={form.scheduledAt} onChange={change('scheduledAt')}/></AdminFormField><AdminFormField label="Appointment reason"><textarea required maxLength="500" value={form.reason} onChange={change('reason')}/></AdminFormField>{error && <p className="auth-error" role="alert">{error}</p>}<FormActions onCancel={onCancel} saving={saving} label={initial ? 'Save reschedule' : 'Book appointment'}/>
  </form>;
}

function FormActions({ onCancel, saving, label }) {
  return <div className="admin-form-actions"><button type="button" className="admin-button outline" onClick={onCancel}>Cancel</button><button className="admin-button primary" disabled={saving} type="submit">{saving ? 'Saving…' : label}<Check size={15}/></button></div>;
}

function PatientDetail({ id }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    requestApi(`/admin/patients/${id}`, { signal: controller.signal }).then(setData).catch((loadError) => { if (loadError.name !== 'AbortError') setError(loadError.message); });
    return () => controller.abort();
  }, [id]);
  if (error) return <p className="auth-error" role="alert">{error}</p>;
  if (!data) return <div className="admin-loading"><span/>Loading patient details…</div>;
  return <div className="admin-detail"><div><small>Name</small><strong>{data.patient.name}</strong></div><div><small>Email</small><strong>{data.patient.email}</strong></div><div><small>Phone</small><strong>{textValue(data.patient.phone)}</strong></div><div><small>Registration date</small><strong>{displayDate(data.patient.createdAt)}</strong></div><h3>Appointment history</h3>{data.appointments.length ? data.appointments.map((item) => <div key={item.id} className="admin-detail-row"><span>{item.appointmentId}</span><span>{displayDate(item.scheduledAt)}</span><StatusBadge status={item.status}/></div>) : <p>No appointments recorded.</p>}</div>;
}

function AuditList() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    requestApi('/admin/audit-logs?limit=50', { signal: controller.signal }).then((result) => setItems(result.items)).catch((loadError) => { if (loadError.name !== 'AbortError') setError(loadError.message); });
    return () => controller.abort();
  }, []);
  if (error) return <p className="auth-error" role="alert">{error}</p>;
  if (!items) return <div className="admin-loading"><span/>Loading audit activity…</div>;
  return <div className="admin-audit-list">{items.length ? items.map((item) => <div key={item.id}><span className="admin-activity-dot"/><div><strong>{item.action}</strong><small>{item.actorName} · {item.entity} · {item.entityId}</small></div><time>{displayDate(item.createdAt)}</time></div>) : <p>No audit events recorded.</p>}</div>;
}
