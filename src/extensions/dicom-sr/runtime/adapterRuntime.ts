'use client';

/**
 * Keep the SR adapter out of the initial viewer bundle.  It is relatively
 * large and is only needed when a report is created or hydrated.
 */
let adapterRuntimePromise: Promise<any> | null = null;
const UNIT_PATCH_MARKER = Symbol.for(
  'my-dicom-viewer.cornerstone-sr-unit-patch'
);
const RECTANGLE_HYDRATION_PATCH_MARKER = Symbol.for(
  'my-dicom-viewer.cornerstone-sr-rectangle-hydration-patch'
);

export const SUPPORTED_SR_TOOL_NAMES = new Set([
  'Length',
  'Bidirectional',
  'ArrowAnnotate',
  'EllipticalROI',
  'RectangleROI',
  'CircleROI',
  'SplineROI',
  'Angle',
]);

function registerSplineRoiAdapter(cornerstone3D: any): void {
  const { MeasurementReport, PlanarFreehandROI } = cornerstone3D;
  const adapters = MeasurementReport?.measurementAdapterByToolType;

  if (!adapters || adapters.has('SplineROI') || !PlanarFreehandROI) {
    return;
  }

  /**
   * Cornerstone 3.33 does not ship a named SplineROI SR adapter.  A closed
   * SplineROI has the same TID300 polyline representation as
   * PlanarFreehandROI, so register it as a subtype instead of rewriting its
   * world coordinates.
   */
  const registerSubType = (PlanarFreehandROI as any).registerSubType;
  if (typeof registerSubType !== 'function') {
    throw new Error('Cornerstone SR adapter does not support SplineROI.');
  }

  registerSubType.call(
    PlanarFreehandROI,
    PlanarFreehandROI,
    'SplineROI'
  );
}

function getReferencedStats(tool: any): Record<string, any> {
  const referencedImageId = tool?.metadata?.referencedImageId;
  return (
    tool?.data?.cachedStats?.[`imageId:${referencedImageId}`] ?? {}
  );
}

function toLengthUnit(value: unknown): 'mm' | 'px' {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .startsWith('px')
    ? 'px'
    : 'mm';
}

function toAreaUnit(value: unknown): 'mm2' | 'px²' {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .startsWith('px')
    ? 'px²'
    : 'mm2';
}

/**
 * adapters 3.33 omits unit arguments for multiple TID300 representations.
 * Wrap the official adapter argument builders instead of replacing their
 * geometry/tracking behavior, preserving calibrated pixel units when present.
 */
function patchMeasurementUnits(cornerstone3D: any): void {
  const adapters =
    cornerstone3D.MeasurementReport?.measurementAdapterByToolType;
  if (!adapters) return;

  for (const toolName of SUPPORTED_SR_TOOL_NAMES) {
    const adapter = adapters.get(toolName);
    const original = adapter?.getTID300RepresentationArguments;
    if (
      !adapter ||
      typeof original !== 'function' ||
      Object.prototype.hasOwnProperty.call(adapter, UNIT_PATCH_MARKER)
    ) {
      continue;
    }

    adapter.getTID300RepresentationArguments = function (
      tool: any,
      is3DMeasurement = false
    ) {
      const args = original.call(this, tool, is3DMeasurement);
      const stats = getReferencedStats(tool);
      const lengthUnit = toLengthUnit(
        stats.unit ?? stats.radiusUnit ?? stats.areaUnit
      );
      const areaUnit = toAreaUnit(stats.areaUnit ?? stats.unit);

      if (
        toolName === 'Length' ||
        toolName === 'Bidirectional' ||
        toolName === 'CircleROI' ||
        toolName === 'RectangleROI' ||
        toolName === 'SplineROI'
      ) {
        args.unit = lengthUnit;
      }
      if (
        toolName === 'EllipticalROI' ||
        toolName === 'CircleROI' ||
        toolName === 'RectangleROI' ||
        toolName === 'SplineROI'
      ) {
        args.areaUnit = areaUnit;
      }

      return args;
    };
    Object.defineProperty(adapter, UNIT_PATCH_MARKER, {
      configurable: false,
      enumerable: false,
      value: true,
    });
  }
}

/**
 * adapters 3.33's RectangleROI reader indexes ConceptNameCodeSequence and
 * MeasuredValueSequence as arrays directly. dcmjs may keep a single sequence
 * item as an object in an in-memory report, causing generateToolState to skip
 * the entire Rectangle group. Normalize only the shape consumed by that
 * official reader; geometry and TID300 interpretation remain untouched.
 */
function patchRectangleHydration(cornerstone3D: any): void {
  const rectangleAdapter =
    cornerstone3D.MeasurementReport?.measurementAdapterByToolType?.get(
      'RectangleROI'
    );
  const original = rectangleAdapter?.getMeasurementData;
  if (
    !rectangleAdapter ||
    typeof original !== 'function' ||
    Object.prototype.hasOwnProperty.call(
      rectangleAdapter,
      RECTANGLE_HYDRATION_PATCH_MARKER
    )
  ) {
    return;
  }

  rectangleAdapter.getMeasurementData = function (
    measurementGroup: any,
    ...args: any[]
  ) {
    const contentSequence = Array.isArray(
      measurementGroup?.ContentSequence
    )
      ? measurementGroup.ContentSequence
      : measurementGroup?.ContentSequence
        ? [measurementGroup.ContentSequence]
        : [];
    const normalizedGroup = {
      ...measurementGroup,
      ContentSequence: contentSequence.map((item: any) => {
        if (item?.ValueType !== 'NUM') return item;

        const conceptNameCodeSequence = Array.isArray(
          item.ConceptNameCodeSequence
        )
          ? item.ConceptNameCodeSequence
          : item.ConceptNameCodeSequence
            ? [item.ConceptNameCodeSequence]
            : [];
        const measuredValueSequence = (
          Array.isArray(item.MeasuredValueSequence)
            ? item.MeasuredValueSequence
            : item.MeasuredValueSequence
              ? [item.MeasuredValueSequence]
              : []
        ).map((measuredValue: any) => ({
          ...measuredValue,
          MeasurementUnitsCodeSequence: Array.isArray(
            measuredValue?.MeasurementUnitsCodeSequence
          )
            ? measuredValue.MeasurementUnitsCodeSequence
            : measuredValue?.MeasurementUnitsCodeSequence
              ? [measuredValue.MeasurementUnitsCodeSequence]
              : [],
        }));

        return {
          ...item,
          ConceptNameCodeSequence: conceptNameCodeSequence,
          MeasuredValueSequence: measuredValueSequence,
        };
      }),
    };
    return original.call(this, normalizedGroup, ...args);
  };
  Object.defineProperty(
    rectangleAdapter,
    RECTANGLE_HYDRATION_PATCH_MARKER,
    {
      configurable: false,
      enumerable: false,
      value: true,
    }
  );
}

export async function getCornerstoneSrRuntime(): Promise<{
  MeasurementReport: any;
  cornerstone3D: any;
}> {
  if (!adapterRuntimePromise) {
    adapterRuntimePromise = import('@cornerstonejs/adapters')
      .then(({ adaptersSR }) => {
        const cornerstone3D = adaptersSR?.Cornerstone3D;
        if (!cornerstone3D?.MeasurementReport) {
          throw new Error('Cornerstone DICOM SR adapter is unavailable.');
        }

        registerSplineRoiAdapter(cornerstone3D);
        patchMeasurementUnits(cornerstone3D);
        patchRectangleHydration(cornerstone3D);
        return {
          MeasurementReport: cornerstone3D.MeasurementReport,
          cornerstone3D,
        };
      })
      .catch((error) => {
        adapterRuntimePromise = null;
        throw error;
      });
  }

  return adapterRuntimePromise;
}
