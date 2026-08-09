import type { SVGProps } from 'react';

/** Decorative icon for OHIF's Invert/"Ảnh dương bản" viewport toggle. */
export function InvertIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      focusable="false"
      {...props}
    >
      <rect
        x="3"
        y="3"
        width="18"
        height="18"
        rx="2.5"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <circle
        cx="12"
        cy="12"
        r="6"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <path
        d="M12 6a6 6 0 0 0 0 12V6Z"
        fill="currentColor"
      />
    </svg>
  );
}
