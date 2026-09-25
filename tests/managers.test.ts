import { describe, it, expect, vi, afterEach } from 'vitest';
import * as execUtils from '../src/utils/exec.js';
import { HomebrewManager } from '../src/managers/homebrew.js';
import { NpmManager } from '../src/managers/npm.js';
import { PnpmManager } from '../src/managers/pnpm.js';
import { BunManager } from '../src/managers/bun.js';
import { PythonPipManager } from '../src/managers/python.js';
import { RubyGemManager } from '../src/managers/gem.js';
import { MacPortsManager } from '../src/managers/macports.js';
import { MacAppStoreManager } from '../src/managers/mas.js';

describe('Package Managers Outdated Parsers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });
  describe('HomebrewManager', () => {
    it('parses formulae and casks from brew outdated JSON v2', async () => {
      const manager = new HomebrewManager();
      vi.spyOn(manager, 'isAvailable').mockResolvedValue(true);
      vi.spyOn(execUtils, 'safeExec').mockResolvedValue({
        stdout: JSON.stringify({
          formulae: [
            {
              name: 'git',
              installed_versions: ['2.40.0'],
              current_version: '2.42.0',
            },
          ],
          casks: [
            {
              name: 'visual-studio-code',
              installed_versions: '1.80.0',
              current_version: '1.82.0',
            },
          ],
        }),
        stderr: '',
        exitCode: 0,
        success: true,
        timedOut: false,
      });

      const result = await manager.checkUpdates();
      expect(result.available).toBe(true);
      expect(result.updates).toHaveLength(2);
      expect(result.updates[0]).toEqual({
        managerId: 'homebrew',
        managerName: 'Homebrew',
        name: 'git',
        currentVersion: '2.40.0',
        latestVersion: '2.42.0',
        type: 'formula',
      });
      expect(result.updates[1]).toEqual({
        managerId: 'homebrew',
        managerName: 'Homebrew',
        name: 'visual-studio-code',
        currentVersion: '1.80.0',
        latestVersion: '1.82.0',
        type: 'cask',
      });
    });

    it('executes targeted brew upgrade --cask when only casks are pending', async () => {
      const manager = new HomebrewManager();
      const executedCommands: string[] = [];
      vi.spyOn(execUtils, 'safeExec').mockImplementation(async (cmd, args) => {
        executedCommands.push(`${cmd} ${(args ?? []).join(' ')}`);
        return { stdout: '', stderr: '', exitCode: 0, success: true, timedOut: false };
      });

      const items = [
        { managerId: 'homebrew', managerName: 'Homebrew', name: 'docker', currentVersion: '4.20', latestVersion: '4.21', type: 'cask' },
      ];

      const result = await manager.executeUpdate(items, { dryRun: false });
      expect(result.success).toBe(true);
      expect(result.updatedCount).toBe(1);
      expect(executedCommands).toEqual([
        'brew update',
        'brew upgrade --cask',
        'brew cleanup',
      ]);
    });

    it('executes targeted brew upgrade --formula when only formulae are pending', async () => {
      const manager = new HomebrewManager();
      const executedCommands: string[] = [];
      vi.spyOn(execUtils, 'safeExec').mockImplementation(async (cmd, args) => {
        executedCommands.push(`${cmd} ${(args ?? []).join(' ')}`);
        return { stdout: '', stderr: '', exitCode: 0, success: true, timedOut: false };
      });

      const items = [
        { managerId: 'homebrew', managerName: 'Homebrew', name: 'git', currentVersion: '2.40', latestVersion: '2.42', type: 'formula' },
      ];

      const result = await manager.executeUpdate(items, { dryRun: false });
      expect(result.success).toBe(true);
      expect(result.updatedCount).toBe(1);
      expect(executedCommands).toEqual([
        'brew update',
        'brew upgrade --formula',
        'brew cleanup',
      ]);
    });

    it('executes combined brew upgrade when both formulae and casks are pending', async () => {
      const manager = new HomebrewManager();
      const executedCommands: string[] = [];
      vi.spyOn(execUtils, 'safeExec').mockImplementation(async (cmd, args) => {
        executedCommands.push(`${cmd} ${(args ?? []).join(' ')}`);
        return { stdout: '', stderr: '', exitCode: 0, success: true, timedOut: false };
      });

      const items = [
        { managerId: 'homebrew', managerName: 'Homebrew', name: 'git', currentVersion: '2.40', latestVersion: '2.42', type: 'formula' },
        { managerId: 'homebrew', managerName: 'Homebrew', name: 'docker', currentVersion: '4.20', latestVersion: '4.21', type: 'cask' },
      ];

      const result = await manager.executeUpdate(items, { dryRun: false });
      expect(result.success).toBe(true);
      expect(result.updatedCount).toBe(2);
      expect(executedCommands).toEqual([
        'brew update',
        'brew upgrade',
        'brew cleanup',
      ]);
    });

    it('handles step failure in HomebrewManager.executeUpdate with proper failure accounting', async () => {
      const manager = new HomebrewManager();
      vi.spyOn(execUtils, 'safeExec').mockImplementation(async (cmd, args) => {
        if (args?.[0] === 'upgrade') {
          return { stdout: '', stderr: 'Error: Permission denied', exitCode: 1, success: false, timedOut: false };
        }
        return { stdout: '', stderr: '', exitCode: 0, success: true, timedOut: false };
      });

      const items = [
        { managerId: 'homebrew', managerName: 'Homebrew', name: 'git', currentVersion: '2.40', latestVersion: '2.42', type: 'formula' },
      ];

      const result = await manager.executeUpdate(items, { dryRun: false });
      expect(result.success).toBe(false);
      expect(result.updatedCount).toBe(0);
      expect(result.error).toContain('brew upgrade --formula');
      expect(result.error).toContain('Error: Permission denied');
    });
  });

  describe('NpmManager', () => {
    it('parses npm outdated JSON even when exit code is 1', async () => {
      const manager = new NpmManager();
      vi.spyOn(manager, 'isAvailable').mockResolvedValue(true);
      vi.spyOn(execUtils, 'safeExec').mockResolvedValue({
        stdout: JSON.stringify({
          eslint: {
            current: '8.0.0',
            wanted: '8.50.0',
            latest: '9.0.0',
          },
        }),
        stderr: '',
        exitCode: 1, // Standard npm exit code when outdated items exist
        success: false,
        timedOut: false,
      });

      const result = await manager.checkUpdates();
      expect(result.available).toBe(true);
      expect(result.updates).toHaveLength(1);
      expect(result.updates[0].name).toBe('eslint');
      expect(result.updates[0].currentVersion).toBe('8.0.0');
      expect(result.updates[0].latestVersion).toBe('9.0.0');
    });

    it('returns success immediately when no items are pending in executeUpdate', async () => {
      const manager = new NpmManager();
      const result = await manager.executeUpdate([], { dryRun: false });
      expect(result.success).toBe(true);
      expect(result.updatedCount).toBe(0);
      expect(result.steps).toHaveLength(0);
    });

    it('successfully executes targeted batch install with specific versions', async () => {
      const manager = new NpmManager();
      const executedCommands: string[] = [];
      vi.spyOn(execUtils, 'safeExec').mockImplementation(async (cmd, args) => {
        executedCommands.push(`${cmd} ${(args ?? []).join(' ')}`);
        return { stdout: '', stderr: '', exitCode: 0, success: true, timedOut: false };
      });

      const items = [
        { managerId: 'npm', managerName: 'npm (global)', name: 'typescript', currentVersion: '5.0.0', latestVersion: '5.4.0' },
        { managerId: 'npm', managerName: 'npm (global)', name: 'prettier', currentVersion: '3.0.0', latestVersion: '3.2.0' },
      ];

      const result = await manager.executeUpdate(items, { dryRun: false });
      expect(result.success).toBe(true);
      expect(result.updatedCount).toBe(2);
      expect(executedCommands).toEqual([
        'npm install -g --legacy-peer-deps typescript@5.4.0 prettier@3.2.0',
      ]);
    });

    it('falls back to per-package install and retries with --ignore-scripts when script fails', async () => {
      const manager = new NpmManager();
      const executedCommands: string[] = [];
      vi.spyOn(execUtils, 'safeExec').mockImplementation(async (cmd, args) => {
        const full = `${cmd} ${(args ?? []).join(' ')}`;
        executedCommands.push(full);

        // Batch install fails
        if (full.includes('typescript@5.4.0') && full.includes('torlnk@1.0.1')) {
          return { stdout: '', stderr: 'npm error code ERESOLVE\nnpm error ERESOLVE could not resolve', exitCode: 1, success: false, timedOut: false };
        }

        // typescript isolated succeeds
        if (full === 'npm install -g --legacy-peer-deps typescript@5.4.0') {
          return { stdout: 'added 1 package', stderr: '', exitCode: 0, success: true, timedOut: false };
        }

        // torlnk without --ignore-scripts fails with script error (only-allow pnpm)
        if (full === 'npm install -g --legacy-peer-deps torlnk@1.0.1') {
          return {
            stdout: '',
            stderr: 'npm error code 1\nnpm error command failed\nnpm error command sh -c npx only-allow pnpm',
            exitCode: 1,
            success: false,
            timedOut: false,
          };
        }

        // torlnk retry with --ignore-scripts succeeds!
        if (full === 'npm install -g --legacy-peer-deps --ignore-scripts torlnk@1.0.1') {
          return { stdout: 'added 1 package', stderr: '', exitCode: 0, success: true, timedOut: false };
        }

        return { stdout: '', stderr: '', exitCode: 0, success: true, timedOut: false };
      });

      const items = [
        { managerId: 'npm', managerName: 'npm (global)', name: 'typescript', currentVersion: '5.0.0', latestVersion: '5.4.0' },
        { managerId: 'npm', managerName: 'npm (global)', name: 'torlnk', currentVersion: '1.0.0', latestVersion: '1.0.1' },
      ];

      const result = await manager.executeUpdate(items, { dryRun: false });
      expect(result.success).toBe(true);
      expect(result.updatedCount).toBe(2);
      expect(result.steps.find((s) => s.status === 'skipped')).toBeDefined();
      expect(executedCommands).toContain('npm install -g --legacy-peer-deps --ignore-scripts torlnk@1.0.1');
    });

    it('accurately accounts for failures when package update fails', async () => {
      const manager = new NpmManager();
      vi.spyOn(execUtils, 'safeExec').mockResolvedValue({
        stdout: '',
        stderr: 'npm error 404 Not Found - broken-pkg',
        exitCode: 1,
        success: false,
        timedOut: false,
      });

      const items = [
        { managerId: 'npm', managerName: 'npm (global)', name: 'broken-pkg', currentVersion: '1.0.0', latestVersion: '1.1.0' },
      ];

      const result = await manager.executeUpdate(items, { dryRun: false });
      expect(result.success).toBe(false);
      expect(result.updatedCount).toBe(0);
      expect(result.error).toContain('broken-pkg');
      expect(result.error).toContain('404 Not Found');
    });
  });

  describe('PnpmManager', () => {
    it('extracts and parses JSON from mixed pnpm CLI output', async () => {
      const manager = new PnpmManager();
      vi.spyOn(manager, 'isAvailable').mockResolvedValue(true);
      const mixedOutput = `
      Some pnpm update notice...
      {
        "typescript": {
          "current": "5.0.0",
          "latest": "5.5.0",
          "wanted": "5.0.0"
        }
      }
      ┌────────────┬─────────┬────────┐
      │ Package    │ Current │ Latest │
      └────────────┴─────────┴────────┘
      `;
      vi.spyOn(execUtils, 'safeExec').mockResolvedValue({
        stdout: mixedOutput,
        stderr: '',
        exitCode: 0,
        success: true,
        timedOut: false,
      });

      const result = await manager.checkUpdates();
      expect(result.updates).toHaveLength(1);
      expect(result.updates[0].name).toBe('typescript');
      expect(result.updates[0].currentVersion).toBe('5.0.0');
      expect(result.updates[0].latestVersion).toBe('5.5.0');
    });
  });

  describe('BunManager', () => {
    it('parses bun outdated ASCII table format', async () => {
      const manager = new BunManager();
      vi.spyOn(manager, 'isAvailable').mockResolvedValue(true);
      const tableOutput = `
bun outdated v1.1.0
|-----------------------------------|---------|--------|--------|
| Package                           | Current | Update | Latest |
|-----------------------------------|---------|--------|--------|
| my-cli-tool                       | 1.0.0   | 1.0.0  | 2.0.0  |
|-----------------------------------|---------|--------|--------|
      `;
      vi.spyOn(execUtils, 'safeExec').mockResolvedValue({
        stdout: tableOutput,
        stderr: '',
        exitCode: 0,
        success: true,
        timedOut: false,
      });

      const result = await manager.checkUpdates();
      expect(result.updates).toHaveLength(1);
      expect(result.updates[0].name).toBe('my-cli-tool');
      expect(result.updates[0].currentVersion).toBe('1.0.0');
      expect(result.updates[0].latestVersion).toBe('2.0.0');
    });
  });

  describe('PythonPipManager', () => {
    it('parses pip outdated JSON user packages', async () => {
      const manager = new PythonPipManager();
      vi.spyOn(manager, 'isAvailable').mockResolvedValue(true);
      vi.spyOn(execUtils, 'safeExec').mockResolvedValue({
        stdout: JSON.stringify([
          {
            name: 'requests',
            version: '2.28.0',
            latest_version: '2.31.0',
          },
        ]),
        stderr: '',
        exitCode: 0,
        success: true,
        timedOut: false,
      });

      const result = await manager.checkUpdates();
      expect(result.updates).toHaveLength(1);
      expect(result.updates[0].name).toBe('requests');
      expect(result.updates[0].currentVersion).toBe('2.28.0');
      expect(result.updates[0].latestVersion).toBe('2.31.0');
    });
  });

  describe('RubyGemManager', () => {
    it('parses gem outdated format lines', async () => {
      const manager = new RubyGemManager();
      vi.spyOn(manager, 'isAvailable').mockResolvedValue(true);
      const gemOutput = `
rake (13.0.0 < 13.1.0)
rspec (3.11.0 < 3.12.0)
      `;
      vi.spyOn(execUtils, 'safeExec').mockResolvedValue({
        stdout: gemOutput,
        stderr: '',
        exitCode: 0,
        success: true,
        timedOut: false,
      });

      const result = await manager.checkUpdates();
      expect(result.updates).toHaveLength(2);
      expect(result.updates[0].name).toBe('rake');
      expect(result.updates[0].currentVersion).toBe('13.0.0');
      expect(result.updates[0].latestVersion).toBe('13.1.0');
    });
  });

  describe('MacPortsManager', () => {
    it('parses port outdated output', async () => {
      const manager = new MacPortsManager();
      vi.spyOn(manager, 'isAvailable').mockResolvedValue(true);
      const portOutput = `
The following installed ports are outdated:
wget                           1.21.3 < 1.21.4
      `;
      vi.spyOn(execUtils, 'safeExec').mockResolvedValue({
        stdout: portOutput,
        stderr: '',
        exitCode: 0,
        success: true,
        timedOut: false,
      });

      const result = await manager.checkUpdates();
      expect(result.updates).toHaveLength(1);
      expect(result.updates[0].name).toBe('wget');
      expect(result.updates[0].currentVersion).toBe('1.21.3');
      expect(result.updates[0].latestVersion).toBe('1.21.4');
    });
  });

  describe('MacAppStoreManager', () => {
    it('parses mas outdated output', async () => {
      const manager = new MacAppStoreManager();
      vi.spyOn(manager, 'isAvailable').mockResolvedValue(true);
      const masOutput = `
497799835 Xcode (15.0 -> 15.2)
      `;
      vi.spyOn(execUtils, 'safeExec').mockResolvedValue({
        stdout: masOutput,
        stderr: '',
        exitCode: 0,
        success: true,
        timedOut: false,
      });

      const result = await manager.checkUpdates();
      expect(result.updates).toHaveLength(1);
      expect(result.updates[0].name).toContain('Xcode');
      expect(result.updates[0].currentVersion).toBe('15.0');
      expect(result.updates[0].latestVersion).toBe('15.2');
    });
  });

  describe('YarnManager', () => {
    it('parses both regular and scoped packages from yarn global list', async () => {
      const { YarnManager } = await import('../src/managers/yarn.js');
      const manager = new YarnManager();
      vi.spyOn(manager, 'isAvailable').mockResolvedValue(true);
      vi.spyOn(execUtils, 'safeExec').mockResolvedValue({
        stdout: `
yarn global v1.22.22
info "create-vite@6.1.0" has binaries:
   - create-vite
info "@angular/cli@17.0.0" has binaries:
   - ng
Done in 0.02s.
        `,
        stderr: '',
        exitCode: 0,
        success: true,
        timedOut: false,
      });

      // Mock global fetch for registry lookup
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
        const urlStr = String(url);
        if (urlStr.includes('create-vite')) {
          return {
            ok: true,
            json: async () => ({ version: '9.2.0' }),
          } as Response;
        }
        if (urlStr.includes('%40angular') || urlStr.includes('@angular')) {
          return {
            ok: true,
            json: async () => ({ version: '17.3.0' }),
          } as Response;
        }
        return { ok: false } as Response;
      });

      const result = await manager.checkUpdates();
      expect(result.updates).toHaveLength(2);
      expect(result.updates[0].name).toBe('create-vite');
      expect(result.updates[0].latestVersion).toBe('9.2.0');
      expect(result.updates[1].name).toBe('@angular/cli');
      expect(result.updates[1].latestVersion).toBe('17.3.0');

      fetchSpy.mockRestore();
    });
  });

  describe('PipxManager', () => {
    it('queries PyPI API and only reports packages when a newer version exists', async () => {
      const { PipxManager } = await import('../src/managers/pipx.js');
      const manager = new PipxManager();
      vi.spyOn(manager, 'isAvailable').mockResolvedValue(true);
      vi.spyOn(execUtils, 'safeExec').mockResolvedValue({
        stdout: JSON.stringify({
          venvs: {
            black: { metadata: { main_package: { package_version: '23.1.0' } } },
            ruff: { metadata: { main_package: { package_version: '0.4.0' } } },
          },
        }),
        stderr: '',
        exitCode: 0,
        success: true,
        timedOut: false,
      });

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
        const urlStr = String(url);
        if (urlStr.includes('black')) {
          return {
            ok: true,
            json: async () => ({ info: { version: '24.1.0' } }),
          } as Response;
        }
        // ruff is already up to date
        if (urlStr.includes('ruff')) {
          return {
            ok: true,
            json: async () => ({ info: { version: '0.4.0' } }),
          } as Response;
        }
        return { ok: false } as Response;
      });

      const result = await manager.checkUpdates();
      expect(result.updates).toHaveLength(1);
      expect(result.updates[0].name).toBe('black');
      expect(result.updates[0].currentVersion).toBe('23.1.0');
      expect(result.updates[0].latestVersion).toBe('24.1.0');

      fetchSpy.mockRestore();
    });
  });

  describe('CargoManager', () => {
    it('succeeds gracefully when no updater tools are installed', async () => {
      const { CargoManager } = await import('../src/managers/cargo.js');
      const manager = new CargoManager();
      vi.spyOn(execUtils, 'commandExists').mockResolvedValue(false);

      const result = await manager.executeUpdate([], { dryRun: false });
      expect(result.success).toBe(true);
      expect(result.steps).toHaveLength(0);
      expect(result.error).toBeUndefined();
    });
  });

  describe('AptManager', () => {
    it('fails fast when non-interactive sudo is unavailable', async () => {
      const { AptManager } = await import('../src/managers/linux.js');
      const manager = new AptManager();
      vi.spyOn(execUtils, 'safeExec').mockImplementation(async (cmd, args) => {
        if (cmd === 'sudo' && args?.[0] === '-n') {
          return { stdout: '', stderr: 'sudo: a password is required', exitCode: 1, success: false, timedOut: false };
        }
        return { stdout: '', stderr: '', exitCode: 0, success: true, timedOut: false };
      });

      const result = await manager.executeUpdate(
        [{ managerId: 'apt', managerName: 'APT', name: 'curl', currentVersion: '7.88', latestVersion: '7.89' }],
        { dryRun: false }
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('APT requires sudo privileges');
    });
  });

  describe('HomebrewManager.executeUpdate selective updates', () => {
    it('executes brew upgrade --cask when only casks are pending', async () => {
      const manager = new HomebrewManager();
      const execSpy = vi.spyOn(execUtils, 'safeExec').mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 0,
        success: true,
        timedOut: false,
      });

      const result = await manager.executeUpdate(
        [{ managerId: 'homebrew', managerName: 'Homebrew', name: 'raycast', currentVersion: '1.0', latestVersion: '1.1', type: 'cask' }],
        { dryRun: false }
      );

      expect(result.success).toBe(true);
      expect(execSpy).toHaveBeenCalledWith('brew', ['update'], expect.any(Object));
      expect(execSpy).toHaveBeenCalledWith('brew', ['upgrade', '--cask'], expect.any(Object));
      expect(execSpy).toHaveBeenCalledWith('brew', ['cleanup'], expect.any(Object));
      expect(execSpy).not.toHaveBeenCalledWith('brew', ['upgrade', '--formula'], expect.any(Object));
    });

    it('executes brew upgrade --formula when only formulae are pending', async () => {
      const manager = new HomebrewManager();
      const execSpy = vi.spyOn(execUtils, 'safeExec').mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 0,
        success: true,
        timedOut: false,
      });

      const result = await manager.executeUpdate(
        [{ managerId: 'homebrew', managerName: 'Homebrew', name: 'git', currentVersion: '2.40', latestVersion: '2.42', type: 'formula' }],
        { dryRun: false }
      );

      expect(result.success).toBe(true);
      expect(execSpy).toHaveBeenCalledWith('brew', ['upgrade', '--formula'], expect.any(Object));
    });
  });

  describe('NpmManager.executeUpdate resilience and script recovery', () => {
    it('handles batch install failure and recovers with --ignore-scripts', async () => {
      const manager = new NpmManager();
      vi.spyOn(execUtils, 'safeExec').mockImplementation(async (cmd, args) => {
        // If batch install (multiple packages or first attempt)
        if (args?.includes('torlnk@1.9.0') && args?.includes('lodash@4.17.21')) {
          return {
            stdout: '',
            stderr: 'npm warn EBADENGINE Unsupported engine {\nnpm error code ERESOLVE\nnpm error ERESOLVE could not resolve',
            exitCode: 1,
            success: false,
            timedOut: false,
          };
        }

        // lodash single install succeeds
        if (args?.includes('lodash@4.17.21')) {
          return { stdout: 'added 1 package', stderr: '', exitCode: 0, success: true, timedOut: false };
        }

        // torlnk without --ignore-scripts fails with script error
        if (args?.includes('torlnk@1.9.0') && !args?.includes('--ignore-scripts')) {
          return {
            stdout: '',
            stderr: 'npm error command failed\nnpm error command sh -c npx only-allow pnpm',
            exitCode: 254,
            success: false,
            timedOut: false,
          };
        }

        // torlnk with --ignore-scripts succeeds!
        if (args?.includes('torlnk@1.9.0') && args?.includes('--ignore-scripts')) {
          return { stdout: 'changed 226 packages in 1s', stderr: '', exitCode: 0, success: true, timedOut: false };
        }

        return { stdout: '', stderr: '', exitCode: 0, success: true, timedOut: false };
      });

      const result = await manager.executeUpdate(
        [
          { managerId: 'npm', managerName: 'npm (global)', name: 'lodash', currentVersion: '4.17.20', latestVersion: '4.17.21', type: 'global-pkg' },
          { managerId: 'npm', managerName: 'npm (global)', name: 'torlnk', currentVersion: '1.8.0', latestVersion: '1.9.0', type: 'global-pkg' },
        ],
        { dryRun: false }
      );

      expect(result.success).toBe(true);
      expect(result.updatedCount).toBe(2);
      expect(result.error).toBeUndefined();
      // The batch step should be recorded as 'skipped'
      const batchStep = result.steps.find((s) => s.name.includes('pkgs'));
      expect(batchStep?.status).toBe('skipped');
    });
  });
});
