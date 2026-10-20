import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-2 text-center">
      <p className="text-[12px] font-medium text-ink-3">404</p>
      <h1 className="text-[18px] font-semibold">This page does not exist</h1>
      <Link to="/app" className="text-[13.5px] font-medium text-accent-ink hover:underline">
        Go to the dashboard
      </Link>
    </div>
  );
}
