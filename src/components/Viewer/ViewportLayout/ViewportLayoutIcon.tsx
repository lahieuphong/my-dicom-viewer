import type { SVGProps } from 'react';

/** Viewport grid + settings icon modelled after OHIF's Change layout control. */
export default function ViewportLayoutIcon(
  props: SVGProps<SVGSVGElement>
) {
  return (
    <svg
      viewBox="0 0 28 28"
      fill="none"
      focusable="false"
      {...props}
    >
      <rect
        x="2.75"
        y="2.75"
        width="18.5"
        height="18.5"
        rx="2.25"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M11.75 3.25v17.5M3.25 11.75h17.5"
        stroke="currentColor"
        strokeWidth="1.65"
        strokeLinecap="round"
      />

      <circle
        cx="21.25"
        cy="21.25"
        r="3.35"
        fill="var(--color-card)"
        stroke="currentColor"
        strokeWidth="1.55"
      />
      <circle
        cx="21.25"
        cy="21.25"
        r="1.15"
        stroke="currentColor"
        strokeWidth="1.35"
      />
      <path
        d="M21.25 16.45v1.35M21.25 24.7v1.35M16.45 21.25h1.35M24.7 21.25h1.35M17.85 17.85l.95.95M23.7 23.7l.95.95M24.65 17.85l-.95.95M18.8 23.7l-.95.95"
        stroke="currentColor"
        strokeWidth="1.55"
        strokeLinecap="round"
      />
    </svg>
  );
}
