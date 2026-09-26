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

export class AptManager extends BasePackageManager {
  readonly id = 'apt';
  readonly name = 'APT (Debian/Ubuntu)';
  readonly icon = '🐧';
  readonly category: ManagerCategory = 'system';
  protected readonly binary = 'apt-get';

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
      const execRes = await safeExec('apt', ['list', '--upgradable'], {
        timeoutMs: options?.timeoutMs ?? 20000,
      });

      const updates: UpdateItem[] = [];
      const lines = execRes.stdout.split('\n');

      for (const line of lines) {
        if (!line.includes('/') || line.startsWith('Listing')) continue;
        const match = line.match(/^([^\/\s]+)\/\S+\s+(\S+)\s+\S+\s+\[upgradable from:\s+(\S+)\]/);
        if (match) {
          const [, name, latest, current] = match;
          updates.push({
            managerId: this.id,
            managerName: this.name,
            name,
            currentVersion: current,
            latestVersion: latest,
            type: 'deb',
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

    // Check sudo privileges beforehand to avoid hanging on password prompts
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
              error: 'APT requires sudo privileges. Run "sudo -v" in your terminal before hmd.',
            },
          ],
          error: 'APT requires sudo privileges. Run "sudo -v" before running hmd.',
        };
      }
    }

    // Step 1: sudo apt-get update
    const updateStep = await this.executeStep(
      'sudo apt-get update',
      'sudo',
      ['apt-get', 'update', '-y'],
      options
    );
    steps.push(updateStep);

    // Step 2: sudo apt-get upgrade
    const upgradeStep = await this.executeStep(
      'sudo apt-get upgrade',
      'sudo',
      ['apt-get', 'upgrade', '-y'],
      options
    );
    steps.push(upgradeStep);

    // Step 3: sudo apt-get autoremove
    const cleanupStep = await this.executeStep(
      'sudo apt-get autoremove',
      'sudo',
      ['apt-get', 'autoremove', '-y'],
      options
    );
    steps.push(cleanupStep);

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

export class FlatpakManager extends BasePackageManager {
  readonly id = 'flatpak';
  readonly name = 'Flatpak';
  readonly icon = '📦';
  readonly category: ManagerCategory = 'system';
  protected readonly binary = 'flatpak';

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
      const execRes = await safeExec('flatpak', ['remote-ls', '--updates'], {
        timeoutMs: options?.timeoutMs ?? 20000,
      });

      const updates: UpdateItem[] = [];
      const lines = execRes.stdout.split('\n');

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const parts = trimmed.split(/\s+/);
        updates.push({
          managerId: this.id,
          managerName: this.name,
          name: parts[0],
          currentVersion: 'installed',
          latestVersion: parts[1] ?? 'latest',
          type: 'flatpak',
        });
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

    const updateStep = await this.executeStep(
      'flatpak update -y',
      'flatpak',
      ['update', '-y', '--noninteractive'],
      options
    );
    steps.push(updateStep);

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
