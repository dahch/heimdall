import { commandExists, safeExec, type SafeExecOptions } from '../utils/exec.js';
import { extractErrorMessage } from '../utils/formatting.js';
import type {
  PackageManager,
  ManagerCategory,
  CheckOptions,
  CheckResult,
  UpdateItem,
  ExecutionOptions,
  UpdateExecutionResult,
  UpdateStep,
} from '../types.js';

export abstract class BasePackageManager implements PackageManager {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly icon: string;
  abstract readonly category: ManagerCategory;
  protected abstract readonly binary: string;

  async isAvailable(): Promise<boolean> {
    return commandExists(this.binary);
  }

  abstract checkUpdates(options?: CheckOptions): Promise<CheckResult>;

  abstract executeUpdate(
    items: UpdateItem[],
    options: ExecutionOptions
  ): Promise<UpdateExecutionResult>;

  protected async executeStep(
    stepName: string,
    file: string,
    args: string[],
    options: ExecutionOptions,
    extraExecOptions?: SafeExecOptions
  ): Promise<UpdateStep> {
    const startTime = Date.now();
    options.onStepStart?.(stepName);

    if (options.dryRun) {
      options.onStepProgress?.(stepName, `[DRY-RUN] Would run: ${file} ${args.join(' ')}`);
      options.onStepEnd?.(stepName, true);
      return {
        name: stepName,
        command: `${file} ${args.join(' ')}`,
        status: 'success',
        durationMs: 0,
      };
    }

    const result = await safeExec(file, args, {
      ...extraExecOptions,
      timeoutMs: options.timeoutMs ?? 180000, // 3 min per step
      onData: (data) => {
        if (options.onStepProgress) {
          const lines = data.split('\n').map((l) => l.trim()).filter(Boolean);
          if (lines.length > 0) {
            options.onStepProgress(stepName, lines[lines.length - 1]);
          }
        }
      },
    });

    const durationMs = Date.now() - startTime;
    const success = result.success;
    const rawOutput = (result.stderr || result.stdout || '').trim();
    const errorMsg = !success
      ? (result.timedOut
          ? `Step timed out after ${Math.round((options.timeoutMs ?? 180000) / 1000)}s`
          : extractErrorMessage(rawOutput))
      : undefined;

    options.onStepEnd?.(stepName, success, errorMsg, durationMs);

    return {
      name: stepName,
      command: `${file} ${args.join(' ')}`,
      status: success ? 'success' : 'failed',
      durationMs,
      error: errorMsg,
    };
  }
}
