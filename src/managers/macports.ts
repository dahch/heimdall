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

export class MacPortsManager extends BasePackageManager {
  readonly id = 'macports';
  readonly name = 'MacPorts';
  readonly icon = '⚓';
  readonly category: ManagerCategory = 'system';
  protected readonly binary = 'port';

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
      const execRes = await safeExec('port', ['outdated'], {
        timeoutMs: options?.timeoutMs ?? 20000,
      });

      const updates: UpdateItem[] = [];
      const lines = execRes.stdout.split('\n');

      for (const line of lines) {
        const trimmed = line.trim();
        // Skip header lines like "The following installed ports are outdated:"
        if (!trimmed || trimmed.startsWith('The following') || trimmed.startsWith('--')) {
          continue;
        }

        // Example line: "curl       8.0.1_1 < 8.1.0"
        const match = trimmed.match(/^(\S+)\s+(\S+)\s*<\s*(\S+)/);
        if (match) {
          const [, name, current, latest] = match;
          updates.push({
            managerId: this.id,
            managerName: this.name,
            name,
            currentVersion: current,
            latestVersion: latest,
            type: 'port',
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

    // Check sudo privileges beforehand to avoid hanging 3 minutes on password prompts
    if (!options.dryRun && process.getuid?.() !== 0) {
      const sudoCheck = await safeExec('sudo', ['-n', 'true'], { timeoutMs: 3000 });
      if (!sudoCheck.success) {
        return {
          managerId: this.id,
          managerName: this.name,
          icon: this.icon,
          success: false,
          updatedCount: 0,
          durationMs: Date.now() - startTime,
          steps: [
            {
              name: 'sudo privileges',
              command: 'sudo -n true',
              status: 'failed',
              error: 'MacPorts requires sudo privileges. Run "sudo -v" in your terminal before hmd.',
            },
          ],
          error: 'MacPorts requires sudo privileges. Run "sudo -v" before running hmd.',
        };
      }
    }

    // Step 1: sudo port selfupdate
    const selfupdateStep = await this.executeStep(
      'sudo port selfupdate',
      'sudo',
      ['port', 'selfupdate'],
      options
    );
    steps.push(selfupdateStep);

    // Step 2: sudo port upgrade outdated
    const upgradeStep = await this.executeStep(
      'sudo port upgrade outdated',
      'sudo',
      ['port', 'upgrade', 'outdated'],
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
