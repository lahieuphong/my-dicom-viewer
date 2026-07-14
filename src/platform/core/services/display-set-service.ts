import type {
  DicomSeries,
  DicomStudy,
  DisplaySet,
  RegisteredDisplaySet,
} from '../domain';
import type {
  Dispose,
  OperationSignal,
  SopClassHandler,
  SopClassHandlerContext,
} from '../contracts';

export type DisplaySetServiceEvent =
  | { type: 'added'; displaySet: RegisteredDisplaySet }
  | { type: 'updated'; displaySet: RegisteredDisplaySet }
  | { type: 'removed'; displaySetInstanceUID: string }
  | { type: 'cleared' };

export type DisplaySetServiceListener = (event: DisplaySetServiceEvent) => void;

export interface BuildDisplaySetsOptions {
  signal?: OperationSignal;
}

type RegisteredHandler = {
  handler: SopClassHandler;
  order: number;
};

/**
 * Owns display-set identity and routes series through registered SOP handlers.
 * It has no renderer dependency and is safe to instantiate per viewer runtime.
 */
export class DisplaySetService {
  private readonly displaySets = new Map<string, RegisteredDisplaySet>();
  private readonly handlers: RegisteredHandler[] = [];
  private readonly listeners = new Set<DisplaySetServiceListener>();
  private nextHandlerOrder = 0;
  private nextAnonymousDisplaySetId = 0;
  private disposed = false;

  registerSopClassHandler(handler: SopClassHandler): Dispose {
    this.assertActive();

    if (this.handlers.some((entry) => entry.handler.id === handler.id)) {
      throw new Error(`SOP Class handler already registered: ${handler.id}`);
    }

    const registered = { handler, order: this.nextHandlerOrder++ };
    this.handlers.push(registered);
    this.sortHandlers();

    return () => {
      const index = this.handlers.indexOf(registered);
      if (index >= 0) this.handlers.splice(index, 1);
    };
  }

  get(displaySetInstanceUID: string): RegisteredDisplaySet | undefined {
    return this.displaySets.get(displaySetInstanceUID);
  }

  getAll(): RegisteredDisplaySet[] {
    return Array.from(this.displaySets.values());
  }

  getBySeries(seriesInstanceUID: string): RegisteredDisplaySet[] {
    return this.getAll().filter(
      (displaySet) => displaySet.seriesInstanceUID === seriesInstanceUID
    );
  }

  add(
    displaySet: DisplaySet,
    identityHint?: { handlerId?: string; index?: number }
  ): RegisteredDisplaySet {
    this.assertActive();

    const registered = this.withIdentity(displaySet, identityHint);
    const eventType = this.displaySets.has(registered.displaySetInstanceUID)
      ? 'updated'
      : 'added';

    this.displaySets.set(registered.displaySetInstanceUID, registered);
    this.emit({ type: eventType, displaySet: registered });
    return registered;
  }

  remove(displaySetInstanceUID: string): boolean {
    this.assertActive();

    const removed = this.displaySets.delete(displaySetInstanceUID);
    if (removed) {
      this.emit({ type: 'removed', displaySetInstanceUID });
    }
    return removed;
  }

  clear(): void {
    if (this.displaySets.size === 0) return;
    this.displaySets.clear();
    this.emit({ type: 'cleared' });
  }

  subscribe(listener: DisplaySetServiceListener): Dispose {
    this.assertActive();
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async buildDisplaySets(
    study: DicomStudy,
    series: DicomSeries,
    options: BuildDisplaySetsOptions = {}
  ): Promise<RegisteredDisplaySet[]> {
    this.assertActive();
    options.signal?.throwIfAborted?.();

    const context: SopClassHandlerContext = {
      study,
      series,
      instances: series.instances ?? [],
      signal: options.signal,
    };

    for (const { handler } of this.handlers) {
      options.signal?.throwIfAborted?.();
      if (!(await handler.supports(context))) continue;

      const displaySets = await handler.createDisplaySets(context);
      options.signal?.throwIfAborted?.();

      return displaySets.map((displaySet, index) =>
        this.add(
          {
            ...displaySet,
            studyInstanceUID:
              displaySet.studyInstanceUID ?? study.studyInstanceUID,
            seriesInstanceUID:
              displaySet.seriesInstanceUID ?? series.seriesInstanceUID,
            modality: displaySet.modality ?? series.seriesModality,
            metadata: displaySet.metadata ?? series,
          },
          { handlerId: handler.id, index }
        )
      );
    }

    return [];
  }

  dispose(): void {
    if (this.disposed) return;
    this.clear();
    this.disposed = true;
    this.handlers.length = 0;
    this.listeners.clear();
  }

  private withIdentity(
    displaySet: DisplaySet,
    hint: { handlerId?: string; index?: number } = {}
  ): RegisteredDisplaySet {
    const displaySetInstanceUID =
      displaySet.displaySetInstanceUID ||
      this.createDisplaySetInstanceUID(displaySet, hint);

    return { ...displaySet, displaySetInstanceUID };
  }

  private createDisplaySetInstanceUID(
    displaySet: DisplaySet,
    hint: { handlerId?: string; index?: number }
  ): string {
    if (displaySet.seriesInstanceUID) {
      const suffix = [hint.handlerId, hint.index]
        .filter((part) => part !== undefined && part !== '')
        .join(':');
      return suffix ? `${displaySet.seriesInstanceUID}:${suffix}` : displaySet.seriesInstanceUID;
    }

    this.nextAnonymousDisplaySetId += 1;
    return `display-set:${this.nextAnonymousDisplaySetId}`;
  }

  private sortHandlers(): void {
    this.handlers.sort((left, right) => {
      const byPriority = (right.handler.priority ?? 0) - (left.handler.priority ?? 0);
      return byPriority || left.order - right.order;
    });
  }

  private emit(event: DisplaySetServiceEvent): void {
    for (const listener of Array.from(this.listeners)) {
      listener(event);
    }
  }

  private assertActive(): void {
    if (this.disposed) {
      throw new Error('DisplaySetService has been disposed');
    }
  }
}
