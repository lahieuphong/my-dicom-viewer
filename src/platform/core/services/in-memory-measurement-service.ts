import type {
  Dispose,
  MeasurementService,
  MeasurementServiceEvent,
  MeasurementServiceListener,
} from '../contracts';
import type { Measurement, MeasurementFilter } from '../domain';

function matchesFilter<TData>(
  measurement: Measurement<TData>,
  filter: MeasurementFilter = {}
): boolean {
  return (
    (!filter.studyUID || measurement.metadata.studyUID === filter.studyUID) &&
    (!filter.seriesUID || measurement.metadata.seriesUID === filter.seriesUID) &&
    (!filter.viewportId ||
      measurement.metadata.viewportId === filter.viewportId) &&
    (!filter.toolName || measurement.toolName === filter.toolName)
  );
}

/**
 * Framework-neutral canonical measurement store.
 * Cornerstone annotations can synchronize through an adapter without making
 * React components or the SR serializer depend on Cornerstone global state.
 */
export class InMemoryMeasurementService<TData = unknown>
  implements MeasurementService<TData>
{
  private readonly measurements = new Map<string, Measurement<TData>>();
  private readonly listeners = new Set<MeasurementServiceListener<TData>>();
  private disposed = false;

  get(annotationUID: string): Measurement<TData> | undefined {
    return this.measurements.get(annotationUID);
  }

  getAll(filter: MeasurementFilter = {}): Measurement<TData>[] {
    return Array.from(this.measurements.values()).filter((measurement) =>
      matchesFilter(measurement, filter)
    );
  }

  upsert(measurement: Measurement<TData>): void {
    this.assertActive();
    const eventType = this.measurements.has(measurement.annotationUID)
      ? 'updated'
      : 'added';

    this.measurements.set(measurement.annotationUID, measurement);
    this.emit({ type: eventType, measurement });
  }

  remove(annotationUID: string): boolean {
    this.assertActive();
    const removed = this.measurements.delete(annotationUID);
    if (removed) this.emit({ type: 'removed', annotationUID });
    return removed;
  }

  clear(filter?: MeasurementFilter): void {
    this.assertActive();

    if (!filter) {
      if (this.measurements.size === 0) return;
      this.measurements.clear();
      this.emit({ type: 'cleared' });
      return;
    }

    let changed = false;
    for (const [annotationUID, measurement] of this.measurements) {
      if (!matchesFilter(measurement, filter)) continue;
      this.measurements.delete(annotationUID);
      changed = true;
    }

    if (changed) this.emit({ type: 'cleared', filter });
  }

  subscribe(listener: MeasurementServiceListener<TData>): Dispose {
    this.assertActive();
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    if (this.disposed) return;
    if (this.measurements.size > 0) {
      this.measurements.clear();
      this.emit({ type: 'cleared' });
    }
    this.listeners.clear();
    this.disposed = true;
  }

  private emit(event: MeasurementServiceEvent<TData>): void {
    for (const listener of Array.from(this.listeners)) listener(event);
  }

  private assertActive(): void {
    if (this.disposed) {
      throw new Error('InMemoryMeasurementService has been disposed');
    }
  }
}
