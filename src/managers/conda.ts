import { BasePackageManager } from './base.js';
import { safeExec } from '../utils/exec.js';
import { extractErrorMessage } from '../utils/formatting.js';
import type {
  ManagerCategory,
  CheckOptions,
  CheckResult,
  UpdateItem,
  ExecutionOptions,
  UpdateExecutionResult,
  UpdateStep,
} from '../types.js';

interface CondaPackageAction {
  name?: string;
  version?: string;
  channel?: string;
}

interface CondaDryRunJson {
  actions?: {
    LINK?: CondaPackageAction[];
    UNLINK?: CondaPackageAction[];
  };
}

interface CondaPlannedUpdate {
  name: string;
  currentVersion?: string;
  latestVersion: string;
  channel?: string;
}

/**
 * Conda (Anaconda / Miniconda / Miniforge) exposes no `list --outdated` command.
 * A solver dry-run (`conda update --all --dry-run --json`) is the only reliable way
 * to learn which packages the next `conda update --all` would replace, so the LINK
 * (new) and UNLINK (current) actions are paired by package name.
 */
export class CondaManager extends BasePackageManager {
  readonly id = 'conda';
  readonly name = 'Conda (Anaconda/Miniforge)';
  readonly icon = '🅒';
  readonly category: ManagerCategory = 'language';
  protected readonly binary = 'conda';

  private parseDryRun(stdout: string): CondaPlannedUpdate[] {
    const jsonStart = stdout.indexOf('{');
    const jsonEnd = stdout.lastIndexOf('}');
    if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) return [];

    let parsed: CondaDryRunJson;
    try {
      parsed = JSON.parse(stdout.slice(jsonStart, jsonEnd + 1)) as CondaDryRunJson;
    } catch {
      return [];
    }

    const unlinked = new Map<string, CondaPackageAction>();
    for (const entry of parsed.actions?.UNLINK ?? []) {
      if (entry.name) unlinked.set(entry.name, entry);
    }

    const updates: CondaPlannedUpdate[] = [];
    for (const entry of parsed.actions?.LINK ?? []) {
      if (!entry.name || !entry.version) continue;
      const previous = unlinked.get(entry.name);
      // Only replacements of already-installed packages are updates; brand-new
      // dependency links are side effects of the solver, not user-visible updates.
      if (!previous) continue;
      updates.push({
        name: entry.name,
        currentVersion: previous.version,
        latestVersion: entry.version,
        channel: entry.channel,
      });
    }
    return updates;
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
      // The conda solver routinely exceeds the default 25s global check budget.
      const timeoutMs = Math.max(options?.timeoutMs ?? 60000, 60000);
      const execRes = await safeExec('conda', ['update', '--all', '--dry-run', '--json'], {
        timeoutMs,
      });

      const updates: UpdateItem[] = [];
      if (execRes.success) {
        for (const action of this.parseDryRun(execRes.stdout)) {
          updates.push({
            managerId: this.id,
            managerName: this.name,
            name: action.name,
            currentVersion: action.currentVersion ?? 'installed',
            latestVersion: action.latestVersion,
            type: 'conda-pkg',
            extra: action.channel,
          });
        }
      }

      const rawError = (execRes.stderr || execRes.stdout).trim();

      return {
        managerId: this.id,
        managerName: this.name,
        icon: this.icon,
        category: this.category,
        available: true,
        updates,
        durationMs: Date.now() - startTime,
        error: !execRes.success && rawError ? extractErrorMessage(rawError) : undefined,
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
        `conda update --all (${items.length} pkgs)`,
        'conda',
        ['update', '--all', '-y'],
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
