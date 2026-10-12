import type { ReactNode, ButtonHTMLAttributes } from "react";
const paths: Record<string, ReactNode> = {
  pen: (
    <>
      <path d="m16 3 5 5-12 12-6 1 1-6Z" />
      <path d="m14 5 5 5M3 21h18" />
    </>
  ),
  book: (
    <>
      <path d="M12 5c-3-2-6-2-10-1v15c4-1 7-1 10 1 3-2 6-2 10-1V4c-4-1-7-1-10 1v15" />
    </>
  ),
  camera: (
    <>
      <path d="M3 7h4l2-3h6l2 3h4v14H3Z" />
      <circle cx="12" cy="13" r="4" />
    </>
  ),
  film: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M7 3v18M17 3v18M3 8h4m-4 8h4M17 8h4m-4 8h4" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="2" width="6" height="13" rx="3" />
      <path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8" />
    </>
  ),
  settings: (
    <>
      <path d="m10 3-1 3-3 1-3-1-1 4 3 2v3l-2 2 3 3 3-1 2 2 4-1 1-3 3-1 3 1 1-4-3-2v-3l2-2-3-3-3 1-2-2Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 1v2m0 18v2M1 12h2m18 0h2M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2" />
    </>
  ),
  moon: <path d="M21 13A9 9 0 0 1 11 3a9 9 0 1 0 10 10Z" />,
  monitor: (
    <>
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M12 17v4m-5 0h10" />
    </>
  ),
  windows: (
    <>
      <rect x="3" y="3" width="13" height="13" rx="2" />
      <path d="M9 19v2h12V9h-2" />
    </>
  ),
  copy: (
    <>
      <rect x="8" y="8" width="13" height="13" rx="2" />
      <path d="M5 16H3V3h13v2" />
    </>
  ),
  paste: (
    <>
      <rect x="8" y="2" width="8" height="4" rx="1" />
      <path d="M8 4H4v18h16V4h-4" />
    </>
  ),
  trash: (
    <>
      <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7" />
    </>
  ),
  swap: (
    <>
      <path d="M3 7h17l-4-4m4 14H3l4 4M20 7l-4 4M3 17l4-4" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 7v5h-5M4 17v-5h5M5 7a8 8 0 0 1 14-2l1 2M4 17l1 2a8 8 0 0 0 14-2" />
    </>
  ),
  chevron: <path d="m6 9 6 6 6-6" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  minus: <path d="M5 12h14" />,
  expand: (
    <>
      <path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" />
    </>
  ),
  play: <path d="m8 4 13 8-13 8Z" />,
  stop: <rect x="5" y="5" width="14" height="14" rx="2" />,
  target: (
    <>
      <path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M8 12h8m-4-4v8" />
    </>
  ),
  volume: (
    <>
      <path d="M3 9h4l5-5v16l-5-5H3Z" />
      <path d="M16 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" />
    </>
  ),
  check: <path d="m4 12 5 5L20 6" />,
  warn: (
    <>
      <path d="m12 3 10 18H2Z" />
      <path d="M12 9v5m0 3v.1" />
    </>
  ),
  ornament: (
    <>
      <path d="m12 4 8 8-8 8-8-8Z" />
      <path d="m12 8 4 4-4 4-4-4Z" />
    </>
  ),
  back: <path d="m10 5-7 7 7 7M3 12h18" />,
  grip: (
    <>
      <circle cx="8" cy="6" r=".5" />
      <circle cx="16" cy="6" r=".5" />
      <circle cx="8" cy="12" r=".5" />
      <circle cx="16" cy="12" r=".5" />
      <circle cx="8" cy="18" r=".5" />
      <circle cx="16" cy="18" r=".5" />
    </>
  ),
  flask: (
    <>
      <path d="M8 3h8m-6 0v7L3 21h18l-7-11V3M7 16h10" />
    </>
  ),
};
export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] ?? paths.book}
    </svg>
  );
}
export function IconButton({
  icon,
  label,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: string; label: string }) {
  return (
    <button
      type="button"
      className="icon-button"
      aria-label={label}
      title={label}
      {...props}
    >
      <Icon name={icon} />
    </button>
  );
}
