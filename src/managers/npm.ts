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

interface NpmOutdatedEntry {
  current?: string;
  wanted?: string;
  latest?: string;
  location?: string;
}

export class NpmManager extends BasePackageManager {
  readonly id = 'npm';
  readonly name = 'npm (global)';
  readonly icon = '📦';
  readonly category: ManagerCategory = 'runtime';
  protected readonly binary = 'npm';

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
      // Note: npm outdated exits with code 1 if packages are outdated
      const execRes = await safeExec('npm', ['outdated', '-g', '--json'], {
        timeoutMs: options?.timeoutMs ?? 25000,
      });

      const updates: UpdateItem[] = [];
      const stdout = execRes.stdout.trim();
      let npmError: string | undefined;

      if (stdout.startsWith('{')) {
        const parsed = JSON.parse(stdout) as Record<string, NpmOutdatedEntry | { summary?: string }>;
        for (const [name, info] of Object.entries(parsed)) {
          // npm mixes diagnostic keys into the outdated payload ("error", "problems");
          // treating them as packages would fabricate bogus install targets.
          if (name === 'error' || name === 'problems') {
            if (name === 'error' && info && typeof info === 'object' && 'summary' in info) {
              npmError = typeof info.summary === 'string' ? info.summary : undefined;
            }
            continue;
          }
          if (!info || typeof info !== 'object') continue;
          const entry = info as NpmOutdatedEntry;
          if (!entry.current && !entry.latest && !entry.wanted) continue;
          updates.push({
            managerId: this.id,
            managerName: this.name,
            name,
            currentVersion: entry.current ?? 'unknown',
            latestVersion: entry.latest ?? entry.wanted ?? 'latest',
            type: 'global-pkg',
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
        error: updates.length === 0 ? npmError : undefined,
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
    let updatedCount = 0;

    if (items.length === 0) {
      return {
        managerId: this.id,
        managerName: this.name,
        icon: this.icon,
        success: true,
        updatedCount: 0,
        durationMs: Date.now() - startTime,
        steps: [],
      };
    }

    // Step 1: Attempt targeted batch install only if multiple packages are outdated.
    // If only 1 package is outdated, proceed directly to isolated install to avoid duplicate execution.
    let runIsolatedFallback = true;

    if (items.length > 1) {
      const targets = items.map((i) =>
        i.latestVersion && i.latestVersion !== 'unknown' ? `${i.name}@${i.latestVersion}` : `${i.name}@latest`
      );

      const batchStep = await this.executeStep(
        `npm install -g --legacy-peer-deps (${items.length} pkgs)`,
        'npm',
        ['install', '-g', '--legacy-peer-deps', '--', ...targets],
        options
      );

      if (batchStep.status === 'success') {
        steps.push(batchStep);
        updatedCount = items.length;
        runIsolatedFallback = false;
      } else {
        // Batch hit conflicts. Mark batch step as skipped (fallback trigger)
        // so it does not count as a package failure when individual installs succeed.
        batchStep.status = 'skipped';
        steps.push(batchStep);

        options.onStepProgress?.(
          'npm install',
          'Batch install hit conflicts; falling back to per-package isolated installs...'
        );
      }
    }

    if (runIsolatedFallback) {
      for (const item of items) {
        const pkgTarget =
          item.latestVersion && item.latestVersion !== 'unknown'
            ? `${item.name}@${item.latestVersion}`
            : `${item.name}@latest`;

        const itemStep = await this.executeStep(
          `npm install -g ${item.name}`,
          'npm',
          ['install', '-g', '--legacy-peer-deps', '--', pkgTarget],
          options
        );

        if (itemStep.status === 'success') {
          updatedCount++;
          steps.push(itemStep);
        } else {
          // If the failure was due to install scripts (e.g. only-allow pnpm or broken native builds), retry with --ignore-scripts
          const errLower = (itemStep.error ?? '').toLowerCase();
          const isScriptIssue =
            errLower.includes('only-allow') ||
            errLower.includes('sh -c') ||
            errLower.includes('preinstall') ||
            errLower.includes('postinstall') ||
            errLower.includes('install script') ||
            errLower.includes('node-gyp') ||
            errLower.includes('254');

          if (isScriptIssue) {
            options.onStepProgress?.(
              `npm install -g ${item.name}`,
              `Install script failed; retrying with --ignore-scripts...`
            );

            const retryStep = await this.executeStep(
              `npm install -g ${item.name} (--ignore-scripts)`,
              'npm',
              ['install', '-g', '--legacy-peer-deps', '--ignore-scripts', '--', pkgTarget],
              options
            );

            if (retryStep.status === 'success') {
              updatedCount++;
              steps.push(retryStep);
            } else {
              steps.push(retryStep);
            }
          } else {
            steps.push(itemStep);
          }
        }
      }
    }

    const failedSteps = steps.filter((s) => s.status === 'failed');
    const success = failedSteps.length === 0;

    let errorSummary: string | undefined;
    if (!success) {
      const failedDetails = failedSteps
        .map((s) => `${s.name}${s.error ? `: ${s.error}` : ''}`)
        .join('; ');
      errorSummary = `${failedSteps.length} step(s) failed: ${failedDetails}`;
    }

    return {
      managerId: this.id,
      managerName: this.name,
      icon: this.icon,
      success,
      updatedCount,
      durationMs: Date.now() - startTime,
      steps,
      error: errorSummary,
    };
  }
}
