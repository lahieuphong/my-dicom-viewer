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

/** Decorative icon for the four-point Cobb Angle measurement tool. */
export function CobbAngleIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      focusable="false"
      {...props}
    >
      <path
        d="M4.5 5.25 13.5 8M10.5 16 19.5 13.25"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="m10.75 8.25 2.5 5.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeDasharray="1 2"
      />
      <circle cx="4.5" cy="5.25" r="1.4" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="13.5" cy="8" r="1.4" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="10.5" cy="16" r="1.4" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="19.5" cy="13.25" r="1.4" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/** Decorative ruler and double-arrow icon for OHIF's Calibration tool. */
export function CalibrationIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      focusable="false"
      {...props}
    >
      <rect
        x="4"
        y="4"
        width="16"
        height="5"
        rx="1.25"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M7 5.5v2M10 5.5v2M13 5.5v2M16 5.5v2"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
      <path
        d="M4.5 16.5h15M4.5 16.5l2.75-2.75M4.5 16.5l2.75 2.75M19.5 16.5l-2.75-2.75M19.5 16.5l-2.75 2.75"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
