type ProbeMeasurementStatsProps = {
  stats: Record<string, unknown>;
};

const STAT_CLASS = 'text-xs text-secondary-foreground';

function formatNumber(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';

  // Keep integer image indexes exact while avoiding noisy floating-point
  // tails for calibrated modality values.
  return Number.isInteger(value)
    ? String(value)
    : String(Number(value.toFixed(2)));
}

function toValueArray(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (ArrayBuffer.isView(value)) {
    return Array.from(value as unknown as ArrayLike<unknown>);
  }
  return null;
}

function formatIndex(value: unknown): string {
  const index = toValueArray(value);
  if (!index || index.length < 2) return '—';
  return `(${index.map(formatNumber).join(', ')})`;
}

function getUnit(units: unknown, index: number): string {
  const unitList = toValueArray(units);
  const unit = unitList ? unitList[index] : units;
  return typeof unit === 'string' && unit.trim() ? ` ${unit.trim()}` : '';
}

function formatProbeValues(value: unknown, units: unknown): string[] {
  const valueList = toValueArray(value);
  if (valueList?.length) {
    return valueList.map(
      (entry, index) => `${formatNumber(entry)}${getUnit(units, index)}`
    );
  }

  return [`${formatNumber(value)}${getUnit(units, 0)}`];
}

/**
 * Panel representation of Cornerstone ProbeTool's native cached statistics.
 * The annotation overlay itself remains owned and rendered by ProbeTool.
 */
export default function ProbeMeasurementStats({
  stats,
}: ProbeMeasurementStatsProps) {
  const values = formatProbeValues(stats.value, stats.modalityUnit);

  return (
    <>
      <div className={STAT_CLASS}>
        Tọa độ điểm ảnh • {formatIndex(stats.index)}
      </div>
      {values.map((value, index) => (
        <div className={STAT_CLASS} key={`${index}:${value}`}>
          Giá trị{values.length > 1 ? ` ${index + 1}` : ''} • {value}
        </div>
      ))}
    </>
  );
}
