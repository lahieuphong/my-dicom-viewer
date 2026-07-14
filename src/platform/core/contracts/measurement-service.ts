import type { Measurement, MeasurementFilter } from '../domain';
import type { Disposable, Dispose, MaybePromise } from './disposable';

export type MeasurementServiceEvent<TData = unknown> =
  | { type: 'added'; measurement: Measurement<TData> }
  | { type: 'updated'; measurement: Measurement<TData> }
  | { type: 'removed'; annotationUID: string }
  | { type: 'cleared'; filter?: MeasurementFilter };

export type MeasurementServiceListener<TData = unknown> = (
  event: MeasurementServiceEvent<TData>
) => void;

/** Canonical owner for measurement state; rendering libraries act as adapters. */
export interface MeasurementService<TData = unknown> extends Disposable {
  get(annotationUID: string): Measurement<TData> | undefined;
  getAll(filter?: MeasurementFilter): Measurement<TData>[];
  upsert(measurement: Measurement<TData>): MaybePromise<void>;
  remove(annotationUID: string): MaybePromise<boolean>;
  clear(filter?: MeasurementFilter): MaybePromise<void>;
  subscribe(listener: MeasurementServiceListener<TData>): Dispose;
}
