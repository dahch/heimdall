import { describe, it, expect, vi } from 'vitest';
import { UpdaterEngine } from '../src/core/engine.js';
import { filterManagers } from '../src/managers/registry.js';
import type { PackageManager, CheckResult, UpdateItem, UpdateExecutionResult } from '../src/types.js';

function createMockManager(
  id: string,
  name: string,
  available: boolean,
  updates: UpdateItem[] = [],
  shouldThrow = false
): PackageManager {
  return {
    id,
    name,
    icon: '📦',
    category: 'system',
    isAvailable: vi.fn().mockResolvedValue(available),
    checkUpdates: vi.fn().mockImplementation(async (): Promise<CheckResult> => {
      if (shouldThrow) {
        throw new Error(`Simulated error in ${name}`);
      }
      return {
        managerId: id,
        managerName: name,
        icon: '📦',
        category: 'system',
        available,
        updates,
        durationMs: 10,
      };
    }),
    executeUpdate: vi.fn().mockImplementation(async (): Promise<UpdateExecutionResult> => {
      return {
        managerId: id,
        managerName: name,
        icon: '📦',
        success: true,
        updatedCount: updates.length,
        durationMs: 50,
        steps: [
          {
            name: `${id} update`,
            command: `${id} update`,
            status: 'success',
            durationMs: 50,
          },
        ],
      };
    }),
  };
}

describe('UpdaterEngine & Registry Filters', () => {
  describe('filterManagers', () => {
    const managers = [
      createMockManager('homebrew', 'Homebrew', true),
      createMockManager('npm', 'npm (global)', true),
      createMockManager('pip', 'Python (pip user)', true),
    ];

    it('filters by only (by id)', () => {
      const filtered = filterManagers(managers, ['homebrew']);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe('homebrew');
    });

    it('filters by only (by name, case insensitive)', () => {
      const filtered = filterManagers(managers, ['NPM (GLOBAL)']);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe('npm');
    });

    it('filters by exclude', () => {
      const filtered = filterManagers(managers, undefined, ['pip']);
      expect(filtered).toHaveLength(2);
      expect(filtered.map((m) => m.id)).toEqual(['homebrew', 'npm']);
    });
  });

  describe('UpdaterEngine resilience and aggregation', () => {
    it('scans available managers, skips unavailable, and isolates failures gracefully', async () => {
      const m1 = createMockManager('brew', 'Homebrew', true, [
        {
          managerId: 'brew',
          managerName: 'Homebrew',
          name: 'git',
          currentVersion: '2.40.0',
          latestVersion: '2.42.0',
        },
      ]);
      const m2 = createMockManager('port', 'MacPorts', false); // Not installed
      const m3 = createMockManager('failing', 'FailingManager', true, [], true); // Throws!

      const engine = new UpdaterEngine([m1, m2, m3]);
      const result = await engine.scan();

      // Available checks
      expect(result.unavailableManagers).toHaveLength(1);
      expect(result.unavailableManagers[0].id).toBe('port');

      // Resilient: m3 failed with exception, but scan did not crash
      expect(result.availableResults).toHaveLength(2); // m1 and m3
      const failingResult = result.availableResults.find((r) => r.managerId === 'failing');
      expect(failingResult?.error).toContain('Simulated error in FailingManager');

      // Updates aggregated from m1
      expect(result.allUpdates).toHaveLength(1);
      expect(result.allUpdates[0].name).toBe('git');
    });

    it('executes updates and returns structured summary', async () => {
      const m1 = createMockManager('brew', 'Homebrew', true, [
        {
          managerId: 'brew',
          managerName: 'Homebrew',
          name: 'git',
          currentVersion: '2.40.0',
          latestVersion: '2.42.0',
        },
      ]);
      const engine = new UpdaterEngine([m1]);

      const itemsMap = new Map([['brew', [{
        managerId: 'brew',
        managerName: 'Homebrew',
        name: 'git',
        currentVersion: '2.40.0',
        latestVersion: '2.42.0',
      }]]]);

      const summary = await engine.execute(['brew'], itemsMap, { dryRun: false });
      expect(summary.executedCount).toBe(1);
      expect(summary.successCount).toBe(1);
      expect(summary.failedCount).toBe(0);
      expect(summary.results[0].updatedCount).toBe(1);
      expect(summary.results[0].success).toBe(true);
    });
  });
});
