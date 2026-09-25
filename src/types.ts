export type ManagerCategory = 'system' | 'runtime' | 'language' | 'appstore';

export interface UpdateItem {
  managerId: string;
  managerName: string;
  name: string;
  currentVersion: string;
  latestVersion: string;
  type?: string;
  extra?: string;
}

export interface CheckOptions {
  timeoutMs?: number;
  verbose?: boolean;
}

export interface CheckResult {
  managerId: string;
  managerName: string;
  icon: string;
  category: ManagerCategory;
  available: boolean;
  updates: UpdateItem[];
  durationMs: number;
  error?: string;
  warning?: string;
}

export interface UpdateStep {
  name: string;
  command: string;
  status: 'pending' | 'running' | 'success' | 'failed' | 'skipped';
  durationMs?: number;
  error?: string;
}

export interface ExecutionOptions {
  dryRun?: boolean;
  verbose?: boolean;
  timeoutMs?: number;
  onStepStart?: (step: string) => void;
  onStepProgress?: (step: string, logLine: string) => void;
  onStepEnd?: (step: string, success: boolean, error?: string, durationMs?: number) => void;
}

export interface UpdateExecutionResult {
  managerId: string;
  managerName: string;
  icon: string;
  success: boolean;
  updatedCount: number;
  durationMs: number;
  steps: UpdateStep[];
  error?: string;
}

export interface PackageManager {
  readonly id: string;
  readonly name: string;
  readonly icon: string;
  readonly category: ManagerCategory;

  isAvailable(): Promise<boolean>;
  checkUpdates(options?: CheckOptions): Promise<CheckResult>;
  executeUpdate(items: UpdateItem[], options: ExecutionOptions): Promise<UpdateExecutionResult>;
}

export interface GlobalSummary {
  scannedManagersCount: number;
  availableManagersCount: number;
  upToDateManagersCount: number;
  pendingUpdatesCount: number;
  executedCount: number;
  successCount: number;
  failedCount: number;
  totalDurationMs: number;
  results: UpdateExecutionResult[];
}
