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

export class YarnManager extends BasePackageManager {
  readonly id = 'yarn';
  readonly name = 'Yarn (global)';
  readonly icon = '🧶';
  readonly category: ManagerCategory = 'runtime';
  protected readonly binary = 'yarn';

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
      // List global packages
      const execRes = await safeExec('yarn', ['global', 'list', '--depth=0'], {
        timeoutMs: options?.timeoutMs ?? 15000,
      });

      const updates: UpdateItem[] = [];
      const lines = execRes.stdout.split('\n');
      const installed: { name: string; currentVersion: string }[] = [];

      for (const line of lines) {
        const match = line.match(/info\s+"([^@]+)@([^"]+)"/);
        if (match) {
          installed.push({ name: match[1], currentVersion: match[2] });
        }
      }

      // Check registry version for installed global packages
      await Promise.all(
        installed.map(async ({ name, currentVersion }) => {
          try {
            const viewRes = await safeExec('npm', ['view', name, 'version'], {
              timeoutMs: 4000,
            });
            const latest = viewRes.stdout.trim();
            if (latest && latest !== currentVersion) {
              updates.push({
                managerId: this.id,
                managerName: this.name,
                name,
                currentVersion,
                latestVersion: latest,
                type: 'global-pkg',
              });
            }
          } catch {
            // ignore check failure
          }
        })
      );

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

    // Step 1: Explicitly add latest for packages with major or pinned updates
    if (items.length > 0) {
      const pkgsToUpgrade = items.map((item) =>
        item.latestVersion && item.latestVersion !== 'latest' && item.latestVersion !== 'unknown'
          ? `${item.name}@${item.latestVersion}`
          : `${item.name}@latest`
      );

      const addStep = await this.executeStep(
        `yarn global add ${pkgsToUpgrade.length} package(s)`,
        'yarn',
        ['global', 'add', ...pkgsToUpgrade],
        options
      );
      steps.push(addStep);
    }

    // Step 2: yarn global upgrade (for transitive/sub dependencies)
    const upgradeStep = await this.executeStep(
      'yarn global upgrade',
      'yarn',
      ['global', 'upgrade'],
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
