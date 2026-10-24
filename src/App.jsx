import { useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, CalendarDays, Eye, EyeOff, FileHeart, HeartPulse, Menu, ShieldCheck, Stethoscope, X } from 'lucide-react';
import { registerPatient } from './api.js';
import { AuthProvider, useAuth } from './auth/AuthContext.jsx';
import { PatientDashboard } from './PatientDashboard.jsx';
import AdminPortal from './AdminPortal.jsx';
import DoctorPortal from './DoctorPortal.jsx';

const roleDestinations = {
  patient: '/patient/dashboard',
  doctor: '/doctor/dashboard',
  admin: '/admin/dashboard',
};

function Brand({ light = false }) {
  return <Link className={`public-brand ${light ? 'light' : ''}`} to="/" aria-label="MediCare home">
    <span className="public-brand-mark"><HeartPulse size={21}/></span>
    <span>medicare<span className="brand-period">.</span></span>
  </Link>;
}

function SiteHeader() {
  const [menuOpen, setMenuOpen] = useState(false);
  return <header className="site-header">
    <Brand/>
    <button className="site-menu-toggle" onClick={() => setMenuOpen(!menuOpen)} aria-label={menuOpen ? 'Close menu' : 'Open menu'}>{menuOpen ? <X/> : <Menu/>}</button>
    <nav className={`site-nav ${menuOpen ? 'open' : ''}`} aria-label="Main navigation">
      <a href="/#home" onClick={() => setMenuOpen(false)}>Home</a>
      <a href="/#services" onClick={() => setMenuOpen(false)}>About &amp; Services</a>
      <Link to="/login" onClick={() => setMenuOpen(false)}>Login</Link>
      <Link className="site-nav-signup" to="/signup" onClick={() => setMenuOpen(false)}>Patient Sign Up <ArrowRight size={15}/></Link>
    </nav>
  </header>;
}

function HomePage() {
  const { user, status } = useAuth();
  return <div className="public-page">
    <SiteHeader/>
    <main>
      <section className="home-hero" id="home">
        <div className="home-hero-copy">
          <div className="public-eyebrow"><span/> CARE, CONNECTED AROUND YOU</div>
          <h1>A healthier life,<br/><em>one thoughtful step</em><br/>at a time.</h1>
          <p>MediCare brings your appointments, health records, and care team together in one calm, secure space.</p>
          <div className="home-hero-actions">
            <Link className="public-button primary" to="/signup">Create your patient account <ArrowRight size={16}/></Link>
            <Link className="public-button text" to="/login">I already have an account</Link>
          </div>
          {status === 'authenticated' && user && <div className="home-signed-in"><ShieldCheck size={16}/> Welcome back, {user.name}. <Link to={roleDestinations[user.role] || '/'}>Open your dashboard <ArrowRight size={14}/></Link></div>}
          <div className="home-trust"><ShieldCheck size={15}/> Your account is private and protected</div>
        </div>
        <div className="home-hero-art" aria-label="Illustration of a person receiving care" role="img">
          <div className="hero-sun"/>
          <div className="hero-plant plant-left"><i/><i/><i/><b/></div>
          <div className="hero-person"><div className="person-hair"/><div className="person-face"/><div className="person-body"/><div className="person-arm"/></div>
          <div className="hero-window"><span/><span/><span/><span/></div>
          <div className="hero-note"><span className="hero-note-icon"><CalendarDays size={17}/></span><span><strong>Your care, in rhythm</strong><small>Appointments made simpler</small></span></div>
          <div className="hero-plant plant-right"><i/><i/><i/><b/></div>
          <span className="hero-art-label">A little more cared for.</span>
        </div>
      </section>
      <section className="public-values" aria-label="MediCare benefits">
        <div><strong>One calm space</strong><span>Your health, organized around you.</span></div>
        <div><strong>Care that connects</strong><span>Feel closer to your care team.</span></div>
        <div><strong>Made for everyday</strong><span>Simple tools for life’s health moments.</span></div>
      </section>
      <section className="services-section" id="services">
        <div className="services-heading"><div className="public-eyebrow"><span/> YOUR WELLBEING, IN VIEW</div><h2>Care feels better<br/>when it comes together.</h2><p>Small, thoughtful tools help you stay connected to the care that matters.</p></div>
        <div className="service-list">
          <article className="service-item"><span className="service-icon sage"><CalendarDays size={21}/></span><div><h3>Appointments, made simple</h3><p>Request a visit, review upcoming appointments, and keep your care plans close at hand.</p></div><ArrowRight size={17}/></article>
          <article className="service-item"><span className="service-icon clay"><FileHeart size={21}/></span><div><h3>Your health story, together</h3><p>Keep consultations, reports, and care notes organized in one personal portal.</p></div><ArrowRight size={17}/></article>
          <article className="service-item"><span className="service-icon mist"><Stethoscope size={21}/></span><div><h3>Closer to your care team</h3><p>Find the right specialist and make it easier to stay in touch with your providers.</p></div><ArrowRight size={17}/></article>
        </div>
      </section>
      <section className="home-cta"><span className="cta-flower">✳</span><div><div className="public-eyebrow"><span/> START WITH A LITTLE CARE</div><h2>Your health deserves<br/>a space of its own.</h2></div><Link className="public-button primary" to="/signup">Sign up as a patient <ArrowRight size={16}/></Link></section>
    </main>
    <footer className="site-footer"><Brand light/><span>Care, connected around you.</span><nav aria-label="Footer"><a href="/#services">About &amp; Services</a><Link to="/login">Login</Link><Link to="/signup">Patient Sign Up</Link></nav><small>© 2026 MediCare. For your wellbeing.</small></footer>
  </div>;
}

function AuthFrame({ title, subtitle, children, alternate }) {
  return <main className="auth-page">
    <header className="auth-header"><Brand/><Link className="auth-home-link" to="/">Back to home</Link></header>
    <section className="auth-card">
      <div className="auth-card-heading"><div className="auth-symbol"><HeartPulse size={21}/></div><div className="public-eyebrow"><span/> YOUR PRIVATE HEALTH SPACE</div><h1>{title}</h1><p>{subtitle}</p></div>
      {children}
      <div className="auth-alternate">{alternate}</div>
      <div className="auth-privacy"><ShieldCheck size={15}/> Your information is protected and only used to support your care.</div>
    </section>
    <footer className="auth-footer">© 2026 MediCare <span>·</span> Care, connected around you.</footer>
  </main>;
}

function SignupPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '', confirmPassword: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const update = (field) => (event) => setForm((previous) => ({ ...previous, [field]: event.target.value }));
  async function submit(event) {
    event.preventDefault();
    setError('');
    if (form.name.trim().length < 2) return setError('Enter your full name.');
    if (form.password.length < 10) return setError('Use at least 10 characters for your password.');
    if (form.password !== form.confirmPassword) return setError('Your passwords do not match.');

    setLoading(true);
    try {
      await registerPatient({ name: form.name.trim(), email: form.email.trim(), password: form.password });
      navigate('/login', { state: { message: 'Your patient account is ready. Please log in.' } });
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  return <AuthFrame title="A little care starts here." subtitle="Create your private patient account to keep your care close." alternate={<>Already have an account? <Link to="/login">Log in</Link></>}>
    <form className="auth-form" onSubmit={submit}>
      <label>Full name<input autoComplete="name" required minLength="2" maxLength="100" value={form.name} onChange={update('name')} placeholder="Your name"/></label>
      <label>Email address<input type="email" autoComplete="email" required maxLength="254" value={form.email} onChange={update('email')} placeholder="you@example.com"/></label>
      <label>Password<input type={showPassword ? 'text' : 'password'} autoComplete="new-password" required minLength="10" maxLength="128" value={form.password} onChange={update('password')} placeholder="At least 10 characters"/></label>
      <label>Confirm password<input type={showPassword ? 'text' : 'password'} autoComplete="new-password" required minLength="10" maxLength="128" value={form.confirmPassword} onChange={update('confirmPassword')} placeholder="Enter your password again"/></label>
      <label className="auth-show-password"><input type="checkbox" checked={showPassword} onChange={(event) => setShowPassword(event.target.checked)}/> Show passwords</label>
      {error && <p className="auth-error" role="alert">{error}</p>}
      <button className="public-button primary auth-submit" type="submit" disabled={loading}>{loading ? 'Creating your account…' : 'Create patient account'} <ArrowRight size={16}/></button>
    </form>
  </AuthFrame>;
}

function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { login: loginUser, authError } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const registrationMessage = location.state?.message;

  async function submit(event) {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      const user = await loginUser(email.trim(), password);
      const destination = roleDestinations[user.role];
      const requestedPath = location.state?.from;
      const safeRequestedPath = typeof requestedPath === 'string'
        && (requestedPath === destination || (user.role === 'doctor' && requestedPath.startsWith('/doctor/')))
        && requestedPath.startsWith('/')
        ? requestedPath
        : destination;
      navigate(safeRequestedPath || '/', { replace: true });
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  return <AuthFrame title="Welcome back." subtitle="Log in to return to your personal care space." alternate={<>New to MediCare? <Link to="/signup">Create a patient account</Link></>}>
    {registrationMessage && <p className="auth-success" role="status">{registrationMessage}</p>}
    {authError && <p className="auth-error" role="status">{authError}</p>}
    <form className="auth-form" onSubmit={submit}>
      <label>Email address<input type="email" autoComplete="username" required maxLength="254" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com"/></label>
      <label>Password<span className="password-input"><input type={showPassword ? 'text' : 'password'} autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password"/><button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={17}/> : <Eye size={17}/>}</button></span></label>
      {error && <p className="auth-error" role="alert">{error}</p>}
      <button className="public-button primary auth-submit" type="submit" disabled={loading}>{loading ? 'Logging in…' : 'Log in securely'} <ArrowRight size={16}/></button>
    </form>
  </AuthFrame>;
}

function RequireRole({ role }) {
  const { user, status } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <div className="route-loading" role="status">Restoring your secure session…</div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }}/>;
  if (user.role !== role) return <Navigate to={roleDestinations[user.role] || '/'} replace/>;

  return <RoleDashboard user={user}/>;
}

function RoleDashboard({ user }) {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState('');

  async function signOut() {
    setError('');
    try {
      await logout();
      navigate('/', { replace: true });
    } catch (logoutError) {
      setError(logoutError.message);
    }
  }

  if (user.role === 'patient') return <PatientDashboard user={user} onLogout={signOut}/>;
  if (user.role === 'doctor') return <DoctorPortal user={user} onLogout={signOut}/>;
  if (user.role === 'admin') return <AdminPortal user={user} onLogout={signOut}/>;

  const isDoctor = user.role === 'doctor';
  return <main className="role-dashboard">
    <header className="role-header"><Brand/><button className="role-signout" onClick={signOut}>Sign out <ArrowRight size={15}/></button></header>
    <section className="role-welcome"><div className="public-eyebrow"><span/> {isDoctor ? 'DOCTOR PORTAL' : 'ADMINISTRATION'}</div><h1>{isDoctor ? `Welcome, ${user.name}.` : `Welcome, ${user.name}.`}</h1><p>{isDoctor ? 'Your clinical workspace is ready.' : 'Your MediCare management workspace is ready.'}</p>{error && <p className="auth-error" role="alert">{error}</p>}</section>
    <section className="role-feature-grid">
      <article><span className="service-icon sage">{isDoctor ? <CalendarDays size={21}/> : <ShieldCheck size={21}/>}</span><h2>{isDoctor ? 'Care schedule' : 'Secure administration'}</h2><p>{isDoctor ? 'Your authorized patient appointments and clinical work will be organized here.' : 'Manage MediCare operations and authorized account workflows from your administrative portal.'}</p></article>
      <article><span className="service-icon clay">{isDoctor ? <FileHeart size={21}/> : <Stethoscope size={21}/>}</span><h2>{isDoctor ? 'Patient records' : 'Care team'}</h2><p>{isDoctor ? 'Patient records must be accessed only when you are authorized to provide care.' : 'Doctor and patient management tools can be connected to secure backend APIs.'}</p></article>
    </section>
    <p className="role-disclaimer"><ShieldCheck size={15}/> Your role and permissions are verified by the MediCare server.</p>
  </main>;
}

function NotFoundPage() {
  return <main className="not-found"><Brand/><span className="public-eyebrow"><span/> PAGE NOT FOUND</span><h1>This page took a wrong turn.</h1><p>The page may have moved, or the address may be incorrect.</p><Link className="public-button primary" to="/">Return to MediCare home <ArrowRight size={16}/></Link></main>;
}

function AppRoutes() {
  const { user, status } = useAuth();

  return <Routes>
    <Route path="/" element={<HomePage/>}/>
    <Route path="/signup" element={<SignupPage/>}/>
    <Route path="/login" element={status === 'authenticated' && user ? <Navigate to={roleDestinations[user.role] || '/'} replace/> : <LoginPage/>}/>
    <Route path="/patient/dashboard" element={<RequireRole role="patient"/>}/>
    <Route path="/doctor/*" element={<RequireRole role="doctor"/>}/>
    <Route path="/admin/dashboard" element={<RequireRole role="admin"/>}/>
    <Route path="*" element={<NotFoundPage/>}/>
  </Routes>;
}

export default function App() {
  return <AuthProvider><AppRoutes/></AuthProvider>;
}
