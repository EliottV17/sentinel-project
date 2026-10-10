interface SentinelBrandProps {
  compact?: boolean;
}

/** Consistent brand lockup for authentication and the signed-in shell. */
export function SentinelBrand({ compact = false }: SentinelBrandProps) {
  return (
    <span className="inline-flex items-center gap-3">
      <span
        aria-hidden="true"
        className={`flex shrink-0 items-center justify-center rounded-control bg-accent-soft text-accent ring-1 ring-accent/20 shadow-sm ${compact ? "size-8" : "size-10"}`}
      >
        <svg viewBox="0 0 32 32" fill="none" className="size-6" focusable="false">
          <circle cx="16" cy="16" r="11.5" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="16" cy="16" r="6.5" stroke="currentColor" strokeWidth="1.5" opacity="0.65" />
          <path d="M16 4.5v23M4.5 16h23M16 16l7.5-7.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="23.5" cy="8.5" r="2" fill="currentColor" />
        </svg>
      </span>
      <span className="font-serif text-xl font-semibold tracking-wide text-ink">Sentinel</span>
    </span>
  );
}
