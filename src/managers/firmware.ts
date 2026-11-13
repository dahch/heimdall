import { BasePackageManager } from './base.js';
import { commandExists, safeExec, SUDO_REQUIRED_HINT } from '../utils/exec.js';
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

interface FwupdRelease {
  Version?: string;
  Name?: string;
  Summary?: string;
}

interface FwupdDevice {
  Name?: string;
  DeviceId?: string;
  Version?: string;
  Vendor?: string;
  Plugin?: string;
  Releases?: FwupdRelease[];
}

interface FwupdUpdatesJson {
  Devices?: FwupdDevice[];
}

/**
 * Firmware updates through fwupd (Linux: Fedora, Debian/Ubuntu, Arch, ...).
 *
 * Routine mirrors the documented CLI workflow:
 *   1. `fwupdmgr refresh`          — refresh LVFS/remote metadata
 *   2. `fwupdmgr get-updates`      — list devices with pending firmware
 *   3. `fwupdmgr update`           — install every pending firmware update
 *
 * Metadata refresh and update need root, hence `requiresSudo`. The check phase runs
 * unprivileged with `--json` so it never triggers an interactive authentication prompt.
 */
export class FirmwareManager extends BasePackageManager {
  readonly id = 'firmware';
  readonly name = 'Firmware (fwupd)';
  readonly icon = '🔧';
  readonly category: ManagerCategory = 'system';
  readonly requiresSudo = true;
  protected readonly binary = 'fwupdmgr';

  async isAvailable(): Promise<boolean> {
    // fwupd ships on Linux distributions only (macOS/Windows use their own stacks).
    if (process.platform !== 'linux') return false;
    return commandExists('fwupdmgr');
  }

  private parseUpdates(stdout: string): UpdateItem[] {
    const jsonStart = stdout.indexOf('{');
    const jsonEnd = stdout.lastIndexOf('}');
    if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) return [];

    let parsed: FwupdUpdatesJson;
    try {
      parsed = JSON.parse(stdout.slice(jsonStart, jsonEnd + 1)) as FwupdUpdatesJson;
    } catch {
      return [];
    }

    const updates: UpdateItem[] = [];
    for (const device of parsed.Devices ?? []) {
      const latestVersion = device.Releases?.[0]?.Version;
      if (!device.Name || !latestVersion) continue;
      updates.push({
        managerId: this.id,
        managerName: this.name,
        name: device.Name,
        currentVersion: device.Version ?? 'unknown',
        latestVersion,
        type: 'firmware',
        extra: device.Vendor ?? device.Plugin,
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
      const timeoutMs = options?.timeoutMs ?? 30000;

      // Metadata refresh keeps `get-updates` accurate against LVFS. It is best-effort:
      // unprivileged refresh can be refused by the daemon, and stale-but-usable
      // metadata is far better than a hard failure of the whole check.
      await safeExec('fwupdmgr', ['refresh'], { timeoutMs: Math.min(timeoutMs, 20000) });

      const execRes = await safeExec('fwupdmgr', ['--json', 'get-updates'], { timeoutMs });
      const updates = this.parseUpdates(execRes.stdout);
      const parsedOutput = execRes.stdout.trim().startsWith('{');

      // Older fwupd releases use a non-zero exit code to signal "no updates available",
      // so a parsable JSON payload always wins over the exit code.
      if (!execRes.success && !parsedOutput) {
        const raw = (execRes.stderr || execRes.stdout).trim();
        return {
          managerId: this.id,
          managerName: this.name,
          icon: this.icon,
          category: this.category,
          available: true,
          updates: [],
          durationMs: Date.now() - startTime,
          error: raw ? extractErrorMessage(raw) : 'fwupdmgr get-updates failed',
        };
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

    if (items.length === 0) {
      return {
        managerId: this.id,
        managerName: this.name,
        icon: this.icon,
        success: true,
        updatedCount: 0,
        durationMs: Date.now() - startTime,
        steps,
      };
    }

    if (!options.dryRun && process.getuid?.() !== 0) {
      if (!(await this.hasPasswordlessSudo())) {
        const error = `Firmware updates require sudo privileges. ${SUDO_REQUIRED_HINT}`;
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

    // Step 1: refresh remote metadata so the update phase sees the newest releases.
    const refreshStep = await this.executeStep(
      'sudo fwupdmgr refresh',
      'sudo',
      ['fwupdmgr', 'refresh', '--force'],
      options
    );
    steps.push(refreshStep);

    // Step 2: install every pending firmware update non-interactively.
    // `--no-reboot-check` keeps fwupdmgr from rebooting the machine by itself;
    // the user reboots deliberately once the summary is reported.
    const updateStep = await this.executeStep(
      'sudo fwupdmgr update',
      'sudo',
      [
        'fwupdmgr',
        'update',
        '-y',
        '--no-reboot-check',
        '--no-unreported-check',
        '--no-metadata-check',
      ],
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
