/**
 * Thin wrapper around `limactl` for everything psbx needs:
 * start/clone/stop/delete/shell, cloud-init status probing, JSON listing,
 * version, and direct manipulation of the per-instance `lima.yaml` on disk.
 *
 * Centralizes process spawning so all `limactl` invocations share consistent
 * error handling (`LimaError` with command / exitCode / stderr / stdout
 * context) and a clear distinction between inherit-mode (interactive) and
 * capture-mode (parsed output) calls.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { GUEST_WORKDIR } from './template.ts';
import type { LimaInstance } from './types.ts';
import { shellQuote } from './utils.ts';

interface LimaErrorOptions {
  command?: string;
  exitCode?: number | null;
  stderr?: string | null;
  stdout?: string | null;
}

interface RunLimactlOptions {
  mode?: 'inherit' | 'capture';
  env?: Record<string, string | undefined>;
}

interface LimaShellOptions {
  shellEnvAllowlist?: string[];
  command?: string[];
}

interface LimaStopOptions {
  force?: boolean;
}

interface LimaShellScriptOptions {
  asRoot?: boolean;
}

function stringFromUnknown(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  if (value === undefined || value === null) {
    return undefined;
  }
  return String(value);
}

function stringArrayFromUnknown(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && Boolean(item))
    : [];
}

class LimaError extends Error {
  declare command?: string;
  declare exitCode?: number | null;
  declare stderr?: string | null;
  declare stdout?: string | null;

  constructor(message: string, { command, exitCode, stderr, stdout }: LimaErrorOptions = {}) {
    super(message);
    this.name = 'LimaError';
    this.command = command;
    this.exitCode = exitCode;
    this.stderr = stderr;
    this.stdout = stdout;
  }
}

function runLimactl(
  args: string[],
  { mode = 'inherit', env }: RunLimactlOptions = {},
): string | null {
  const command = `limactl ${args.join(' ')}`;
  const options = {
    encoding: 'utf-8' as const,
    env: env ? { ...process.env, ...env } : undefined,
  };

  if (mode === 'inherit') {
    Object.assign(options, { stdio: 'inherit' as const });
  }

  try {
    if (mode === 'inherit') {
      execFileSync('limactl', args, options);
      return null;
    }

    const result = spawnSync('limactl', args, options);
    if (result.error) {
      throw result.error;
    }
    if (result.status !== 0) {
      throw new LimaError(
        `limactl command failed: ${command}
${result.stderr || ''}`.trim(),
        {
          command,
          exitCode: result.status,
          stderr: result.stderr,
          stdout: result.stdout,
        },
      );
    }
    return result.stdout;
  } catch (err: unknown) {
    if (err instanceof LimaError) throw err;

    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
      throw new LimaError('limactl not found. Install Lima first: https://lima-vm.io', { command });
    }

    if (err instanceof Error && 'status' in err && err.status !== undefined) {
      const stderr = 'stderr' in err ? stringFromUnknown(err.stderr) : undefined;
      const stdout = 'stdout' in err ? stringFromUnknown(err.stdout) : undefined;
      throw new LimaError(
        `limactl command failed: ${command}
${stderr || err.message}`.trim(),
        {
          command,
          exitCode: typeof err.status === 'number' ? err.status : null,
          stderr,
          stdout,
        },
      );
    }

    throw err;
  }
}

function limaStart(name: string, yamlPath?: string, extraArgs: string[] = []): void {
  runLimactl(['start', '--tty=false', '--name', name, ...extraArgs, yamlPath as string]);
}

function limaClone(sourceName: string, targetName: string): void {
  runLimactl(['clone', '--tty=false', sourceName, targetName]);
}

function limaResume(name: string): void {
  runLimactl(['start', name]);
}

function limaCheckProvisioning(name: string): void {
  try {
    runLimactl(['shell', '--workdir=/', name, 'sudo', 'cloud-init', 'status', '--format', 'json'], {
      mode: 'capture',
    });
  } catch (err: unknown) {
    if (!(err instanceof LimaError)) throw err;

    if (err.exitCode === 2) return;

    let errorLines = '';
    try {
      const status = JSON.parse(err.stdout || '') as Record<string, unknown>;
      const errors = [
        ...stringArrayFromUnknown(status.errors),
        ...Object.values(status)
          .filter(
            (value): value is Record<string, unknown> =>
              value !== null &&
              typeof value === 'object' &&
              !Array.isArray(value) &&
              'errors' in value,
          )
          .flatMap((value) => stringArrayFromUnknown(value.errors)),
      ].filter((error, index, allErrors) => allErrors.indexOf(error) === index);

      const realErrors = errors.filter(
        (error) => !(error.includes('scripts_per_boot') && error.includes('00-lima.boot.sh')),
      );
      if (realErrors.length === 0) return;

      if (realErrors.length > 0) {
        errorLines = `\n  ${realErrors.join('\n  ')}`;
      }
    } catch {}

    throw new LimaError(
      `Provisioning failed for sandbox '${name}'.${errorLines}\nRun 'psbx logs' to see what went wrong.`,
      { command: err.command, exitCode: err.exitCode, stderr: err.stderr },
    );
  }
}

function limaStop(name: string, { force = false }: LimaStopOptions = {}): void {
  const args = ['stop'];
  if (force) args.push('--force');
  args.push(name);
  runLimactl(args);
}

function limaDelete(name: string): void {
  runLimactl(['delete', name]);
}

function limaShell(
  name: string,
  { shellEnvAllowlist = [], command = [] }: LimaShellOptions = {},
): void {
  const shellCommand =
    command.length > 0 ? ['bash', '-i', '-c', shellQuote(command.join(' '))] : [];

  const args = ['shell', '--preserve-env', `--workdir=${GUEST_WORKDIR}`, name, ...shellCommand];
  const result = spawnSync('limactl', args, {
    stdio: 'inherit',
    env: {
      ...process.env,
      LIMA_SHELLENV_BLOCK: '*',
      LIMA_SHELLENV_ALLOW: shellEnvAllowlist.join(','),
    },
  });

  if (result.error) {
    const error = result.error;
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      throw new LimaError('limactl not found. Install Lima first: https://lima-vm.io', {
        command: 'limactl shell',
      });
    }
    throw error;
  }
}

function limaStatus(name: string): string | null {
  try {
    const output = runLimactl(['ls', '-f', '{{.Status}}', name], { mode: 'capture' });
    const status = output?.trim();
    return status || null;
  } catch (err: unknown) {
    if (err instanceof LimaError && err.message.includes('not found. Install')) {
      throw err;
    }
    if (err instanceof LimaError) {
      return null;
    }
    throw err;
  }
}

function limaList(): LimaInstance[] {
  const output = runLimactl(['ls', '--json'], { mode: 'capture' }) || '';
  if (!output.trim()) {
    return [];
  }

  return output
    .trim()
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as LimaInstance);
}

function limaLogs(name: string): string {
  return (
    runLimactl(
      [
        'shell',
        '--workdir=/',
        name,
        'sudo',
        'sh',
        '-c',
        'cat /var/log/cloud-init-output.log 2>/dev/null || cat /var/log/cloud-init.log',
      ],
      { mode: 'capture' },
    ) || ''
  );
}

function limaGenerateJsonSchema(): string {
  return runLimactl(['generate-jsonschema'], { mode: 'capture' }) || '';
}

function limaVersion(): string {
  return (runLimactl(['--version'], { mode: 'capture' }) || '').trim();
}

function limaCopyFromVm(name: string, guestPath: string, hostPath: string): void {
  runLimactl(['copy', '-r', `${name}:${guestPath}`, hostPath]);
}

function limaShellScript(
  name: string,
  script: string,
  { asRoot = false }: LimaShellScriptOptions = {},
): void {
  const shellArgs = asRoot ? ['sudo', '/bin/sh', '-c', script] : ['/bin/sh', '-c', script];
  runLimactl(['shell', '--workdir=/', name, ...shellArgs], { mode: 'capture' });
}

function getLimaHome(): string {
  return process.env.LIMA_HOME || join(homedir(), '.lima');
}

function limaInstanceDir(name: string): string {
  return join(getLimaHome(), name);
}

function limaWriteInstanceYaml(name: string, yamlContent: string): void {
  writeFileSync(join(limaInstanceDir(name), 'lima.yaml'), yamlContent, 'utf-8');
}

function limaReadInstanceYaml(name: string): string {
  return readFileSync(join(limaInstanceDir(name), 'lima.yaml'), 'utf-8');
}

export {
  LimaError,
  limaCheckProvisioning,
  limaClone,
  limaCopyFromVm,
  limaDelete,
  limaGenerateJsonSchema,
  limaInstanceDir,
  limaList,
  limaLogs,
  limaReadInstanceYaml,
  limaResume,
  limaShell,
  limaShellScript,
  limaStart,
  limaStatus,
  limaStop,
  limaVersion,
  limaWriteInstanceYaml,
  shellQuote,
};
