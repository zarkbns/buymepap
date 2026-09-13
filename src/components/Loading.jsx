export function Skeleton({ className = '' }) {
  return <span aria-hidden="true" className={`skeleton block ${className}`} />;
}

export function PageSkeleton({ label = 'Loading page' }) {
  return (
    <div className="fade-in pt-8" aria-busy="true">
      <p className="sr-only" role="status">
        {label}
      </p>
      <Skeleton className="h-8 w-56 max-w-full" />
      <Skeleton className="mt-3 h-4 w-80 max-w-full" />
      <div className="mt-7 grid gap-6 lg:grid-cols-2">
        <div className="card space-y-3">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-2.5 w-full" />
          <Skeleton className="h-24 w-full rounded-xl" />
        </div>
        <div className="card space-y-3">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-2/3" />
        </div>
      </div>
    </div>
  );
}
