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

    // Step 1: bun update -g
    const updateStep = await this.executeStep(
      'bun update -g',
      'bun',
      ['update', '-g'],
      options
    );
    steps.push(updateStep);

    // Step 2: bun upgrade (upgrades bun itself if available)
    const upgradeStep = await this.executeStep(
      'bun upgrade',
      'bun',
      ['upgrade'],
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
