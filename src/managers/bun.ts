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

export class BunManager extends BasePackageManager {
  readonly id = 'bun';
  readonly name = 'Bun';
  readonly icon = '🍞';
  readonly category: ManagerCategory = 'runtime';
  protected readonly binary = 'bun';

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
      const execRes = await safeExec('bun', ['outdated', '-g'], {
        timeoutMs: options?.timeoutMs ?? 25000,
      });

      const updates: UpdateItem[] = [];
      const lines = execRes.stdout.split('\n');

      for (const line of lines) {
        const trimmed = line.trim();
        // Ignore table borders and header
        if (!trimmed.startsWith('|') || trimmed.includes('---') || trimmed.includes('Package')) {
          continue;
        }

        const cols = trimmed
          .split('|')
          .map((c) => c.trim())
          .filter(Boolean);

        // Expect: [Package, Current, Update, Latest]
        if (cols.length >= 3) {
          const pkgName = cols[0];
          const current = cols[1];
          const latest = cols[cols.length - 1]; // last column is Latest

          if (pkgName && current && latest) {
            updates.push({
              managerId: this.id,
              managerName: this.name,
              name: pkgName,
              currentVersion: current,
              latestVersion: latest,
              type: 'global-pkg',
            });
          }
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

    // Step 1: Explicitly install latest versions for outdated packages.
    // This is crucial: bun update -g respects semver pins in ~/.bun/install/global/package.json
    // and refuses to upgrade across major versions (e.g. 17.x -> 18.x) without bun add -g.
    if (items.length > 0) {
      const pkgsToUpgrade = items.map((item) =>
        item.latestVersion && item.latestVersion !== 'latest' && item.latestVersion !== 'unknown'
          ? `${item.name}@${item.latestVersion}`
          : `${item.name}@latest`
      );

      const addStep = await this.executeStep(
        `bun add -g ${pkgsToUpgrade.length} package(s)`,
        'bun',
        ['add', '-g', ...pkgsToUpgrade],
        options
      );
      steps.push(addStep);
    }

    // Step 2: bun update -g (for any other dependencies)
    const updateStep = await this.executeStep(
      'bun update -g',
      'bun',
      ['update', '-g'],
      options
    );
    steps.push(updateStep);

    // Step 3: bun upgrade (only if not installed/managed via Homebrew)
    const whichBun = await safeExec('which', ['bun'], { timeoutMs: 3000 });
    const isBrewBun = whichBun.stdout.includes('/opt/homebrew') || whichBun.stdout.includes('/Cellar');
    if (!isBrewBun) {
      const upgradeStep = await this.executeStep(
        'bun upgrade',
        'bun',
        ['upgrade'],
        options
      );
      if (upgradeStep.status === 'failed' && upgradeStep.error?.includes('Homebrew')) {
        upgradeStep.status = 'skipped';
      }
      steps.push(upgradeStep);
    }

    const hasFailedStep = steps.some((s) => s.status === 'failed');
    const success = !hasFailedStep;

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
