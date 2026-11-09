/** The CodebaseXplorer mark: an X made of a graph (four nodes joined through a highlighted center). Decorative by default. */
export function LogoMark({ size = 28, title }: { size?: number; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true} focusable="false">
      <rect width="64" height="64" rx="14" fill="#1f5fd6" />
      <g stroke="#ffffff" strokeWidth="4.5" strokeLinecap="round">
        <path d="M18 18 L46 46 M46 18 L18 46" />
      </g>
      <g fill="#ffffff">
        <circle cx="18" cy="18" r="5.5" />
        <circle cx="46" cy="18" r="5.5" />
        <circle cx="18" cy="46" r="5.5" />
        <circle cx="46" cy="46" r="5.5" />
      </g>
      <circle cx="32" cy="32" r="7" fill="#ffc83d" />
    </svg>
  );
}
