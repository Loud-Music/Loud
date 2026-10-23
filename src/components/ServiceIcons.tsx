export function AppleIcon({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M17.2 12.8c0-2 1.6-3 1.7-3.1-1-1.4-2.5-1.6-3-1.6-1.3-.2-2.5.8-3.2.8-.7 0-1.7-.8-2.8-.8-1.5 0-2.9.9-3.7 2.2-1.6 2.7-.4 6.8 1.1 9 .7 1 1.5 2 2.7 1.9 1.1 0 1.5-.7 2.8-.7s1.7.7 2.9.7 1.9-1 2.6-2c.8-1.2 1.2-2.4 1.2-2.5-.1 0-2.3-.9-2.3-3.9ZM15.1 6.6c.6-.8 1.1-1.9 1-3-.9 0-2.1.6-2.8 1.4-.6.7-1.2 1.8-1 2.9 1 .1 2.1-.5 2.8-1.3Z" />
    </svg>
  );
}
export function SpotifyIcon({ monochrome = false }: { monochrome?: boolean }) {
  return (
    <svg
      width="21"
      height="21"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        fill={monochrome ? "currentColor" : "#28b875"}
      />
      <path
        d="M6.5 9c4-1.3 7.3-1.1 11 1M7.3 12.2c3.2-1 6.1-.8 9.1.9M8.1 15.2c2.6-.7 4.8-.6 7.2.7"
        stroke={monochrome ? "var(--surface)" : "white"}
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
