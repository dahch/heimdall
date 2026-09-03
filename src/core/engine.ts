import type {
  PackageManager,
  CheckResult,
  UpdateItem,
  ExecutionOptions,
  UpdateExecutionResult,
  GlobalSummary,
} from '../types.js';

export interface ScanProgressCallback {
  onManagerStart?: (manager: PackageManager) => void;
  onManagerComplete?: (manager: PackageManager, result: CheckResult) => void;
}

export class UpdaterEngine {
  constructor(private readonly managers: PackageManager[]) {}

  /**
   * Scans all managers for availability and pending updates.
   * Runs checks concurrently for high performance, but isolates failures.
   */
  async scan(
    timeoutMs = 25000,
    callbacks?: ScanProgressCallback
  ): Promise<{
    availableResults: CheckResult[];
    allUpdates: UpdateItem[];
    unavailableManagers: PackageManager[];
  }> {
    // 1. Detect availability in parallel with error isolation
    const availabilityChecks = await Promise.all(
      this.managers.map(async (manager) => {
        try {
          const available = await manager.isAvailable();
          return { manager, available };
        } catch {
          return { manager, available: false };
        }
      })
    );

    const availableManagers = availabilityChecks
      .filter((c) => c.available)
      .map((c) => c.manager);

    const unavailableManagers = availabilityChecks
      .filter((c) => !c.available)
      .map((c) => c.manager);

    // 2. Query outdated packages with a concurrency limit of 4
    const checkTask = async (manager: PackageManager): Promise<CheckResult> => {
      callbacks?.onManagerStart?.(manager);
      try {
        const res = await manager.checkUpdates({ timeoutMs });
        callbacks?.onManagerComplete?.(manager, res);
        return res;
      } catch (err) {
        const fallbackRes: CheckResult = {
          managerId: manager.id,
          managerName: manager.name,
          icon: manager.icon,
          category: manager.category,
          available: true,
          updates: [],
          durationMs: 0,
          error: err instanceof Error ? err.message : String(err),
        };
        callbacks?.onManagerComplete?.(manager, fallbackRes);
        return fallbackRes;
      }
    };

    // Concurrency pool (max 4 concurrent check operations)
    const checkResults: CheckResult[] = new Array(availableManagers.length);
    let taskIndex = 0;
    const concurrency = Math.min(4, availableManagers.length);
    const workers = Array.from({ length: concurrency }, async () => {
      while (taskIndex < availableManagers.length) {
        const idx = taskIndex++;
        checkResults[idx] = await checkTask(availableManagers[idx]);
      }
    });
    await Promise.all(workers);

    // 3. Flatten and sort updates
    const allUpdates: UpdateItem[] = [];
    for (const res of checkResults) {
      allUpdates.push(...res.updates);
    }

    return {
      availableResults: checkResults,
      allUpdates,
      unavailableManagers,
    };
  }

  /**
   * Executes updates for the specified managers sequentially or with controlled steps.
   */
  async execute(
    selectedManagerIds: string[],
    itemsByManager: Map<string, UpdateItem[]>,
    options: ExecutionOptions,
    onManagerStart?: (manager: PackageManager) => void,
    onManagerComplete?: (manager: PackageManager, result: UpdateExecutionResult) => void
  ): Promise<GlobalSummary> {
    const startTime = Date.now();
    const results: UpdateExecutionResult[] = [];

    const managersToRun = this.managers.filter((m) =>
      selectedManagerIds.includes(m.id)
    );

    for (const manager of managersToRun) {
      const items = itemsByManager.get(manager.id) ?? [];
      onManagerStart?.(manager);

      try {
        const result = await manager.executeUpdate(items, options);
        results.push(result);
        onManagerComplete?.(manager, result);
      } catch (err) {
        const failedResult: UpdateExecutionResult = {
          managerId: manager.id,
          managerName: manager.name,
          icon: manager.icon,
          success: false,
          updatedCount: 0,
          durationMs: 0,
          steps: [],
          error: err instanceof Error ? err.message : String(err),
        };
        results.push(failedResult);
        onManagerComplete?.(manager, failedResult);
      }
    }

    const successful = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;
    const totalUpdated = results.reduce((acc, r) => acc + r.updatedCount, 0);
    const totalPending = Array.from(itemsByManager.values()).reduce(
      (acc, items) => acc + items.length,
      0
    );

    return {
      scannedManagersCount: this.managers.length,
      availableManagersCount: managersToRun.length,
      upToDateManagersCount: results.filter((r) => r.success && r.updatedCount === 0).length,
      pendingUpdatesCount: totalPending,
      executedCount: results.length,
      successCount: successful,
      failedCount: failed,
      totalDurationMs: Date.now() - startTime,
      results,
    };
  }
}
