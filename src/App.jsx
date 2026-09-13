import { Link, NavLink, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './lib/auth.jsx';
import { PageSkeleton } from './components/Loading.jsx';
import Landing from './pages/Landing.jsx';
import Claim from './pages/Claim.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import CreatorPage from './pages/CreatorPage.jsx';
import MockCheckout from './pages/MockCheckout.jsx';
import NotFound from './pages/NotFound.jsx';

const navClass = ({ isActive }) =>
  `btn btn-ghost ${isActive ? 'border-ink/30 bg-ink/[0.07]' : ''}`;

function Header() {
  const { creator, loading, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <header className="site-header">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-2">
        <Link
          to="/"
          aria-label="BuyMePap home"
          className="flex shrink-0 items-center gap-2.5 rounded-xl text-lg font-extrabold tracking-tight"
        >
          <span aria-hidden="true" className="grid h-9 w-9 place-items-center rounded-xl bg-pap/25 text-lg ring-1 ring-pap/40">
            🥣
          </span>
          <span className="hidden sm:inline">BuyMePap</span>
        </Link>

        <nav aria-label="Main" className="flex min-w-0 items-center gap-2">
          {loading ? (
            <>
              <span className="skeleton h-9 w-24 rounded-full" />
              <span className="skeleton h-9 w-28 rounded-full" />
            </>
          ) : creator ? (
            <>
              <NavLink to="/dashboard" className={navClass}>
                Dashboard
              </NavLink>
              <NavLink
                to={`/${creator.username}`}
                className={navClass}
                aria-label="My public page"
                title="My public page"
              >
                <span className="hidden sm:inline">My page</span>
                <span aria-hidden="true" className="text-base leading-none sm:hidden">
                  {creator.avatarEmoji}
                </span>
              </NavLink>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  logout();
                  navigate('/');
                }}
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <Link to="/login" className="btn btn-ghost">
                Sign in
              </Link>
              <Link to="/start" className="btn btn-primary">
                Get your link
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}

function Layout() {
  const { loading } = useAuth();
  const location = useLocation();

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main key={location.pathname} className="mx-auto w-full max-w-5xl flex-1 px-4 pb-16">
        {loading ? <PageSkeleton /> : <Outlet />}
      </main>
      <footer className="border-t border-ink/[0.07] py-7 text-center text-sm text-ink-soft">
        <p>BuyMePap — Get your link. Get paid.</p>
        <p className="mt-1 text-xs">Payments by Flutterwave · Tips land in naira, in your bank.</p>
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Landing />} />
        <Route path="start" element={<Claim />} />
        <Route path="login" element={<Login />} />
        <Route path="dashboard" element={<DashboardGuard />} />
        <Route path="mock-checkout" element={<MockCheckout />} />
        <Route path=":username" element={<CreatorPage />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

function DashboardGuard() {
  const { creator, loading } = useAuth();
  if (loading) return <PageSkeleton />;
  return creator ? <Dashboard /> : <Navigate to="/login" replace />;
}
