import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="py-20 text-center">
      <p className="text-5xl">🥣</p>
      <h1 className="mt-4 text-xl font-bold">This page got cold.</h1>
      <p className="mt-2 text-sm text-ink-soft">The page you're looking for doesn't exist.</p>
      <Link to="/" className="btn btn-primary mt-6">
        Back home
      </Link>
    </div>
  );
}
