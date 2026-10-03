/**
 * The sliver of the Node type surface this repository uses, declared rather than
 * installed.
 *
 * `@types/node` is not a pre-approved dependency and neither consumer here has a
 * legitimate use for it: the browser application targets the browser and the
 * Edge Functions target Deno. Three kinds of file need something Node-specific,
 * and all three are outside `src/`, which is why they are covered here rather
 * than in three places:
 *
 * - `tests/setup/functional.ts` and `tests/unit/functional-suite-guard` read
 *   `process.env`, `process.execPath` and spawn the functional runner.
 * - `tests/unit/helpers/themeCss` and `tests/unit/styles/containerWidths` read
 *   the real stylesheet off disk so they compile what the app ships rather than a
 *   copy of it.
 * - `scripts/upload-images.ts` runs on Node and writes to production Storage. It
 *   was outside every typecheck until this file widened `tsconfig.node.json`
 *   over `scripts/`; a deploy step that can rot unchecked is a liability.
 *
 * One file for all of them on purpose. Two shims would be two Node type
 * surfaces that drift, and a script or a test that needs something the *other*
 * file declared would fail to typecheck for no visible reason.
 *
 * This file must stay a *script* (no top-level `import`/`export`): an ambient
 * `declare module` inside a module file is an augmentation, and augmenting a
 * module that does not exist is an error.
 *
 * If `@types/node` is ever approved, delete this file and the `types` include
 * from both `tsconfig` projects with it.
 */

declare const process: {
  readonly argv: readonly string[];
  readonly env: Record<string, string | undefined>;
  readonly execPath: string;
  readonly stdout: { write(chunk: string): boolean };
  readonly stderr: { write(chunk: string): boolean };
  exit(code?: number): never;
  cwd(): string;
};

declare const Buffer: {
  /** The one call the upload script makes: wrap a fetched body to measure it. */
  from(arrayBuffer: ArrayBuffer): Uint8Array;
};

declare module 'node:child_process' {
  export interface SpawnSyncResult {
    /** The exit code, or `null` when the child was killed by a signal. */
    status: number | null;

    stdout: string;
    stderr: string;
  }

  /** Callback form, as Node has it. `scripts/upload-images.ts` promisifies it. */
  export function execFile(
    command: string,
    args: readonly string[],
    options: { maxBuffer?: number },
    callback: (error: Error | null, stdout: string, stderr: string) => void,
  ): unknown;

  export function spawnSync(
    command: string,
    args: readonly string[],
    options: { cwd: string; encoding: 'utf8'; env: Record<string, string>; timeout: number },
  ): SpawnSyncResult;
}

declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
}

declare module 'node:fs/promises' {
  export function readFile(path: string): Promise<Uint8Array>;
  export function readFile(path: string, encoding: 'utf8'): Promise<string>;
  export function stat(path: string): Promise<{ size: number }>;
  export function writeFile(path: string, data: string): Promise<void>;
}

declare module 'node:path' {
  export function join(...parts: string[]): string;
  export function resolve(...parts: string[]): string;
  export function dirname(path: string): string;
}

declare module 'node:url' {
  export function fileURLToPath(url: string | URL): string;
}

declare module 'node:util' {
  /**
   * The `execFile` specialisation first, because that is the one call site and
   * the generic signature would hand it back `Promise<unknown>`. Everything else
   * promisified gets the ordinary shape.
   */
  export function promisify(
    fn: (
      command: string,
      args: readonly string[],
      options: { maxBuffer?: number },
      callback: (error: Error | null, stdout: string, stderr: string) => void,
    ) => unknown,
  ): (
    command: string,
    args: readonly string[],
    options: { maxBuffer?: number },
  ) => Promise<{ stdout: string; stderr: string }>;
  export function promisify<TArgs extends unknown[], TResult>(
    fn: (...args: TArgs) => TResult,
  ): (...args: TArgs) => Promise<Awaited<TResult>>;
}
