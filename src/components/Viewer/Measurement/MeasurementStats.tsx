// src/components/Viewer/Measurement/MeasurementStats.tsx
import React from 'react';

interface MeasurementStatsProps {
  type: string;
  stats: Record<string, any>;
}

export default function MeasurementStats({ type, stats }: MeasurementStatsProps) {
  if (!stats) return null;

  const baseClass = "text-xs text-secondary-foreground";

  function safeNumberToFixed(v: unknown, digits = 2) {
    return typeof v === 'number' && !Number.isNaN(v) ? v.toFixed(digits) : '—';
  }

  const renderPoints = () => {
    const raw = stats.handles?.points ?? stats.handles ?? null;
    if (!raw) return null;

    let pointsArray: [number, number][] = [];

    if (Array.isArray(raw)) {
      pointsArray = raw
        .map((pt: any) => {
          if (Array.isArray(pt) && pt.length >= 2) return [Number(pt[0]), Number(pt[1])];
          if (pt && typeof pt.x === 'number' && typeof pt.y === 'number') return [pt.x, pt.y];
          if (pt && Array.isArray(pt.position) && pt.position.length >= 2) return [Number(pt.position[0]), Number(pt.position[1])];
          return null;
        })
        .filter(Boolean) as [number, number][];
    }

    if (!pointsArray.length) return null;

    return (
      <div className={`${baseClass} mt-1`}>
        <div className="font-semibold">Điểm:</div>
        <ul className="pl-4 list-disc">
          {pointsArray.map((pt, idx) => (
            <li key={idx}>
              ({safeNumberToFixed(pt[0])}, {safeNumberToFixed(pt[1])})
            </li>
          ))}
        </ul>
      </div>
    );
  };

  switch (type) {
    case 'length':
      return (
        <div className={baseClass}>
          Đo độ dài • {safeNumberToFixed(stats.length)} {stats.unit ?? ''}
          {renderPoints()}
        </div>
      );

    case 'bidirectional':
      return (
        <>
          <div className={baseClass}>
            Chiều dài • {safeNumberToFixed(stats.length)} {stats.unit ?? ''}
          </div>
          <div className={baseClass}>
            Chiều rộng • {safeNumberToFixed(stats.width)} {stats.widthUnit ?? ''}
          </div>
          {renderPoints()}
        </>
      );

    case 'arrowAnnotate':
      return (
        <div className={baseClass}>
          Chữ • {stats.text ?? ''}
          {renderPoints()}
        </div>
      );

    case 'ellipticalROI':
    case 'rectangleROI':
    case 'circleROI':
    case 'splineROI':
      return (
        <>
          <div className={baseClass}>
            Diện tích • {safeNumberToFixed(stats.area)} {stats.areaUnit ?? ''}
          </div>
          {stats.max != null && (
            <div className={baseClass}>
              Max • {safeNumberToFixed(stats.max)} {stats.modalityUnit ?? ''}
            </div>
          )}
          {renderPoints()}
        </>
      );

    case 'angle':
      return (
        <div className={baseClass}>
          Góc • {safeNumberToFixed(stats.angle)}°
          {renderPoints()}
        </div>
      );

    default:
      return null;
  }
}
