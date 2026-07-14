import type {
  Disposable,
  MeasurementService,
  ViewportService,
} from '../contracts';
import {
  CommandManager,
  DisplaySetService,
  type CommandSchemaConstraint,
  type EmptyCommandSchema,
} from '../services';

export type ViewerRuntimeStatus = 'active' | 'disposing' | 'disposed';

export interface ViewerRuntimeOptions<
  TCommands extends CommandSchemaConstraint<TCommands> = EmptyCommandSchema,
  TMountTarget = unknown,
  TMeasurementData = unknown,
> {
  /** Unique within the application; no global runtime is created. */
  viewerId: string;
  commandManager?: CommandManager<TCommands>;
  displaySetService?: DisplaySetService;
  viewportService?: ViewportService<TMountTarget>;
  measurementService?: MeasurementService<TMeasurementData>;
}

type RuntimeService = unknown;

function isDisposable(value: unknown): value is Disposable {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Partial<Disposable>).dispose === 'function'
  );
}

/**
 * A per-viewer service container and lifecycle boundary.
 *
 * It is deliberately not a singleton.  Each Viewer instance can own one
 * runtime and dispose all adapter resources in reverse registration order.
 */
export class ViewerRuntime<
  TCommands extends CommandSchemaConstraint<TCommands> = EmptyCommandSchema,
  TMountTarget = unknown,
  TMeasurementData = unknown,
> {
  readonly viewerId: string;
  readonly commands: CommandManager<TCommands>;
  readonly displaySets: DisplaySetService;
  readonly viewport?: ViewportService<TMountTarget>;
  readonly measurements?: MeasurementService<TMeasurementData>;

  private readonly services = new Map<string, RuntimeService>();
  private readonly ownedServices: RuntimeService[] = [];
  private runtimeStatus: ViewerRuntimeStatus = 'active';
  private disposePromise?: Promise<void>;

  constructor(options: ViewerRuntimeOptions<TCommands, TMountTarget, TMeasurementData>) {
    if (!options.viewerId.trim()) {
      throw new Error('ViewerRuntime requires a non-empty viewerId');
    }

    this.viewerId = options.viewerId;
    this.commands = options.commandManager ?? new CommandManager<TCommands>();
    this.displaySets = options.displaySetService ?? new DisplaySetService();
    this.viewport = options.viewportService;
    this.measurements = options.measurementService;

    this.addOwnedService('commands', this.commands);
    this.addOwnedService('displaySets', this.displaySets);
    if (this.viewport) this.addOwnedService('viewport', this.viewport);
    if (this.measurements) this.addOwnedService('measurements', this.measurements);
  }

  get status(): ViewerRuntimeStatus {
    return this.runtimeStatus;
  }

  getService<TService = unknown>(serviceId: string): TService | undefined {
    return this.services.get(serviceId) as TService | undefined;
  }

  /**
   * Adds an extension-owned service to this viewer only. The service is
   * disposed with the runtime when it exposes a `dispose` method.
   */
  registerService<TService>(serviceId: string, service: TService): () => void {
    this.assertActive();
    if (!serviceId.trim()) throw new Error('Service id cannot be empty');
    if (this.services.has(serviceId)) {
      throw new Error(`Viewer service already registered: ${serviceId}`);
    }

    this.services.set(serviceId, service);
    this.ownedServices.push(service);

    return () => {
      if (this.services.get(serviceId) !== service) return;
      this.services.delete(serviceId);
      const index = this.ownedServices.lastIndexOf(service);
      if (index >= 0) this.ownedServices.splice(index, 1);
    };
  }

  dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise;

    this.runtimeStatus = 'disposing';
    this.disposePromise = this.disposeOwnedServices();
    return this.disposePromise;
  }

  private addOwnedService(serviceId: string, service: RuntimeService): void {
    this.services.set(serviceId, service);
    this.ownedServices.push(service);
  }

  private async disposeOwnedServices(): Promise<void> {
    const disposedInstances = new Set<RuntimeService>();
    let firstError: unknown;

    for (const service of this.ownedServices.slice().reverse()) {
      if (disposedInstances.has(service)) continue;
      disposedInstances.add(service);

      if (!isDisposable(service)) continue;
      try {
        await service.dispose();
      } catch (error) {
        firstError ??= error;
      }
    }

    this.ownedServices.length = 0;
    this.services.clear();
    this.runtimeStatus = 'disposed';

    if (firstError !== undefined) throw firstError;
  }

  private assertActive(): void {
    if (this.runtimeStatus !== 'active') {
      throw new Error(`ViewerRuntime is ${this.runtimeStatus}`);
    }
  }
}

export function createViewerRuntime<
  TCommands extends CommandSchemaConstraint<TCommands> = EmptyCommandSchema,
  TMountTarget = unknown,
  TMeasurementData = unknown,
>(
  options: ViewerRuntimeOptions<TCommands, TMountTarget, TMeasurementData>
): ViewerRuntime<TCommands, TMountTarget, TMeasurementData> {
  return new ViewerRuntime(options);
}
