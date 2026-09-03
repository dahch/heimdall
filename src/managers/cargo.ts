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

export class CargoManager extends BasePackageManager {
  readonly id = 'cargo';
  readonly name = 'Rust (Cargo & Rustup)';
  readonly icon = '🦀';
  readonly category: ManagerCategory = 'language';
  protected readonly binary = 'cargo';

  async isAvailable(): Promise<boolean> {
    return (await commandExists('cargo')) || (await commandExists('rustup'));
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
      const updates: UpdateItem[] = [];

      // Check rustup toolchains
      if (await commandExists('rustup')) {
        const checkRes = await safeExec('rustup', ['check'], {
          timeoutMs: options?.timeoutMs ?? 15000,
        });

        const lines = checkRes.stdout.split('\n');
        for (const line of lines) {
          if (line.includes('Update available')) {
            const parts = line.trim().split(/\s+/);
            const toolchain = parts[0] ?? 'toolchain';
            updates.push({
              managerId: this.id,
              managerName: this.name,
              name: `rustup (${toolchain})`,
              currentVersion: 'installed',
              latestVersion: 'update-available',
              type: 'toolchain',
            });
          }
        }
      }

      // Check cargo install-update if cargo-update is installed
      if (await commandExists('cargo-install-update')) {
        const listRes = await safeExec('cargo', ['install-update', '-l'], {
          timeoutMs: options?.timeoutMs ?? 15000,
        });
        const lines = listRes.stdout.split('\n');
        for (const line of lines) {
          const match = line.match(/^(\S+)\s+v(\S+)\s+v(\S+)/);
          if (match) {
            const [, name, cur, latest] = match;
            if (cur !== latest) {
              updates.push({
                managerId: this.id,
                managerName: this.name,
                name,
                currentVersion: cur,
                latestVersion: latest,
                type: 'crate',
              });
            }
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

    // Step 1: rustup update
    if (await commandExists('rustup')) {
      const rustupStep = await this.executeStep(
        'rustup update',
        'rustup',
        ['update'],
        options
      );
      steps.push(rustupStep);
    }

    // Step 2: cargo install-update -a (if installed)
    if (await commandExists('cargo-install-update')) {
      const cargoStep = await this.executeStep(
        'cargo install-update -a',
        'cargo',
        ['install-update', '-a'],
        options
      );
      steps.push(cargoStep);
    }

    const hasFailedStep = steps.some((s) => s.status === 'failed');
    const success = !hasFailedStep;

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
