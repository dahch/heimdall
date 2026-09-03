import { BasePackageManager } from './base.js';
import { commandExists, safeExec } from '../utils/exec.js';
import type {
  ManagerCategory,
  CheckOptions,
  CheckResult,
  UpdateItem,
  ExecutionOptions,
  UpdateExecutionResult,
  UpdateStep,
} from '../types.js';

interface PipOutdatedItem {
  name: string;
  version: string;
  latest_version: string;
}

export class PythonPipManager extends BasePackageManager {
  readonly id = 'pip';
  readonly name = 'Python (pip user)';
  readonly icon = '🐍';
  readonly category: ManagerCategory = 'language';
  protected readonly binary = 'pip3';

  private activeBinary = 'pip3';

  async isAvailable(): Promise<boolean> {
    if (await commandExists('pip3')) {
      this.activeBinary = 'pip3';
      return true;
    }
    if (await commandExists('pip')) {
      this.activeBinary = 'pip';
      return true;
    }
    return false;
  }

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
      // Query user packages for fast response and PEP 668 safety
      const execRes = await safeExec(
        this.activeBinary,
        ['list', '--user', '--outdated', '--format=json'],
        { timeoutMs: options?.timeoutMs ?? 15000 }
      );

      const updates: UpdateItem[] = [];
      const stdout = execRes.stdout.trim();

      if (stdout.startsWith('[')) {
        try {
          const parsed = JSON.parse(stdout) as PipOutdatedItem[];
          for (const item of parsed) {
            updates.push({
              managerId: this.id,
              managerName: this.name,
              name: item.name,
              currentVersion: item.version ?? 'unknown',
              latestVersion: item.latest_version ?? 'latest',
              type: 'pip-user',
            });
          }
        } catch {
          // ignore parse error
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

    if (items.length > 0) {
      const packageNames = items.map((i) => i.name);
      const step = await this.executeStep(
        `${this.activeBinary} install --user --upgrade (${items.length} pkgs)`,
        this.activeBinary,
        ['install', '--user', '--upgrade', ...packageNames],
        options
      );
      steps.push(step);
    }

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
