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

export class MacAppStoreManager extends BasePackageManager {
  readonly id = 'mas';
  readonly name = 'Mac App Store';
  readonly icon = '🍎';
  readonly category: ManagerCategory = 'appstore';
  protected readonly binary = 'mas';

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
      const execRes = await safeExec('mas', ['outdated'], {
        timeoutMs: options?.timeoutMs ?? 20000,
      });

      const updates: UpdateItem[] = [];
      const lines = execRes.stdout.split('\n');

      for (const line of lines) {
        const trimmed = line.trim();
        // Format: 1234567890 App Name (1.0.0 -> 1.1.0)
        const match = trimmed.match(/^\s*(\d+)\s+(.+?)\s*\(([^->]+)->\s*([^)]+)\)/);
        if (match) {
          const [, id, appName, current, latest] = match;
          updates.push({
            managerId: this.id,
            managerName: this.name,
            name: `${appName.trim()} [${id}]`,
            currentVersion: current.trim(),
            latestVersion: latest.trim(),
            type: 'mas-app',
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

    // Step 1: mas upgrade
    const upgradeStep = await this.executeStep(
      'mas upgrade',
      'mas',
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
      updatedCount: success ? items.length : 0,
      durationMs: Date.now() - startTime,
      steps,
      error: !success ? steps.find((s) => s.status === 'failed')?.error : undefined,
    };
  }
}
