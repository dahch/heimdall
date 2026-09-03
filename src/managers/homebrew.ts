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
    let allSucceeded = true;

    // Step 1: brew update (fetches newest formulae and homebrew itself)
    const updateStep = await this.executeStep(
      'brew update',
      'brew',
      ['update'],
      options
    );
    steps.push(updateStep);
    if (updateStep.status === 'failed') allSucceeded = false;

    // Step 2: brew upgrade (upgrades formulae)
    const upgradeStep = await this.executeStep(
      'brew upgrade',
      'brew',
      ['upgrade'],
      options
    );
    steps.push(upgradeStep);
    if (upgradeStep.status === 'failed') allSucceeded = false;

    // Step 3: brew upgrade --cask (upgrades GUI applications)
    const caskStep = await this.executeStep(
      'brew upgrade --cask',
      'brew',
      ['upgrade', '--cask'],
      options
    );
    steps.push(caskStep);
    if (caskStep.status === 'failed') allSucceeded = false;

    // Step 4: brew cleanup (removes old downloads and outdated versions)
    const cleanupStep = await this.executeStep(
      'brew cleanup',
      'brew',
      ['cleanup'],
      options
    );
    steps.push(cleanupStep);
    if (cleanupStep.status === 'failed') allSucceeded = false;

    return {
      managerId: this.id,
      managerName: this.name,
      icon: this.icon,
      success: allSucceeded,
      updatedCount: items.length,
      durationMs: Date.now() - startTime,
      steps,
      error: !allSucceeded
        ? steps.find((s) => s.status === 'failed')?.error ?? 'One or more Homebrew steps failed'
        : undefined,
    };
  }
}
