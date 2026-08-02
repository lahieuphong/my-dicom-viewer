import type { ReactNode, SVGProps } from 'react';

export type MeasurementToolIcon = (
  props: SVGProps<SVGSVGElement>
) => ReactNode;

const iconProps = {
  'aria-hidden': true,
  fill: 'none',
  viewBox: '0 0 28 28',
} as const;

// Geometry follows OHIF ui-next's MIT-licensed measurement icon set. Keeping
// these local avoids a large UI dependency and keeps every menu glyph aligned.
export function LengthIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...iconProps} {...props}>
      <g
        transform="translate(2, 2.5)"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect
          strokeWidth="1.5"
          transform="translate(11.5003, 11.5005) rotate(-45.001) translate(-11.5003, -11.5005)"
          x="-0.874220029"
          y="7.6109894"
          width="24.749"
          height="7.779"
          rx="1"
        />
        <line x1="5.11737261" y1="12.3844231" x2="7.13237261" y2="14.3684231" />
        <line x1="7.68571234" y1="9.81508336" x2="10.1857123" y2="12.3150834" />
        <line x1="10.1225521" y1="7.37924362" x2="11.8725521" y2="9.12924362" />
        <line x1="12.5583918" y1="4.94240389" x2="15.0583918" y2="7.44240389" />
        <line x1="15.1127315" y1="2.38806416" x2="17.1277315" y2="4.37406416" />
        <line x1="2.56403288" y1="14.9377628" x2="5.06403288" y2="17.4377628" />
      </g>
    </svg>
  );
}

export function BidirectionalIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...iconProps} {...props}>
      <g transform="translate(2.5, 2.5)" stroke="currentColor">
        <g strokeLinecap="round" strokeLinejoin="round">
          <path
            d="M19.7288691,-0.335661423 C20.1766848,-0.335701004 20.6245155,-0.164922663 20.9661629,0.176604012 L22.785192,1.99444856 C23.0988548,2.30800052 23.2685446,2.7110041 23.2944775,3.12134197 C23.3217954,3.55359523 23.188997,3.99381095 22.8972982,4.34658876 L4.09686309,23.1566959 C3.72728287,23.5261645 3.24294798,23.7108988 2.75861309,23.7108988 C2.2742782,23.7108988 1.78994331,23.5261645 1.420283,23.1566158 L-0.19579707,21.5405357 C-0.56526569,21.1709555 -0.75,20.6866206 -0.75,20.2022857 C-0.75,19.7179508 -0.56526569,19.2336159 -0.195713448,18.8639521 L18.4915869,0.176901703 C18.833253,-0.16476434 19.2810535,-0.335621842 19.7288691,-0.335661423 Z"
            strokeWidth="1.5"
          />
          <line x1="4.1448988" y1="18.9142857" x2="5.71632738" y2="20.4765714" />
          <line x1="6.5688988" y1="16.4902857" x2="8.14261309" y2="18.0502857" />
          <line x1="8.9928988" y1="14.0662857" x2="10.5654702" y2="15.6274286" />
          <line x1="11.4168988" y1="11.6422857" x2="12.9917559" y2="13.2011429" />
          <line x1="13.8408988" y1="9.21714286" x2="15.4066131" y2="10.7874286" />
          <line x1="16.1345622" y1="6.9234795" x2="17.7002765" y2="8.49376521" />
          <line x1="18.5589283" y1="4.49911339" x2="20.1246426" y2="6.0693991" />
        </g>
        <path
          d="M9.21155442,3 L3.86096848,3 C3.30868373,3 2.86096848,3.44771525 2.86096848,4 L2.86096848,6.5 C2.86096848,7.05228475 3.30868373,7.5 3.86096848,7.5 L9.21155442,7.5"
          strokeWidth="1.5"
          transform="translate(6.0363, 5.25) rotate(-315) translate(-6.0363, -5.25)"
        />
        <path
          d="M21.0115544,14.7862614 L15.6609685,14.7862614 C15.1086837,14.7862614 14.6609685,15.2339767 14.6609685,15.7862614 L14.6609685,18.2862614 C14.6609685,18.8385462 15.1086837,19.2862614 15.6609685,19.2862614 L21.0115544,19.2862614"
          strokeWidth="1.5"
          transform="translate(17.8363, 17.0363) rotate(-135) translate(-17.8363, -17.0363)"
        />
      </g>
    </svg>
  );
}

export function AnnotationIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...iconProps} {...props}>
      <g
        transform="translate(4, 3.3899)"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      >
        <polyline points="8.59335038 20.2520716 0 20.2520716 0 11.6587212" />
        <line x1="0" y1="20.2520716" x2="19.6419437" y2="0.610127877" />
      </g>
    </svg>
  );
}

export function EllipseIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...iconProps} {...props}>
      <g transform="translate(1.6119, 2.6735)" stroke="currentColor" strokeWidth="1.5">
        <line x1="19.8333333" y1="14.625" x2="19.8333333" y2="22.9583333" strokeLinecap="round" />
        <line x1="24" y1="18.7916667" x2="15.6666667" y2="18.7916667" strokeLinecap="round" />
        <ellipse
          transform="translate(10.5, 7) rotate(89) translate(-10.5, -7)"
          cx="10.5"
          cy="7"
          rx="6.5"
          ry="10"
        />
      </g>
    </svg>
  );
}

export function RectangleIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...iconProps} {...props}>
      <g
        transform="translate(15.8182, 15.5)"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.65"
      >
        <line x1="3.78787879" y1="0" x2="3.78787879" y2="7.57575758" />
        <line x1="7.57575758" y1="3.78787879" x2="0" y2="3.78787879" />
      </g>
      <path
        d="M12.030303,19.2878788 L6,19.2878788 C4.8954305,19.2878788 4,18.3924483 4,17.2878788 L4,7.5 C4,6.3954305 4.8954305,5.5 6,5.5 L19.8924006,5.5 C20.9969701,5.5 21.8924006,6.3954305 21.8924006,7.5 L21.8924006,12.0059038"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function CircleIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...iconProps} {...props}>
      <circle stroke="currentColor" strokeWidth="1.5" cx="14" cy="14" r="9.5" />
    </svg>
  );
}

export function FreehandRoiIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...iconProps} {...props}>
      <g transform="translate(3, 2)" stroke="currentColor" strokeWidth="1.5">
        <path
          d="M0,0 C8,3 5,8.5 2,15.5 C-1,22.5 3.5,23 5,23 C6.08963707,23.0518834 7.15942037,22.6952889 8,22"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M21.38,12.619 L13.75,20.25 L10,21 L10.75,17.25 L18.38,9.619 C19.2062949,8.79296781 20.5457051,8.79296781 21.372,9.619 L21.38,9.628 C21.7771113,10.0243763 22.000268,10.5624193 22.000268,11.1235 C22.000268,11.6845807 21.7771113,12.2226237 21.38,12.619 Z"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M10.654274,17.2961006 C11.6738332,18.1907082 12.6933924,19.0853157 13.7129517,19.9799232" />
      </g>
    </svg>
  );
}

export function SplineRoiIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...iconProps} {...props}>
      <g transform="translate(5, 5)" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.5">
        <path d="M5,4 C6.80276265,2.42407491 9.10583462,1.538278 11.5,1.5 L15.5,1.5" />
        <path d="M1.5,15.5 L1.5,11.5 C1.50313857,9.33936854 2.19845937,7.23658385 3.484,5.5" />
        <circle strokeLinecap="round" cx="4" cy="4.5" r="1.5" />
        <circle strokeLinecap="round" cx="17.5" cy="1.5" r="1.5" />
        <circle strokeLinecap="round" cx="1.5" cy="17.5" r="1.5" />
      </g>
    </svg>
  );
}

export function LivewireIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...iconProps} {...props}>
      <line x1="12.5" y1="6.5" x2="8.5" y2="9.5" stroke="currentColor" strokeWidth="1.5" />
      <line x1="6.5" y1="12.5" x2="5.5" y2="19.5" stroke="currentColor" strokeWidth="1.5" />
      <g
        transform="translate(16.998, 17.5912) rotate(45) translate(-16.998, -17.5912) translate(12.496, 13.5)"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      >
        <line x1="0.00327299164" y1="2.45474373" x2="3.27626463" y2="2.45474373" />
        <line x1="5.73100836" y1="2.45474373" x2="9.004" y2="2.45474373" />
        <path d="M5.72773537,4.09123955 C5.72773537,4.76909831 5.17822227,5.31861141 4.5003635,5.31861141 C3.82250474,5.31861141 3.27299164,4.76909831 3.27299164,4.09123955 L3.27299164,0.81824791 C3.25976214,0.371936739 2.9010549,0.0132295012 2.45474373,0 L0.81824791,0 C0.371936739,0.0132295012 0.0132295012,0.371936739 0,0.81824791 L0,4.09123955 C0,6.80209487 2.01452635,8.1824791 4.5003635,8.1824791 C6.98620065,8.1824791 9.00072701,6.80209487 9.00072701,4.09123955 L9.00072701,0.81824791 C8.98749751,0.371936739 8.62879027,0.0132295012 8.1824791,0 L6.54598328,0 C6.09967211,0.0132295012 5.74096487,0.371936739 5.72773537,0.81824791 Z" />
      </g>
      <circle stroke="currentColor" strokeWidth="1.5" cx="14.5" cy="5.5" r="1.5" />
      <circle stroke="currentColor" strokeWidth="1.5" cx="5.5" cy="21.5" r="1.5" />
      <circle stroke="currentColor" strokeWidth="1.5" cx="7" cy="10.5" r="1.5" />
    </svg>
  );
}
