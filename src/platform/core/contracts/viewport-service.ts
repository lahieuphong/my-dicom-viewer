import type {
  RegisteredDisplaySet,
  SetDisplaySetOptions,
  ViewportId,
  ViewportSnapshot,
} from '../domain';
import type { Disposable, Dispose, MaybePromise } from './disposable';

export type ViewportServiceEvent =
  | { type: 'changed'; snapshot: ViewportSnapshot }
  | { type: 'removed'; viewportId: ViewportId };

export interface MountViewportOptions<TMountTarget = unknown> {
  viewportId: ViewportId;
  mountTarget: TMountTarget;
}

/**
 * Exclusive owner of viewport mount, display-set attachment and teardown.
 * The mount target is generic so the core does not depend on HTMLElement.
 */
export interface ViewportService<TMountTarget = unknown> extends Disposable {
  mount(options: MountViewportOptions<TMountTarget>): MaybePromise<void>;
  unmount(viewportId: ViewportId): MaybePromise<void>;
  setDisplaySet(
    viewportId: ViewportId,
    displaySet: RegisteredDisplaySet,
    options?: SetDisplaySetOptions
  ): MaybePromise<void>;
  setImageIndex(viewportId: ViewportId, imageIndex: number): MaybePromise<void>;
  getSnapshot(viewportId: ViewportId): ViewportSnapshot | undefined;
  subscribe(listener: (event: ViewportServiceEvent) => void): Dispose;
}
