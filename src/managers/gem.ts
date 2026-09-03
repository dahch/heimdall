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

export class RubyGemManager extends BasePackageManager {
  readonly id = 'gem';
  readonly name = 'Ruby Gem';
  readonly icon = '💎';
  readonly category: ManagerCategory = 'language';
  protected readonly binary = 'gem';

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
      const execRes = await safeExec('gem', ['outdated'], {
        timeoutMs: options?.timeoutMs ?? 20000,
      });

      const updates: UpdateItem[] = [];
      const lines = execRes.stdout.split('\n');

      for (const line of lines) {
        const trimmed = line.trim();
        // Format: name (current < latest)
        const match = trimmed.match(/^(\S+)\s*\(([^<]+)<\s*([^)]+)\)/);
        if (match) {
          const [, name, current, latest] = match;
          updates.push({
            managerId: this.id,
            managerName: this.name,
            name: name.trim(),
            currentVersion: current.trim(),
            latestVersion: latest.trim(),
            type: 'gem',
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

    // Step 1: gem update --user-install
    const updateStep = await this.executeStep(
      'gem update --user-install',
      'gem',
      ['update', '--user-install'],
      options
    );
    steps.push(updateStep);

    // Step 2: gem cleanup
    const cleanupStep = await this.executeStep(
      'gem cleanup --user-install',
      'gem',
      ['cleanup', '--user-install'],
      options
    );
    steps.push(cleanupStep);

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
