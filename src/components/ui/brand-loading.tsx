'use client';

import React, { useId } from 'react';
import { cn } from '@/lib/utils';

type BrandProgressBarProps = {
  progress: number;
  showPercent?: boolean;
  transitionMs?: number;
  ariaLabel?: string;
  className?: string;
};

export function HvttLoadingLogo({ className }: { className?: string }) {
  const gradientId = useId().replace(/:/g, '');
  const blueId = `${gradientId}-blue`;
  const softBlueId = `${gradientId}-soft-blue`;

  return (
    <svg
      viewBox="0 0 120 120"
      aria-hidden="true"
      className={cn(
        'h-full w-full overflow-visible drop-shadow-[0_0_18px_rgba(91,215,240,0.22)]',
        className
      )}
    >
      <style>
        {`
          .hvtt-loading-logo__disc {
            animation: hvttLogoBreathe 2.4s ease-in-out infinite;
            transform-origin: 60px 60px;
          }

          .hvtt-loading-logo__ring {
            animation: hvttLogoRing 2.4s ease-in-out infinite;
            stroke-dasharray: 315;
            stroke-dashoffset: 0;
            transform-origin: 60px 60px;
          }

          .hvtt-loading-logo__swoosh {
            animation: hvttLogoSwoosh 2.4s ease-in-out infinite;
          }

          @keyframes hvttLogoBreathe {
            0%, 100% { transform: scale(1); opacity: 0.96; }
            50% { transform: scale(1.035); opacity: 1; }
          }

          @keyframes hvttLogoRing {
            0%, 100% { stroke-dashoffset: 0; opacity: 0.7; }
            50% { stroke-dashoffset: -18; opacity: 1; }
          }

          @keyframes hvttLogoSwoosh {
            0%, 100% { opacity: 0.88; }
            50% { opacity: 1; }
          }
        `}
      </style>

      <defs>
        <linearGradient id={blueId} x1="18" y1="95" x2="104" y2="23" gradientUnits="userSpaceOnUse">
          <stop stopColor="#0599d1" />
          <stop offset="0.55" stopColor="#5bd7f0" />
          <stop offset="1" stopColor="#0c8ed0" />
        </linearGradient>
        <linearGradient id={softBlueId} x1="14" y1="89" x2="108" y2="30" gradientUnits="userSpaceOnUse">
          <stop stopColor="#27b5e4" />
          <stop offset="1" stopColor="#7fdcf6" />
        </linearGradient>
      </defs>

      <g className="hvtt-loading-logo__disc">
        <circle cx="60" cy="60" r="53" fill="#f8fdff" />
        <circle
          className="hvtt-loading-logo__ring"
          cx="60"
          cy="60"
          r="53"
          fill="none"
          stroke="#73d4f4"
          strokeWidth="1.5"
        />

        <path
          className="hvtt-loading-logo__swoosh"
          d="M9 72C28 63 44 44 62 12C47 29 34 43 20 51C34 46 47 35 65 18C51 44 34 65 9 72Z"
          fill={`url(#${blueId})`}
        />
        <path
          className="hvtt-loading-logo__swoosh"
          d="M111 48C92 57 76 76 58 108C73 91 86 77 100 69C86 74 73 85 55 102C69 76 86 55 111 48Z"
          fill={`url(#${blueId})`}
        />
        <path
          d="M25 88C39 83 51 74 64 61C54 77 44 91 30 101C46 94 60 82 78 62C65 86 48 101 25 108C29 101 29 95 25 88Z"
          fill={`url(#${softBlueId})`}
          opacity="0.84"
        />
        <path
          d="M95 32C81 37 69 46 56 59C66 43 76 29 90 19C74 26 60 38 42 58C55 34 72 19 95 12C91 19 91 25 95 32Z"
          fill={`url(#${softBlueId})`}
          opacity="0.84"
        />

        <g transform="rotate(-35 60 60)">
          <text
            x="34"
            y="60"
            fill="#ef3348"
            fontFamily="Arial, Helvetica, sans-serif"
            fontSize="18"
            fontWeight="800"
            letterSpacing="1.2"
          >
            HVTT
          </text>
          <text
            x="48"
            y="77"
            fill="#19aee4"
            fontFamily="Arial, Helvetica, sans-serif"
            fontSize="11"
            fontWeight="600"
            letterSpacing="0.8"
          >
            Software
          </text>
        </g>
      </g>
    </svg>
  );
}

export function BrandProgressBar({
  progress,
  showPercent = true,
  transitionMs = 300,
  ariaLabel = 'Loading progress',
  className,
}: BrandProgressBarProps) {
  const displayProgress = Math.max(1, Math.min(100, Math.round(progress)));

  return (
    <div className={cn('w-full', className)}>
      <div className="flex items-center gap-4">
        <div
          className="h-[9px] flex-1 overflow-hidden rounded-full bg-[#062052]"
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={100}
          aria-valuenow={displayProgress}
          aria-label={ariaLabel}
        >
          <div
            style={{
              width: `${displayProgress}%`,
              transition: `width ${transitionMs}ms linear`,
            }}
            className="h-full rounded-full bg-[#5bd7f0] shadow-[0_0_14px_rgba(91,215,240,0.45)]"
          />
        </div>

        {showPercent && (
          <div className="w-12 text-right text-sm font-semibold leading-none text-foreground tabular-nums dark:text-slate-100">
            {displayProgress}%
          </div>
        )}
      </div>
    </div>
  );
}

export function BrandLoadingIndicator({
  progress,
  showPercent = true,
  transitionMs = 300,
  className,
}: {
  progress: number;
  showPercent?: boolean;
  transitionMs?: number;
  className?: string;
}) {
  return (
    <div className={cn('flex w-[min(70vw,340px)] -translate-y-8 flex-col items-center gap-7', className)}>
      <div className="relative flex h-[88px] w-[88px] items-center justify-center">
        <HvttLoadingLogo />
      </div>
      <BrandProgressBar progress={progress} showPercent={showPercent} transitionMs={transitionMs} />
    </div>
  );
}

export function BrandLoadingSpinner({ className }: { className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center', className)}>
      <div className="relative flex h-[116px] w-[116px] items-center justify-center">
        <div
          className="
            absolute inset-0 rounded-full
            border-[3px] border-[#08295f]
            border-t-[#5bd7f0] border-r-[#27b5e4]
            shadow-[0_0_28px_rgba(91,215,240,0.18)]
            animate-spin
          "
          aria-hidden="true"
        />
        <div
          className="
            absolute inset-[9px] rounded-full
            border border-[#5bd7f0]/20
            shadow-[inset_0_0_16px_rgba(91,215,240,0.12)]
          "
          aria-hidden="true"
        />
        <div className="relative h-[78px] w-[78px]">
          <HvttLoadingLogo />
        </div>
      </div>
    </div>
  );
}
