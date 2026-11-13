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

interface UvTool {
  name: string;
  version: string;
}

/**
 * uv tools are installed into isolated environments under `~/.local/share/uv/tools`.
 * `uv tool list` only reports the installed versions, so latest versions are resolved
 * through the PyPI JSON API instead of spawning one `uv pip index` subprocess per tool
 * (see ADR-004: native HTTP over N+1 subprocesses).
 */
export class UvManager extends BasePackageManager {
  readonly id = 'uv';
  readonly name = 'uv (Python tools)';
  readonly icon = '🧪';
  readonly category: ManagerCategory = 'language';
  protected readonly binary = 'uv';

  /**
   * Parses `uv tool list` output, e.g.:
   *   black v24.10.0
   *   - black
   *   - blackd
   */
  private parseToolList(stdout: string): UvTool[] {
    const tools: UvTool[] = [];
    for (const rawLine of stdout.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('-')) continue;
      const match = line.match(/^(\S+)\s+v?(\d[0-9A-Za-z.+-]*)(?:\s+\(.*\))?$/);
      if (match) {
        tools.push({ name: match[1], version: match[2] });
      }
    }
    return tools;
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
      const execRes = await safeExec('uv', ['tool', 'list'], {
        timeoutMs: options?.timeoutMs ?? 15000,
      });

      const updates: UpdateItem[] = [];
      const tools = execRes.success ? this.parseToolList(execRes.stdout) : [];

      await Promise.all(
        tools.map(async ({ name, version }) => {
          try {
            const response = await fetch(
              `https://pypi.org/pypi/${encodeURIComponent(name)}/json`,
              { signal: AbortSignal.timeout(3000) }
            );
            if (!response.ok) return;
            const data = (await response.json()) as { info?: { version?: string } };
            const latest = data.info?.version;
            if (latest && latest !== version) {
              updates.push({
                managerId: this.id,
                managerName: this.name,
                name,
                currentVersion: version,
                latestVersion: latest,
                type: 'uv-tool',
              });
            }
          } catch {
            // Ignore network lookup timeouts/errors gracefully
          }
        })
      );

      updates.sort((a, b) => a.name.localeCompare(b.name));

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
      // `uv tool upgrade --all` upgrades every tool to the latest version its
      // recorded requirement allows; explicit installs then force the latest
      // release for tools pinned to an older major (see ADR-002 equivalent for Bun/Yarn).
      const upgradeStep = await this.executeStep(
        `uv tool upgrade --all (${items.length} tools)`,
        'uv',
        ['tool', 'upgrade', '--all'],
        options
      );
      steps.push(upgradeStep);

      const pinned = items.filter((i) => {
        const major = (v: string) => v.replace(/^v/, '').split('.')[0];
        return major(i.currentVersion) !== major(i.latestVersion);
      });

      for (const item of pinned) {
        const step = await this.executeStep(
          `uv tool install ${item.name}@latest`,
          'uv',
          ['tool', 'install', `${item.name}@latest`],
          options
        );
        steps.push(step);
      }
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
