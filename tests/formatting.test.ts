import { describe, it, expect } from 'vitest';
import {
  extractErrorMessage,
  formatDuration,
  renderUpdatesTable,
  renderExecutionSummary,
} from '../src/utils/formatting.js';
import type { UpdateItem, UpdateExecutionResult } from '../src/types.js';

describe('Formatting Utilities', () => {
  describe('formatDuration', () => {
    it('formats milliseconds below 1000ms', () => {
      expect(formatDuration(450)).toBe('450ms');
    });

    it('formats seconds with 1 decimal place', () => {
      expect(formatDuration(1500)).toBe('1.5s');
      expect(formatDuration(32100)).toBe('32.1s');
    });
  });

  describe('extractErrorMessage', () => {
    it('returns default message on empty or undefined input', () => {
      expect(extractErrorMessage(undefined)).toBe('Command exited with error');
      expect(extractErrorMessage('')).toBe('Command exited with error');
      expect(extractErrorMessage('   \n  ')).toBe('Command exited with error');
    });

    it('strips ANSI color escape sequences', () => {
      const colored = '\u001b[31mError:\u001b[39m something broke';
      expect(extractErrorMessage(colored)).toBe('Error: something broke');
    });

    it('returns default message when output contains only warnings', () => {
      const warningOnly = `
npm warn EBADENGINE Unsupported engine {
npm warn deprecated request@2.88.2: request has been deprecated
npm notice created a lockfile on package install
      `;
      expect(extractErrorMessage(warningOnly)).toBe('Command exited with error');
    });

    it('filters out harmless npm warnings and extracts meaningful npm error', () => {
      const npmStderr = `
npm warn EBADENGINE Unsupported engine {
npm warn EBADENGINE   package: '@fission-ai/openspec@1.13.0',
npm warn EBADENGINE   required: { node: '>=22' },
npm warn EBADENGINE   current: { node: 'v20.10.0' }
npm warn EBADENGINE }
npm error code 254
npm error path /path/to/node_modules/torlnk/node_modules/ip-set
npm error command failed
npm error command sh -c npx only-allow pnpm
npm error A complete log of this run can be found in: /Users/test/.npm/_logs/debug.log
      `;

      const result = extractErrorMessage(npmStderr);
      expect(result).not.toContain('npm warn');
      expect(result).not.toContain('EBADENGINE');
      expect(result).toContain('command failed');
      expect(result).toContain('only-allow pnpm');
    });

    it('cleans trailing open brackets and punctuation', () => {
      const brokenJson = 'npm warn unsupported {\nsyntax error: unexpected token:';
      const result = extractErrorMessage(brokenJson);
      expect(result).toBe('syntax error: unexpected token');
    });

    it('extracts general error lines', () => {
      const stderr = `
info: downloading package
warning: slow connection detected
fatal: connection reset by peer
      `;
      const result = extractErrorMessage(stderr);
      expect(result).toBe('fatal: connection reset by peer');
    });

    it('truncates messages exceeding 120 characters cleanly', () => {
      const longError = 'Error: ' + 'x'.repeat(200);
      const result = extractErrorMessage(longError);
      expect(result.length).toBeLessThanOrEqual(120);
      expect(result.endsWith('...')).toBe(true);
    });
  });

  describe('renderUpdatesTable', () => {
    it('returns dim notice when items array is empty', () => {
      const output = renderUpdatesTable([]);
      expect(output).toContain('No updates pending');
    });

    it('renders updates with version transition and type tags', () => {
      const items: UpdateItem[] = [
        {
          managerId: 'homebrew',
          managerName: 'Homebrew',
          name: 'git',
          currentVersion: '2.40.0',
          latestVersion: '2.42.0',
          type: 'formula',
        },
        {
          managerId: 'npm',
          managerName: 'npm (global)',
          name: 'torlnk',
          currentVersion: '1.8.0',
          latestVersion: '1.9.0',
          type: 'global-pkg',
        },
      ];

      const output = renderUpdatesTable(items);
      expect(output).toContain('Homebrew');
      expect(output).toContain('git');
      expect(output).toContain('[formula]');
      expect(output).toContain('2.40.0');
      expect(output).toContain('2.42.0');
      expect(output).toContain('→');
      expect(output).toContain('torlnk');
      expect(output).toContain('[global-pkg]');
    });
  });

  describe('renderExecutionSummary', () => {
    it('renders execution metrics and ignores skipped fallback steps', () => {
      const results: UpdateExecutionResult[] = [
        {
          managerId: 'homebrew',
          managerName: 'Homebrew',
          icon: '🍺',
          success: true,
          updatedCount: 1,
          durationMs: 3500,
          steps: [
            { name: 'brew update', command: 'brew update', status: 'success', durationMs: 1200 },
            { name: 'brew upgrade', command: 'brew upgrade', status: 'success', durationMs: 2300 },
          ],
        },
        {
          managerId: 'npm',
          managerName: 'npm (global)',
          icon: '📦',
          success: true,
          updatedCount: 1,
          durationMs: 2000,
          steps: [
            { name: 'npm install -g batch', command: 'npm install -g batch', status: 'skipped' },
            { name: 'npm install -g torlnk', command: 'npm install -g torlnk', status: 'success', durationMs: 1800 },
          ],
        },
      ];

      const output = renderExecutionSummary(results);
      expect(output).toContain('Execution Summary');
      expect(output).toContain('Homebrew');
      expect(output).toContain('npm (global)');
      expect(output).toContain('2/2 managers succeeded');
      expect(output).toContain('2 package(s) updated');
      expect(output).not.toContain('npm install -g batch'); // Skipped step is omitted
    });

    it('renders error message and failed step markers on failure', () => {
      const results: UpdateExecutionResult[] = [
        {
          managerId: 'npm',
          managerName: 'npm (global)',
          icon: '📦',
          success: false,
          updatedCount: 1,
          durationMs: 5000,
          steps: [
            { name: 'npm install -g pkgA', command: 'npm install -g pkgA', status: 'success', durationMs: 1000 },
            {
              name: 'npm install -g pkgB',
              command: 'npm install -g pkgB',
              status: 'failed',
              durationMs: 2000,
              error: 'script failed: only-allow pnpm',
            },
          ],
          error: '1 package(s) failed (pkgB): script failed: only-allow pnpm',
        },
      ];

      const output = renderExecutionSummary(results);
      expect(output).toContain('FAILED');
      expect(output).toContain('pkgB');
      expect(output).toContain('only-allow pnpm');
      expect(output).toContain('0/1 managers succeeded');
      expect(output).toContain('1 failed');
    });
  });
});
