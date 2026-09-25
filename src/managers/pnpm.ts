import { BasePackageManager } from './base.js';
import { safeExec } from '../utils/exec.js';
import type {
  ManagerCategory,
  CheckOptions,
  CheckResult,
  UpdateItem,
  ExecutionOptions,
  UpdateExecutionResult,
  UpdateStep,
} from '../types.js';

interface PnpmOutdatedItem {
  current?: string;
  latest?: string;
  wanted?: string;
}

export class PnpmManager extends BasePackageManager {
  readonly id = 'pnpm';
  readonly name = 'pnpm (global)';
  readonly icon = '⚡';
  readonly category: ManagerCategory = 'runtime';
  protected readonly binary = 'pnpm';

  async checkUpdates(options?: CheckOptions): Promise<CheckResult> {
    const startTime = Date.now();
    const isAvail = await this.isAvailable();
    if (!isAvail) {
      return {
        managerId: this.id,
        managerName: this.name,
        icon: this.icon,
        category: this.category,
        available: false,
        updates: [],
        durationMs: 0,
      };
    }

    try {
      const execRes = await safeExec('pnpm', ['outdated', '-g', '--format', 'json'], {
        timeoutMs: options?.timeoutMs ?? 25000,
      });

      const updates: UpdateItem[] = [];
      const stdout = execRes.stdout.trim();

      // Extract JSON portion if mixed with CLI table output
      const jsonStart = stdout.indexOf('{');
      const jsonEnd = stdout.lastIndexOf('}');

      if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
        const jsonStr = stdout.slice(jsonStart, jsonEnd + 1);
        try {
          const parsed = JSON.parse(jsonStr) as Record<string, PnpmOutdatedItem>;
          for (const [name, info] of Object.entries(parsed)) {
            updates.push({
              managerId: this.id,
              managerName: this.name,
              name,
              currentVersion: info.current ?? 'unknown',
              latestVersion: info.latest ?? info.wanted ?? 'latest',
              type: 'global-pkg',
            });
          }
        } catch {
          // ignore parsing error, proceed
        }
      }

      return {
        managerId: this.id,
        managerName: this.name,
        icon: this.icon,
        category: this.category,
        available: true,
        updates,
        durationMs: Date.now() - startTime,
      };
    } catch (err) {
      return {
        managerId: this.id,
        managerName: this.name,
        icon: this.icon,
        category: this.category,
        available: true,
        updates: [],
        durationMs: Date.now() - startTime,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async executeUpdate(
    items: UpdateItem[],
    options: ExecutionOptions
  ): Promise<UpdateExecutionResult> {
    const startTime = Date.now();
    const steps: UpdateStep[] = [];

    // Step 1: pnpm update -g --latest
    const updateStep = await this.executeStep(
      'pnpm update -g --latest',
      'pnpm',
      ['update', '-g', '--latest'],
      options
    );
    steps.push(updateStep);

    const success = steps.every((s) => s.status === 'success');

    return {
      managerId: this.id,
      managerName: this.name,
      icon: this.icon,
      success,
      updatedCount: success ? items.length : 0,
      durationMs: Date.now() - startTime,
      steps,
      error: !success ? steps.find((s) => s.status === 'failed')?.error : undefined,
    };
  }
}
