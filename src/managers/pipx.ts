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

interface PipxApp {
  package_version?: string;
}

interface PipxListJson {
  venvs?: Record<string, { metadata?: { main_package?: PipxApp } }>;
}

export class PipxManager extends BasePackageManager {
  readonly id = 'pipx';
  readonly name = 'pipx (Python CLI tools)';
  readonly icon = '📦';
  readonly category: ManagerCategory = 'language';
  protected readonly binary = 'pipx';

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
      const execRes = await safeExec('pipx', ['list', '--json'], {
        timeoutMs: options?.timeoutMs ?? 15000,
      });

      const updates: UpdateItem[] = [];
      const stdout = execRes.stdout.trim();

      if (stdout.startsWith('{')) {
        try {
          const parsed = JSON.parse(stdout) as PipxListJson;
          if (parsed.venvs) {
            for (const [pkgName, venvData] of Object.entries(parsed.venvs)) {
              const current = venvData.metadata?.main_package?.package_version ?? 'unknown';
              updates.push({
                managerId: this.id,
                managerName: this.name,
                name: pkgName,
                currentVersion: current,
                latestVersion: 'latest',
                type: 'pipx-app',
              });
            }
          }
        } catch {
          // ignore parsing error
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

    // Step 1: pipx upgrade-all
    const upgradeStep = await this.executeStep(
      'pipx upgrade-all',
      'pipx',
      ['upgrade-all'],
      options
    );
    steps.push(upgradeStep);

    const success = steps.every((s) => s.status === 'success');

    return {
      managerId: this.id,
      managerName: this.name,
      icon: this.icon,
      success,
      updatedCount: items.length,
      durationMs: Date.now() - startTime,
      steps,
      error: !success ? steps.find((s) => s.status === 'failed')?.error : undefined,
    };
  }
}
