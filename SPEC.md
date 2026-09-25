# Technical Specification: Universal Updater (`uup`)

## 1. Document Overview

This specification formalizes the functional contracts, command-line interface (CLI), data models, execution semantics, and non-functional requirements of **Universal Updater** (`uup`). It serves as the authoritative technical benchmark for system behavior.

---

## 2. System Overview & Runtime Environment

### 2.1 Supported Host Environments
- **macOS (Darwin)**: macOS 12.0 (Monterey) through macOS 15+ (Sequoia) on Apple Silicon (`arm64`) and Intel (`x86_64`).
- **Linux**: Modern distributions (Debian, Ubuntu, Fedora, Arch Linux) supporting glibc >= 2.31, system-level package tools (`apt`), and flatpak containers.

### 2.2 Runtime Dependencies
- **Engine**: Node.js >= 20.0.0 (requires native ECMAScript Modules, `globalThis.fetch`, `AbortSignal.timeout`, and `process.getuid`).
- **Package Manager / Build Tool**: `pnpm` (development and build toolchain), `tsup` (bundler), `vitest` (test harness).

---

## 3. Command-Line Interface (CLI) Contract

### 3.1 Binary Identifiers
The package registers two identical entry point binaries via `package.json`:
- `uup` (primary short command)
- `universal-updater` (canonical alias)

Both point to [`dist/cli.js`](file:///Volumes/DahchDev/projects/universal-updater/dist/cli.js), built from [`src/cli.ts`](file:///Volumes/DahchDev/projects/universal-updater/src/cli.ts).

### 3.2 Command Signature
```bash
uup [options]
```

### 3.3 CLI Flags & Options

| Flag | Long Option | Type | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `-y` | `--yes` | `boolean` | `false` | Skips interactive prompts and executes all pending updates automatically. |
| `-d` | `--dry-run` | `boolean` | `false` | Discovers managers, scans updates, and simulates execution through the engine without invoking mutative shell commands. |
| `-o` | `--only <managers>` | `string` | `undefined` | Comma-separated manager IDs or names to filter inclusion (e.g. `brew,npm,bun`). Case-insensitive. |
| `-x` | `--exclude <managers>` | `string` | `undefined` | Comma-separated manager IDs or names to exclude from discovery and execution (e.g. `macports,apt`). Case-insensitive. |
| `-t` | `--timeout <ms>` | `string` | `"25000"` | Per-manager timeout in milliseconds for the outdated scan phase. Parsed as base-10 integer. |
| `-v` | `--verbose` | `boolean` | `false` | Enables verbose diagnostics, including listing skipped/inactive managers and unhandled step warnings. |
| `-h` | `--help` | `boolean` | `false` | Displays standard Commander help table and exits. |
| `-V` | `--version` | `boolean` | `false` | Outputs CLI version (`1.0.0`) and exits. |

### 3.4 Process Exit Codes

| Exit Code | Condition |
| :---: | :--- |
| `0` | **Success**: Updates completed without errors, or all packages are already up to date, or the user deliberately cancelled during interactive prompt selection. |
| `1` | **Failure / Warning**: <br>- Filter specification (`--only` / `--exclude`) matched 0 package managers.<br>- One or more package managers failed during update execution (`summary.failedCount > 0`).<br>- Fatal unhandled exception occurred in the host process. |

---

## 4. Data Models & Type Signatures

All core interfaces are defined in [`src/types.ts`](file:///Volumes/DahchDev/projects/universal-updater/src/types.ts).

### 4.1 Manager Categories
```typescript
export type ManagerCategory = 'system' | 'runtime' | 'language' | 'appstore';
```

### 4.2 Outdated Package Item ([`UpdateItem`](file:///Volumes/DahchDev/projects/universal-updater/src/types.ts#L3-L11))
Represents a single package identified as needing an upgrade:
```typescript
export interface UpdateItem {
  managerId: string;       // Unique manager identifier (e.g., 'homebrew', 'npm')
  managerName: string;     // User-facing manager name (e.g., 'Homebrew', 'npm (global)')
  name: string;            // Name of the outdated package or cask
  currentVersion: string;  // Currently installed version (or 'unknown' / 'installed')
  latestVersion: string;   // Target/latest version available
  type?: string;           // Sub-type (e.g., 'formula', 'cask', 'global-pkg', 'gem')
  extra?: string;          // Optional metadata
}
```

### 4.3 Scan Results ([`CheckResult`](file:///Volumes/DahchDev/projects/universal-updater/src/types.ts#L18-L28))
The output produced by a package manager's check phase:
```typescript
export interface CheckResult {
  managerId: string;
  managerName: string;
  icon: string;
  category: ManagerCategory;
  available: boolean;      // True if the manager binary exists and passed pre-checks
  updates: UpdateItem[];   // Collection of outdated packages found
  durationMs: number;      // Wall-clock check duration
  error?: string;          // Error message if scan failed
  warning?: string;        // Non-fatal advisory string
}
```

### 4.4 Execution Steps ([`UpdateStep`](file:///Volumes/DahchDev/projects/universal-updater/src/types.ts#L30-L36))
Represents an atomic command executed during the update lifecycle:
```typescript
export interface UpdateStep {
  name: string;                                                    // Description of the step
  command: string;                                                 // Exact shell command executed
  status: 'pending' | 'running' | 'success' | 'failed' | 'skipped';// Step lifecycle status
  durationMs?: number;                                             // Step execution duration
  error?: string;                                                  // Error message if step failed
}
```

### 4.5 Execution Output ([`UpdateExecutionResult`](file:///Volumes/DahchDev/projects/universal-updater/src/types.ts#L47-L56))
Aggregated execution result for a single package manager:
```typescript
export interface UpdateExecutionResult {
  managerId: string;
  managerName: string;
  icon: string;
  success: boolean;       // True if all non-optional steps succeeded
  updatedCount: number;   // Number of packages successfully updated
  durationMs: number;     // Total duration of update routine
  steps: UpdateStep[];    // Array of sub-step results
  error?: string;         // First encountered error message
}
```

### 4.6 Global Summary ([`GlobalSummary`](file:///Volumes/DahchDev/projects/universal-updater/src/types.ts#L69-L79))
Global metrics returned by [`UpdaterEngine.execute()`](file:///Volumes/DahchDev/projects/universal-updater/src/core/engine.ts#L101):
```typescript
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
```

### 4.7 Package Manager Contract ([`PackageManager`](file:///Volumes/DahchDev/projects/universal-updater/src/types.ts#L58-L67))
```typescript
export interface PackageManager {
  readonly id: string;
  readonly name: string;
  readonly icon: string;
  readonly category: ManagerCategory;

  isAvailable(): Promise<boolean>;
  checkUpdates(options?: CheckOptions): Promise<CheckResult>;
  executeUpdate(items: UpdateItem[], options: ExecutionOptions): Promise<UpdateExecutionResult>;
}
```

---

## 5. Behavioral Specifications & Lifecycle

### 5.1 Stage 1: Discovery & Availability Detection
1. **Parallel Pre-Flight Checks**: When [`UpdaterEngine.scan()`](file:///Volumes/DahchDev/projects/universal-updater/src/core/engine.ts#L22) is invoked, `manager.isAvailable()` is evaluated concurrently for all candidate managers via `Promise.all`.
2. **Error Isolation**: If `isAvailable()` throws an unexpected error, the manager is coerced to `available: false` without failing the scan.
3. **Pre-Check Filters**:
   - `RubyGemManager`: Verifies `which gem`. If it resolves to `/usr/bin/gem` or starts with `/System/Library`, it returns `false` to avoid macOS SIP-protected legacy Ruby hangs.
   - `CargoManager`: Checks whether either `cargo` or `rustup` exists in `PATH`.
   - `PythonPipManager`: Dynamically switches between `pip3` and `pip`, whichever is resolved first.

### 5.2 Stage 2: Outdated Scan & Concurrency Pool
1. **Concurrency Pool**: To avoid overwhelming network adapters and spawning unconstrained sub-processes, check queries run via a bounded worker pool with maximum **4 concurrent tasks**:
   ```typescript
   const concurrency = Math.min(4, availableManagers.length);
   ```
2. **Timeout Enforcement**: Each manager check is constrained by `timeoutMs` (CLI default: 25,000ms). Subprocesses killed by timeout emit `timedOut: true`.
3. **Native HTTP Registry Lookups**:
   - `YarnManager`: Parses `yarn global list --depth=0`, then executes concurrent `fetch()` calls to `https://registry.npmjs.org/<pkg>/latest` with a 3,000ms abort signal.
   - `PipxManager`: Parses `pipx list --json`, then queries `https://pypi.org/pypi/<pkg>/json` with a 3,000ms abort signal. Only packages where PyPI version != installed version are flagged as outdated.
4. **Resilient Outdated Parsers**:
   - `NpmManager`: Treats exit code 1 as a valid check state (npm exits 1 when outdated packages are detected).
   - `PnpmManager`: Extracts the substring between the first `{` and last `}` to safely isolate JSON payloads from ambient CLI notices or ASCII tables.
   - `BunManager`: Parses markdown ASCII table lines formatted as `| Package | Current | Update | Latest |`.

### 5.3 Stage 3: Aggregation & Confirmation
1. **Zero-Update Short-Circuit**: If `allUpdates.length === 0`, the CLI displays an up-to-date banner and exits immediately with code `0`.
2. **Tabular Presentation**: Updates are formatted using `cli-table3` with custom box-drawing borders, showing Manager, Package, Type, Current Version (yellow), and Latest Version (green bold).
3. **Confirmation Modes**:
   - `--dry-run`: Sets `dryRun: true`, auto-selects all managers with pending updates, and logs an informational simulation message.
   - `--yes`: Auto-selects all managers with pending updates and proceeds immediately.
   - *Default Interactive*: Prompts user with `@clack/prompts`:
     - Option A: Confirm & Update everything.
     - Option B: Select specific package managers to update (via `@clack/prompts` multiselect).
     - Option C: Cancel and exit without changes (exits code `0`).

### 5.4 Stage 4: Execution & Resilience Strategies
1. **Sequential Execution**: Selected managers execute sequentially to avoid lockfile contention (e.g. brew locks, dpkg database locks).
2. **Dry-Run Emulation**: When `options.dryRun` is `true`, [`BasePackageManager.executeStep()`](file:///Volumes/DahchDev/projects/universal-updater/src/managers/base.ts#L31) prints `[DRY-RUN] Would run: <command>` and returns `status: 'success'` with `durationMs: 0` without invoking `safeExec`.
3. **Privilege Pre-Checks**:
   - `MacPortsManager` and `AptManager` run `sudo -n true` (timeout: 3,000ms) before executing privileged operations. If non-interactive sudo is unavailable, they fail fast with clear instructions (`Run "sudo -v" before uup`) instead of hanging the process.
4. **Major Semver Upgrades (Bun & Yarn)**:
   - `BunManager`: Runs `bun add -g <pkg>@latest` prior to `bun update -g` to bypass semver restrictions in `~/.bun/install/global/package.json`.
   - `YarnManager`: Runs `yarn global add <pkg>@latest` prior to `yarn global upgrade`.
5. **Bun Homebrew Coexistence**:
   - `BunManager` checks `which bun`. If located in `/opt/homebrew` or `/Cellar`, `bun upgrade` is skipped (or marked skipped if attempted) to avoid corrupting Homebrew formula linkages.
6. **npm Multi-Tier Resilient Strategy**:
   - `NpmManager` targets outdated packages directly via `npm install -g --legacy-peer-deps <pkg>@<version>`.
   - If batch installation fails (e.g. peer dependency resolution conflicts across packages), it automatically falls back to isolated per-package installation so that problematic packages do not block valid packages.
   - If an individual package installation fails due to install script failures (such as package-manager enforce scripts like `npx only-allow pnpm`), it retries once with `--ignore-scripts`.
   - Batch fallback trigger steps are not counted as package failures when subsequent per-package steps succeed.
7. **Sanitized Error Extraction**:
   - Error message reporting uses `extractErrorMessage()` to filter out ambient warnings (`npm warn`, `warning:`, `notice`) from stderr, surfacing only actionable error statements to avoid misleading diagnostics.

---

## 6. Non-Functional Requirements

1. **Safety**: Commands are spawned with non-interactive flags (`CI=true`, `DEBIAN_FRONTEND=noninteractive`, `stdin: 'ignore'`). Commands must never block indefinitely waiting for user TTY input.
2. **Observability**: Subprocess output is captured via line-by-line streaming. Spinners and progress reporters display live elapsed time and persistent completion markers per step.
3. **Execution Safety**: All execution steps default to a 180-second timeout per command (`options.timeoutMs ?? 180000`).
4. **Idempotence**: Running `uup` repeatedly on an already updated system performs a non-destructive read-only check and exits cleanly.
5. **Minimalist Aesthetic**: Tabular updates and execution feedback emphasize clean typography, subtle borders, high contrast indicators, and persistent status lines.

