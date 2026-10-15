import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('execa', () => ({ execa: vi.fn() }));

import { execa } from 'execa';
import { ensureSudo, startSudoKeepAlive } from '../src/utils/exec.js';

const mockedExeca = execa as unknown as ReturnType<typeof vi.fn>;

const ok = { stdout: '', stderr: '', exitCode: 0, timedOut: false };
const denied = { stdout: '', stderr: 'sudo: a password is required', exitCode: 1, timedOut: false };
const isRoot = process.getuid?.() === 0;

const refreshCalls = () => mockedExeca.mock.calls.filter((call) => call[1]?.[0] === '-n' && call[1]?.[1] === '-v');

describe('sudo privilege acquisition', () => {
  let originalIsTTY: boolean | undefined;

  beforeEach(() => {
    originalIsTTY = process.stdin.isTTY;
    mockedExeca.mockReset();
  });

  afterEach(() => {
    Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true, writable: true });
  });

  const setStdinIsTTY = (value: boolean) => {
    Object.defineProperty(process.stdin, 'isTTY', { value, configurable: true, writable: true });
  };

  describe('ensureSudo', () => {
    it.skipIf(isRoot)('reuses the cached ticket without prompting', async () => {
      mockedExeca.mockResolvedValue(ok);
      await expect(ensureSudo()).resolves.toBe(true);
      expect(mockedExeca).toHaveBeenCalledTimes(1);
      expect(mockedExeca).not.toHaveBeenCalledWith('sudo', ['-v'], expect.anything());
    });

    it.skipIf(isRoot)('prompts on the terminal when no ticket is cached', async () => {
      setStdinIsTTY(true);
      mockedExeca.mockImplementation(async (_file, args) => (args?.[0] === '-n' ? denied : ok));

      await expect(ensureSudo()).resolves.toBe(true);
      expect(mockedExeca).toHaveBeenCalledWith('sudo', ['-v'], { stdio: 'inherit', reject: false });
    });

    it.skipIf(isRoot)('returns false when the terminal prompt is rejected', async () => {
      setStdinIsTTY(true);
      mockedExeca.mockImplementation(async (file) => (file === 'which' ? ok : denied));

      await expect(ensureSudo()).resolves.toBe(false);
      expect(mockedExeca).toHaveBeenCalledWith('sudo', ['-v'], { stdio: 'inherit', reject: false });
    });

    it('never prompts when stdin is not a TTY', async () => {
      setStdinIsTTY(false);
      mockedExeca.mockResolvedValue(denied);

      await expect(ensureSudo()).resolves.toBe(false);
      expect(mockedExeca).not.toHaveBeenCalledWith('sudo', ['-v'], expect.anything());
    });
  });

  describe('startSudoKeepAlive', () => {
    it('refreshes the cached ticket periodically until stopped', async () => {
      vi.useFakeTimers();
      try {
        mockedExeca.mockResolvedValue(ok);
        const stop = startSudoKeepAlive(1000);

        await vi.advanceTimersByTimeAsync(3000);
        expect(refreshCalls()).toHaveLength(3);

        stop();
        await vi.advanceTimersByTimeAsync(3000);
        expect(refreshCalls()).toHaveLength(3);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
