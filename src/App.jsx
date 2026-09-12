import { Link, Navigate, Outlet, Route, Routes, useNavigate } from 'react-router-dom';
import { useAuth } from './lib/auth.jsx';
import Landing from './pages/Landing.jsx';
import Signup from './pages/Signup.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import CreatorPage from './pages/CreatorPage.jsx';
import MockCheckout from './pages/MockCheckout.jsx';
import NotFound from './pages/NotFound.jsx';

function Header() {
  const { creator, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-4">
      <Link to="/" className="text-lg font-extrabold tracking-tight">
        🥣 BuyMePap
      </Link>
      <nav className="flex items-center gap-2">
        {creator ? (
          <>
            <Link to="/dashboard" className="btn btn-ghost">
              Dashboard
            </Link>
            <Link to={`/${creator.username}`} className="btn btn-ghost">
              My page
            </Link>
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
            <Link to="/signup" className="btn btn-primary">
              Create your page
            </Link>
          </>
        )}
      </nav>
    </header>
  );
}

function Layout() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-16">
        <Outlet />
      </main>
      <footer className="border-t border-ink/10 py-6 text-center text-sm text-ink-soft">
        BuyMePap — Buy Me a Coffee, built for Nigeria and Africa. Payments by Paystack.
      </footer>
    </div>
  );
}

export default function App() {
  const { creator, loading } = useAuth();
  if (loading) return null;

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Landing />} />
        <Route path="signup" element={<Signup />} />
        <Route path="login" element={<Login />} />
        <Route path="dashboard" element={creator ? <Dashboard /> : <Navigate to="/login" replace />} />
        <Route path="mock-checkout" element={<MockCheckout />} />
        <Route path=":username" element={<CreatorPage />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
