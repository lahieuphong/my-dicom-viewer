type CobbAngleMeasurementStatsProps = {
  angle: unknown;
};

const STAT_CLASS = 'text-xs text-secondary-foreground';

function formatAngle(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? value.toFixed(2)
    : '—';
}

/** Measurement-panel copy for Cornerstone's native four-point Cobb angle. */
export default function CobbAngleMeasurementStats({
  angle,
}: CobbAngleMeasurementStatsProps) {
  return (
    <div className={STAT_CLASS}>
      Cobb Angle • {formatAngle(angle)}°
    </div>
  );
}
