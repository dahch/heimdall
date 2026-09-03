import { describe, it, expect, vi } from 'vitest';
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
});
