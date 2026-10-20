export function LogoMark({ className = 'size-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="#17181A" />
      <path d="M9 11.5h14M9 16h9M9 20.5h11" stroke="#3FB07C" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

export function Logo() {
  return (
    <span className="inline-flex items-center gap-2 text-[14.5px] font-semibold tracking-[-0.01em] text-ink">
      <LogoMark />
      Threadline
    </span>
  );
}
