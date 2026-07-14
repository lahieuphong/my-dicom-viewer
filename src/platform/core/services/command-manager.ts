import type { Dispose, OperationSignal } from '../contracts';

/** Type-only command definition used to declare a command schema. */
export interface CommandSpec<TInput = void, TOutput = void> {
  readonly input?: TInput;
  readonly output?: TOutput;
}

export type CommandSchemaConstraint<TSchema> = {
  [TName in keyof TSchema]: CommandSpec<unknown, unknown>;
};

export type EmptyCommandSchema = Record<never, CommandSpec>;

export type CommandInput<TSpec> = TSpec extends CommandSpec<infer TInput, unknown>
  ? TInput
  : never;

export type CommandOutput<TSpec> = TSpec extends CommandSpec<unknown, infer TOutput>
  ? TOutput
  : never;

export interface CommandExecutionContext<TName extends string = string> {
  readonly commandName: TName;
  readonly viewerId?: string;
  readonly signal?: OperationSignal;
}

export type CommandHandler<TInput, TOutput, TName extends string = string> = (
  input: TInput,
  context: CommandExecutionContext<TName>
) => TOutput | Promise<TOutput>;

type CommandName<TSchema> = Extract<keyof TSchema, string>;

type CommandArguments<TInput> = [TInput] extends [void]
  ? [input?: undefined, context?: Omit<CommandExecutionContext, 'commandName'>]
  : [input: TInput, context?: Omit<CommandExecutionContext, 'commandName'>];

export interface RegisterCommandOptions {
  /** Explicitly replace an existing handler. Duplicate registration fails by default. */
  replace?: boolean;
}

/**
 * Small, typed command registry.  UI can execute commands without receiving
 * renderer callbacks as props, while adapters retain full ownership of effects.
 */
export class CommandManager<
  TSchema extends CommandSchemaConstraint<TSchema> = EmptyCommandSchema,
> {
  private readonly handlers = new Map<
    CommandName<TSchema>,
    CommandHandler<unknown, unknown>
  >();

  private disposed = false;

  register<TName extends CommandName<TSchema>>(
    commandName: TName,
    handler: CommandHandler<
      CommandInput<TSchema[TName]>,
      CommandOutput<TSchema[TName]>,
      TName
    >,
    options: RegisterCommandOptions = {}
  ): Dispose {
    this.assertActive();

    if (this.handlers.has(commandName) && !options.replace) {
      throw new Error(`Command already registered: ${commandName}`);
    }

    const erasedHandler = handler as CommandHandler<unknown, unknown>;
    this.handlers.set(commandName, erasedHandler);

    return () => {
      if (this.handlers.get(commandName) === erasedHandler) {
        this.handlers.delete(commandName);
      }
    };
  }

  has<TName extends CommandName<TSchema>>(commandName: TName): boolean {
    return this.handlers.has(commandName);
  }

  async execute<TName extends CommandName<TSchema>>(
    commandName: TName,
    ...args: CommandArguments<CommandInput<TSchema[TName]>>
  ): Promise<Awaited<CommandOutput<TSchema[TName]>>> {
    this.assertActive();

    const handler = this.handlers.get(commandName);
    if (!handler) {
      throw new Error(`Command is not registered: ${commandName}`);
    }

    const [input, executionContext] = args;
    const output = await handler(input, {
      ...executionContext,
      commandName,
    });

    return output as Awaited<CommandOutput<TSchema[TName]>>;
  }

  clear(): void {
    this.handlers.clear();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clear();
  }

  private assertActive(): void {
    if (this.disposed) {
      throw new Error('CommandManager has been disposed');
    }
  }
}
