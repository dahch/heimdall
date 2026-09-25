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

interface BrewFormula {
  name: string;
  installed_versions: string[];
  current_version: string;
  pinned?: boolean;
}

interface BrewCask {
  name: string;
  installed_versions: string | string[];
  current_version: string;
}

interface BrewOutdatedJson {
  formulae?: BrewFormula[];
  casks?: BrewCask[];
}

export class HomebrewManager extends BasePackageManager {
  readonly id = 'homebrew';
  readonly name = 'Homebrew';
  readonly icon = '🍺';
  readonly category: ManagerCategory = 'system';
  protected readonly binary = 'brew';

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
      // Query outdated packages via json format
      const execRes = await safeExec('brew', ['outdated', '--json=v2'], {
        timeoutMs: options?.timeoutMs ?? 30000,
      });

      const updates: UpdateItem[] = [];

      if (execRes.success && execRes.stdout.trim()) {
        try {
          const parsed = JSON.parse(execRes.stdout) as BrewOutdatedJson;

          if (Array.isArray(parsed.formulae)) {
            for (const f of parsed.formulae) {
              updates.push({
                managerId: this.id,
                managerName: this.name,
                name: f.name,
                currentVersion: f.installed_versions?.[0] ?? 'unknown',
                latestVersion: f.current_version ?? 'latest',
                type: 'formula',
              });
            }
          }

          if (Array.isArray(parsed.casks)) {
            for (const c of parsed.casks) {
              const cur = Array.isArray(c.installed_versions)
                ? c.installed_versions[0]
                : c.installed_versions;
              updates.push({
                managerId: this.id,
                managerName: this.name,
                name: c.name,
                currentVersion: cur ?? 'unknown',
                latestVersion: c.current_version ?? 'latest',
                type: 'cask',
              });
            }
          }
        } catch {
          // Fallback to text parsing if JSON parse failed
          const textRes = await safeExec('brew', ['outdated'], { timeoutMs: 15000 });
          if (textRes.stdout.trim()) {
            const lines = textRes.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
            for (const line of lines) {
              const parts = line.split(/\s+/);
              updates.push({
                managerId: this.id,
                managerName: this.name,
                name: parts[0],
                currentVersion: parts[1] ?? 'unknown',
                latestVersion: parts[2] ?? 'latest',
                type: 'package',
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

    // Step 1: brew update (fetches newest formulae and homebrew itself)
    const updateStep = await this.executeStep(
      'brew update',
      'brew',
      ['update'],
      options
    );
    steps.push(updateStep);

    // Step 2: Determine what types of items are pending:
    const hasFormulae = items.some((i) => i.type === 'formula' || !i.type || i.type === 'package');
    const hasCasks = items.some((i) => i.type === 'cask');

    let upgradeSucceeded = false;
    if (hasCasks && !hasFormulae) {
      const caskStep = await this.executeStep(
        'brew upgrade --cask',
        'brew',
        ['upgrade', '--cask'],
        options
      );
      steps.push(caskStep);
      upgradeSucceeded = caskStep.status === 'success';
    } else if (hasFormulae && !hasCasks) {
      const formulaStep = await this.executeStep(
        'brew upgrade --formula',
        'brew',
        ['upgrade', '--formula'],
        options
      );
      steps.push(formulaStep);
      upgradeSucceeded = formulaStep.status === 'success';
    } else {
      const upgradeStep = await this.executeStep(
        'brew upgrade',
        'brew',
        ['upgrade'],
        options
      );
      steps.push(upgradeStep);
      upgradeSucceeded = upgradeStep.status === 'success';
    }

    // Step 3: brew cleanup (removes old downloads and outdated versions)
    const cleanupStep = await this.executeStep(
      'brew cleanup',
      'brew',
      ['cleanup'],
      options
    );
    steps.push(cleanupStep);

    const failedSteps = steps.filter((s) => s.status === 'failed');
    const success = failedSteps.length === 0;

    let error: string | undefined;
    if (failedSteps.length > 0) {
      const failedDetails = failedSteps
        .map((s) => `${s.name}${s.error ? `: ${s.error}` : ''}`)
        .join('; ');
      error = `${failedSteps.length} step(s) failed: ${failedDetails}`;
    }

    return {
      managerId: this.id,
      managerName: this.name,
      icon: this.icon,
      success,
      updatedCount: upgradeSucceeded ? items.length : 0,
      durationMs: Date.now() - startTime,
      steps,
      error,
    };
  }
}
