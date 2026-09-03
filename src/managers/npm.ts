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
    let updatedCount = 0;

    // Step 1: Attempt global update with legacy-peer-deps to bypass ERESOLVE conflicts
    const updateStep = await this.executeStep(
      'npm update -g --legacy-peer-deps',
      'npm',
      ['update', '-g', '--legacy-peer-deps'],
      options
    );
    steps.push(updateStep);

    if (updateStep.status === 'success') {
      updatedCount = items.length;
      // Upgrade major versions if any
      const majorUpgrades = items.filter(
        (item) => item.latestVersion && item.latestVersion !== item.currentVersion
      );
      if (majorUpgrades.length > 0) {
        const pkgsToUpgrade = majorUpgrades.map((item) => `${item.name}@latest`);
        const installStep = await this.executeStep(
          `npm install -g ${pkgsToUpgrade.length} package(s)`,
          'npm',
          ['install', '-g', '--legacy-peer-deps', ...pkgsToUpgrade],
          options
        );
        steps.push(installStep);
      }
    } else {
      // Step 2 Fallback: If monolithic npm update -g failed (e.g. peer conflicts or custom install hooks in 1 package),
      // update packages individually so one bad package doesn't break the others!
      options.onStepProgress?.(
        'npm update',
        'Batch update hit peer conflicts; falling back to resilient individual package updates...'
      );

      for (const item of items) {
        const pkgTarget = item.latestVersion ? `${item.name}@${item.latestVersion}` : `${item.name}@latest`;
        const itemStep = await this.executeStep(
          `npm install -g ${item.name}`,
          'npm',
          ['install', '-g', '--legacy-peer-deps', pkgTarget],
          options
        );
        steps.push(itemStep);
        if (itemStep.status === 'success') {
          updatedCount++;
        }
      }
    }

    const failedSteps = steps.filter((s) => s.status === 'failed');
    const success = failedSteps.length === 0;

    return {
      managerId: this.id,
      managerName: this.name,
      icon: this.icon,
      success,
      updatedCount,
      durationMs: Date.now() - startTime,
      steps,
      error: failedSteps.length > 0
        ? `${failedSteps.length} step(s) encountered issues: ${failedSteps[0].error?.split('\n')[0]}`
        : undefined,
    };
  }
}
