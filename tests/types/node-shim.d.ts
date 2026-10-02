/**
 * The sliver of the Node type surface this repository's tests use, declared
 * rather than installed.
 *
 * `@types/node` is not a pre-approved dependency and the browser application
 * has no legitimate use for it — see the same trade in
 * `tests/setup/functional.ts`. Three things need something Node-specific: the
 * functional setup reads `process.env`, `tests/unit/functional-suite-guard`
 * spawns the `test:func` runner to prove it fails loudly instead of skipping,
 * and `tests/unit/styles/designTokens` reads the real stylesheet off disk so it
 * compiles what the app ships rather than a copy of it.
 *
 * This file must stay a *script* (no top-level `import`/`export`): an ambient
 * `declare module` inside a module file is an augmentation, and augmenting a
 * module that does not exist is an error.
 *
 * If `@types/node` is ever approved, delete this file and delete the local
 * declarations with it.
 */

declare const process: {
  readonly env: Record<string, string | undefined>;
  readonly execPath: string;
  cwd(): string;
};

declare module 'node:child_process' {
  export interface SpawnSyncResult {
    /** The exit code, or `null` when the child was killed by a signal. */
    status: number | null;
    stdout: string;
    stderr: string;
  }

  export function spawnSync(
    command: string,
    args: readonly string[],
    options: { cwd: string; encoding: 'utf8'; env: Record<string, string>; timeout: number },
  ): SpawnSyncResult;
}

declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
}

declare module 'node:path' {
  export function join(...parts: string[]): string;
}
