import { execa } from 'execa';

export interface SafeExecOptions {
  timeoutMs?: number;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  onData?: (chunk: string) => void;
  stdin?: 'inherit' | 'pipe' | 'ignore';
}

export interface SafeExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  success: boolean;
  timedOut: boolean;
  error?: Error;
}

/**
 * Checks whether an executable command exists in PATH.
 * Resilient: never throws, returns boolean.
 */
export async function commandExists(command: string): Promise<boolean> {
  try {
    const result = await execa('which', [command], {
      reject: false,
      timeout: 3000,
    });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Runs a command safely with timeout and optional output streaming.
 * Catches all rejections so callers don't need boilerplate try/catch.
 */
export async function safeExec(
  file: string,
  args: string[] = [],
  options: SafeExecOptions = {}
): Promise<SafeExecResult> {
  const timeout = options.timeoutMs ?? 30000;

  try {
    const subprocess = execa(file, args, {
      timeout,
      cwd: options.cwd,
      env: {
        ...process.env,
        ...options.env,
        // Suppress interactive prompts in subcommands
        CI: 'true',
        DEBIAN_FRONTEND: 'noninteractive',
      },
      reject: false,
      stdin: options.stdin ?? 'ignore',
    });

    if (options.onData && subprocess.stdout) {
      subprocess.stdout.on('data', (data: Buffer | string) => {
        options.onData?.(data.toString());
      });
    }

    if (options.onData && subprocess.stderr) {
      subprocess.stderr.on('data', (data: Buffer | string) => {
        options.onData?.(data.toString());
      });
    }

    const result = await subprocess;

    return {
      stdout: (result.stdout ?? '').toString(),
      stderr: (result.stderr ?? '').toString(),
      exitCode: result.exitCode ?? 0,
      success: result.exitCode === 0,
      timedOut: result.timedOut ?? false,
    };
  } catch (err: unknown) {
    const error = err instanceof Error ? err : new Error(String(err));
    const isTimeout = error.name === 'TimeoutError' || error.message.includes('timed out');
    return {
      stdout: '',
      stderr: error.message,
      exitCode: -1,
      success: false,
      timedOut: isTimeout,
      error,
    };
  }
}
