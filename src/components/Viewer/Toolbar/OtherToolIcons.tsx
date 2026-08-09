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

/** Decorative target icon for OHIF's Probe/"Thông tin điểm ảnh" tool. */
export function ProbeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      focusable="false"
      {...props}
    >
      <circle
        cx="12"
        cy="12"
        r="6.25"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <circle cx="12" cy="12" r="1.75" fill="currentColor" />
      <path
        d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}
