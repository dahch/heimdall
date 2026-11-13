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

/**
 * Poetry self-manages its own installation (and the plugins added through
 * `poetry self add`), so Heimdall checks the installed core version against PyPI
 * and runs `poetry self update` instead of touching per-project dependencies.
 */
export class PoetryManager extends BasePackageManager {
  readonly id = 'poetry';
  readonly name = 'Poetry (self-managed)';
  readonly icon = '📜';
  readonly category: ManagerCategory = 'language';
  protected readonly binary = 'poetry';

  /** Parses `Poetry (version 1.8.5)` and older/newer banner variants. */
  private parseInstalledVersion(stdout: string): string | undefined {
    const match = stdout.match(/version\s+(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/i);
    return match?.[1];
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
      const execRes = await safeExec('poetry', ['--version'], {
        timeoutMs: options?.timeoutMs ?? 15000,
      });

      const updates: UpdateItem[] = [];
      const current = this.parseInstalledVersion(execRes.stdout);

      if (current) {
        try {
          const response = await fetch('https://pypi.org/pypi/poetry/json', {
            signal: AbortSignal.timeout(3000),
          });
          if (response.ok) {
            const data = (await response.json()) as { info?: { version?: string } };
            const latest = data.info?.version;
            if (latest && latest !== current) {
              updates.push({
                managerId: this.id,
                managerName: this.name,
                name: 'poetry',
                currentVersion: current,
                latestVersion: latest,
                type: 'poetry-self',
              });
            }
          }
        } catch {
          // Ignore network lookup timeouts/errors gracefully
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

    if (items.length > 0) {
      const step = await this.executeStep(
        'poetry self update',
        'poetry',
        ['self', 'update'],
        options
      );
      steps.push(step);
    }

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
