import type { AnnotationMeasurement } from '@/platform/core';

function serializeFingerprintValue(
  value: unknown,
  ancestors: WeakSet<object>
): string {
  if (value === null) return 'null';

  switch (typeof value) {
    case 'undefined':
      return 'undefined';
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (Number.isNaN(value)) return 'NaN';
      if (value === Number.POSITIVE_INFINITY) return 'Infinity';
      if (value === Number.NEGATIVE_INFINITY) return '-Infinity';
      return Object.is(value, -0) ? '-0' : String(value);
    case 'bigint':
      return `${value.toString()}n`;
    case 'function':
    case 'symbol':
      return '';
  }

  if (value instanceof Date) {
    return `Date(${value.toISOString()})`;
  }

  if (ArrayBuffer.isView(value)) {
    return `[${Array.from(
      value as unknown as ArrayLike<number>,
      (item) => serializeFingerprintValue(item, ancestors)
    ).join(',')}]`;
  }

  if (Array.isArray(value)) {
    if (ancestors.has(value)) return '[Circular]';
    ancestors.add(value);
    const serialized = `[${value
      .map((item) => serializeFingerprintValue(item, ancestors))
      .join(',')}]`;
    ancestors.delete(value);
    return serialized;
  }

  const objectValue = value as Record<string, unknown>;
  if (ancestors.has(objectValue)) return '{Circular}';
  ancestors.add(objectValue);
  const serialized = `{${Object.keys(objectValue)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${serializeFingerprintValue(
          objectValue[key],
          ancestors
        )}`
    )
    .join(',')}}`;
  ancestors.delete(objectValue);
  return serialized;
}

/**
 * Fingerprint the fields that define a measurement snapshot.
 *
 * Geometry and cached statistics are included deliberately: UID/createdAt
 * alone cannot detect a handle drag or a recalculated measurement value.
 */
export function createMeasurementFingerprint(
  measurement: AnnotationMeasurement
): string {
  return serializeFingerprintValue(
    {
      annotationUID: measurement.annotationUID,
      toolName: measurement.toolName,
      type: measurement.type,
      label: measurement.label,
      createdAt: measurement.createdAt,
      data: measurement.data,
      metadata: {
        studyUID: measurement.metadata?.studyUID,
        seriesUID: measurement.metadata?.seriesUID,
        reportSeriesUID: measurement.metadata?.reportSeriesUID,
        trackingUID: measurement.metadata?.trackingUID,
        frameIndex: measurement.metadata?.frameIndex,
        referencedImageId: measurement.metadata?.referencedImageId,
        imageId: measurement.metadata?.imageId,
      },
    },
    new WeakSet()
  );
}

export function createMeasurementListFingerprint(
  measurements: AnnotationMeasurement[]
): string {
  return measurements
    .map(createMeasurementFingerprint)
    .sort()
    .join('|');
}
