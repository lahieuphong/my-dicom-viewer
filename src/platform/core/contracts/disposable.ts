export type MaybePromise<T> = T | Promise<T>;

export type Dispose = () => void;

export interface Disposable {
  dispose(): MaybePromise<void>;
}

/** Structurally compatible with AbortSignal without depending on DOM APIs. */
export interface OperationSignal {
  readonly aborted: boolean;
  readonly reason?: unknown;
  throwIfAborted?(): void;
}
