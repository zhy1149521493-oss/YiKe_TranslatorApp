/** YiKe's overlapping translation bubbles, redrawn for small, themed UI surfaces. */
export function BrandMark({ size = 24 }: { size?: number }) {
  return (
    <svg
      className="brand-mark"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M17 3H8a6 6 0 0 0-6 6v9a5 5 0 0 0 4 5v4l5-4h2a9 9 0 0 0 9-9V8a5 5 0 0 0-5-5Z" />
      <path d="M22 8h2a6 6 0 0 1 6 6v9a5 5 0 0 1-4 5v3l-5-3a9 9 0 0 1-8-5" />
      <path d="m6 17 4-10 4 10M7.2 14h5.6" />
      <path d="M24 14v2m-5 0h9m-2 0c-.7 4-3.2 7-7 8m1-5c1.6 2.4 4 4 7 5" />
    </svg>
  );
}
