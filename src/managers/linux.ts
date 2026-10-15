import { BasePackageManager } from './base.js';
import { safeExec, SUDO_REQUIRED_HINT } from '../utils/exec.js';
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

export class AptManager extends BasePackageManager {
  readonly id = 'apt';
  readonly name = 'APT (Debian/Ubuntu)';
  readonly icon = '🐧';
  readonly category: ManagerCategory = 'system';
  readonly requiresSudo = true;
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
      if (!(await this.hasPasswordlessSudo())) {
        const error = `APT requires sudo privileges. ${SUDO_REQUIRED_HINT}`;
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
              error,
            },
          ],
          error,
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
  readonly requiresSudo = true;
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
      const timeoutMs = options?.timeoutMs ?? 20000;

      // Both installation scopes are queried: a system-only listing hides user-scoped apps
      const [userRes, systemRes] = await Promise.all([
        safeExec('flatpak', ['remote-ls', '--user', '--updates'], { timeoutMs }),
        safeExec('flatpak', ['remote-ls', '--system', '--updates'], { timeoutMs }),
      ]);

      if (!userRes.success && !systemRes.success) {
        const raw = (systemRes.stderr || userRes.stderr).trim();
        return {
          managerId: this.id,
          managerName: this.name,
          icon: this.icon,
          category: this.category,
          available: true,
          updates: [],
          durationMs: Date.now() - startTime,
          error: raw ? extractErrorMessage(raw) : undefined,
        };
      }

      const updates: UpdateItem[] = [];
      const seen = new Set<string>();

      for (const execRes of [userRes, systemRes]) {
        for (const line of execRes.stdout.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          const parts = trimmed.split(/\s+/);
          const name = parts[0];
          if (seen.has(name)) continue;
          seen.add(name);
          updates.push({
            managerId: this.id,
            managerName: this.name,
            name,
            currentVersion: 'installed',
            latestVersion: parts[1] ?? 'latest',
            type: 'flatpak',
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

  private async hasSystemScopeApps(): Promise<boolean> {
    const result = await safeExec('flatpak', ['list', '--system', '--columns=application'], {
      timeoutMs: 10000,
    });
    return result.success && result.stdout.trim().length > 0;
  }

  async executeUpdate(
    items: UpdateItem[],
    options: ExecutionOptions
  ): Promise<UpdateExecutionResult> {
    const startTime = Date.now();
    const steps: UpdateStep[] = [];

    // Step 1: user installation (never requires elevation)
    const userStep = await this.executeStep(
      'flatpak update --user',
      'flatpak',
      ['update', '--user', '-y', '--noninteractive'],
      options
    );
    steps.push(userStep);

    // Step 2: system installation (requires root; polkit agents are unavailable in a pipe)
    const sudoStepName = 'sudo flatpak update --system';
    const sudoStepCommand = 'sudo flatpak update --system -y --noninteractive';

    if (options.dryRun) {
      const systemStep = await this.executeStep(
        sudoStepName,
        'sudo',
        ['flatpak', 'update', '--system', '-y', '--noninteractive'],
        options
      );
      steps.push(systemStep);
    } else if (process.getuid?.() === 0 || (await this.hasPasswordlessSudo())) {
      const systemStep = await this.executeStep(
        sudoStepName,
        'sudo',
        ['flatpak', 'update', '--system', '-y', '--noninteractive'],
        options
      );
      steps.push(systemStep);
    } else if (await this.hasSystemScopeApps()) {
      steps.push({
        name: sudoStepName,
        command: sudoStepCommand,
        status: 'failed',
        error: `System-wide Flatpak updates require sudo privileges. ${SUDO_REQUIRED_HINT}`,
      });
    } else {
      steps.push({
        name: sudoStepName,
        command: sudoStepCommand,
        status: 'skipped',
      });
    }

    const executedSteps = steps.filter((s) => s.status !== 'skipped');
    const success = executedSteps.length > 0 && executedSteps.every((s) => s.status === 'success');

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

export class DnfManager extends BasePackageManager {
  readonly id = 'dnf';
  readonly name = 'DNF (Fedora/RHEL)';
  readonly icon = '📦';
  readonly category: ManagerCategory = 'system';
  readonly requiresSudo = true;
  protected readonly binary = 'dnf';

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
      const execRes = await safeExec(this.binary, ['check-update', '-y'], {
        timeoutMs: options?.timeoutMs ?? 25000,
      });

      // Exit codes: 0 = no updates, 100 = updates available. Any other code indicates failure.
      if (execRes.exitCode !== 0 && execRes.exitCode !== 100) {
        return {
          managerId: this.id,
          managerName: this.name,
          icon: this.icon,
          category: this.category,
          available: true,
          updates: [],
          durationMs: Date.now() - startTime,
          error:
            (execRes.stderr || execRes.stdout).trim()
              ? extractErrorMessage(execRes.stderr || execRes.stdout)
              : `dnf check-update failed with code ${execRes.exitCode}`,
        };
      }

      if (execRes.exitCode === 0) {
        return {
          managerId: this.id,
          managerName: this.name,
          icon: this.icon,
          category: this.category,
          available: true,
          updates: [],
          durationMs: Date.now() - startTime,
        };
      }

      const updates: UpdateItem[] = [];
      const lines = execRes.stdout.split('\n');
      let pendingPkg: string | null = null;

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;

        // Skip headers, notices, and repository metadata lines
        if (
          line.startsWith('Updating and loading repositories') ||
          line.startsWith('Repositories loaded') ||
          line.startsWith('Last metadata expiration check') ||
          line.startsWith('Obsoleting Packages') ||
          line.startsWith('Loaded plugins') ||
          line.startsWith('Security:')
        ) {
          continue;
        }

        const combinedLine = pendingPkg ? `${pendingPkg} ${line}` : line;
        const match = combinedLine.match(/^(\S+?)\.([a-zA-Z0-9_]+)\s+(\S+)\s+(\S+)/);

        if (match) {
          const [, name, arch, latestVersion, repo] = match;
          updates.push({
            managerId: this.id,
            managerName: this.name,
            name,
            currentVersion: 'installed',
            latestVersion,
            type: 'rpm',
            extra: `${repo} (${arch})`,
          });
          pendingPkg = null;
        } else if (!pendingPkg && /^\S+?\.[a-zA-Z0-9_]+$/.test(line)) {
          // Wrapped entry where package.arch is on its own line
          pendingPkg = line;
        } else {
          pendingPkg = null;
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

    // Verify non-interactive sudo privileges beforehand
    if (!options.dryRun && process.getuid?.() !== 0) {
      if (!(await this.hasPasswordlessSudo())) {
        const error = `DNF requires sudo privileges. ${SUDO_REQUIRED_HINT}`;
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
              error,
            },
          ],
          error,
        };
      }
    }

    // Step 1: sudo dnf upgrade --refresh
    const upgradeStep = await this.executeStep(
      'sudo dnf upgrade --refresh',
      'sudo',
      ['dnf', 'upgrade', '-y', '--refresh'],
      options
    );
    steps.push(upgradeStep);

    // Step 2: Conditional autoremove
    if (upgradeStep.status === 'success') {
      if (options.dryRun) {
        const autoremoveStep = await this.executeStep(
          'sudo dnf autoremove',
          'sudo',
          ['dnf', 'autoremove', '-y'],
          options
        );
        steps.push(autoremoveStep);
      } else if (options.confirmAction) {
        const shouldAutoremove = await options.confirmAction(
          'Do you want to run sudo dnf autoremove to clean up orphaned packages?'
        );
        if (shouldAutoremove) {
          const autoremoveStep = await this.executeStep(
            'sudo dnf autoremove',
            'sudo',
            ['dnf', 'autoremove', '-y'],
            options
          );
          steps.push(autoremoveStep);
        } else {
          steps.push({
            name: 'sudo dnf autoremove',
            command: 'sudo dnf autoremove -y',
            status: 'skipped',
          });
        }
      } else {
        steps.push({
          name: 'sudo dnf autoremove',
          command: 'sudo dnf autoremove -y',
          status: 'skipped',
        });
      }
    } else {
      steps.push({
        name: 'sudo dnf autoremove',
        command: 'sudo dnf autoremove -y',
        status: 'skipped',
      });
    }

    const nonSkippedSteps = steps.filter((s) => s.status !== 'skipped');
    const success = nonSkippedSteps.length > 0 && nonSkippedSteps.every((s) => s.status === 'success');

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

