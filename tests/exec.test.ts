import { describe, it, expect } from 'vitest';
import { commandExists, safeExec } from '../src/utils/exec.js';

describe('exec utils', () => {
  describe('commandExists', () => {
    it('returns true for an existing command like node', async () => {
      const exists = await commandExists('node');
      expect(exists).toBe(true);
    });

    it('returns false for a nonexistent command', async () => {
      const exists = await commandExists('nonexistent_command_xyz_890');
      expect(exists).toBe(false);
    });
  });

  describe('safeExec', () => {
    it('executes a command and captures stdout cleanly', async () => {
      const result = await safeExec('node', ['-e', 'console.log("hello world")']);
      expect(result.success).toBe(true);
      expect(result.stdout.trim()).toBe('hello world');
      expect(result.exitCode).toBe(0);
    });

    it('does not throw when a command fails, returns error information', async () => {
      const result = await safeExec('node', ['-e', 'process.exit(2)']);
      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(2);
    });

    it('handles command timeouts gracefully', async () => {
      const result = await safeExec(
        'node',
        ['-e', 'setTimeout(() => {}, 5000)'],
        { timeoutMs: 200 }
      );
      expect(result.timedOut).toBe(true);
      expect(result.success).toBe(false);
    });
  });
});
