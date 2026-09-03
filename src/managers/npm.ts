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

interface NpmOutdatedEntry {
  current?: string;
  wanted?: string;
  latest?: string;
  location?: string;
}

export class NpmManager extends BasePackageManager {
  readonly id = 'npm';
  readonly name = 'npm (global)';
  readonly icon = '📦';
  readonly category: ManagerCategory = 'runtime';
  protected readonly binary = 'npm';

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
      // Note: npm outdated exits with code 1 if packages are outdated
      const execRes = await safeExec('npm', ['outdated', '-g', '--json'], {
        timeoutMs: options?.timeoutMs ?? 25000,
      });

      const updates: UpdateItem[] = [];
      const stdout = execRes.stdout.trim();

      if (stdout.startsWith('{')) {
        const parsed = JSON.parse(stdout) as Record<string, NpmOutdatedEntry>;
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

    // Step: npm update -g
    const updateStep = await this.executeStep(
      'npm update -g',
      'npm',
      ['update', '-g'],
      options
    );
    steps.push(updateStep);

    // If there were packages where latest > wanted (e.g. major version bumps),
    // npm update -g might leave them untouched. Let's upgrade them explicitly if needed.
    const majorUpgrades = items.filter(
      (item) => item.latestVersion && item.latestVersion !== item.currentVersion
    );

    if (updateStep.status === 'success' && majorUpgrades.length > 0) {
      const pkgsToUpgrade = majorUpgrades.map((item) => `${item.name}@latest`);
      const installStep = await this.executeStep(
        `npm install -g ${pkgsToUpgrade.length} package(s)`,
        'npm',
        ['install', '-g', ...pkgsToUpgrade],
        options
      );
      steps.push(installStep);
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
