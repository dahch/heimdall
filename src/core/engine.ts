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
    // 1. Detect availability in parallel
    const availabilityChecks = await Promise.all(
      this.managers.map(async (manager) => {
        const available = await manager.isAvailable();
        return { manager, available };
      })
    );

    const availableManagers = availabilityChecks
      .filter((c) => c.available)
      .map((c) => c.manager);

    const unavailableManagers = availabilityChecks
      .filter((c) => !c.available)
      .map((c) => c.manager);

    // 2. Query outdated packages concurrently for available managers
    const checkPromises = availableManagers.map(async (manager) => {
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
    });

    const checkResults = await Promise.all(checkPromises);

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

    return {
      scannedManagersCount: this.managers.length,
      availableManagersCount: managersToRun.length,
      upToDateManagersCount: managersToRun.length - results.filter((r) => r.updatedCount > 0).length,
      pendingUpdatesCount: itemsByManager.size,
      executedCount: results.length,
      successCount: successful,
      failedCount: failed,
      totalDurationMs: Date.now() - startTime,
      results,
    };
  }
}
