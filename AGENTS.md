# Developer & AI Agent Reference Manual (`AGENTS.md`)

## 1. Purpose & Scope

This manual serves as the technical reference for AI agents and software engineers contributing to, refactoring, or extending the **Heimdall (`hmd`)** codebase.

Heimdall is an asynchronous, resilient, multi-manager updater written in TypeScript (ESM) targeting Node.js >= 20. It runs on macOS and Linux, unifying package management across system tools, language ecosystems, runtimes, and app stores.

---

## 2. Codebase Architecture & File Map

```
universal-updater/
├── src/
│   ├── cli.ts                # CLI entry point, Commander flag parsing, Clack interactive UI
│   ├── types.ts              # Canonical TypeScript interfaces and data models
│   ├── core/
│   │   └── engine.ts         # Orchestrator: availability scanning, concurrency pool, execution loop
│   ├── managers/
│   │   ├── base.ts           # Abstract BasePackageManager (executeStep, dry-run branching)
│   │   ├── registry.ts       # Manager registry factory and include/exclude filtering
│   │   ├── homebrew.ts       # Homebrew adapter (selective formula/cask upgrade, cleanup)
│   │   ├── npm.ts            # npm global adapter (targeted batch, isolated fallback, --ignore-scripts retry)
│   │   ├── pnpm.ts           # pnpm global adapter
│   │   ├── bun.ts            # Bun adapter (explicit add latest, Homebrew skip)
│   │   ├── yarn.ts           # Yarn v1 global adapter (HTTP registry check, add latest)
│   │   ├── python.ts         # Python pip adapter (pip3 user site-packages, PEP 668)
│   │   ├── pipx.ts           # pipx adapter (PyPI JSON API lookups, isolated venvs)
│   │   ├── cargo.ts          # Rust Cargo adapter (rustup toolchains, cargo-install-update)
│   │   ├── gem.ts            # RubyGems adapter (skips Apple system Ruby /usr/bin/gem)
│   │   ├── macports.ts       # MacPorts adapter (sudo -n pre-checks, selfupdate)
│   │   ├── mas.ts            # Mac App Store CLI adapter
│   │   └── linux.ts          # Linux APT and Flatpak adapters
│   └── utils/
│       ├── exec.ts           # safeExec wrapper around execa, commandExists
│       ├── error.ts          # Clean actionable error extractor (extractErrorMessage)
│       ├── formatting.ts     # Duration formatting, cli-table3 and execution summary renderers
│       └── version.ts        # Dynamic package metadata resolution from package.json
├── tests/
│   ├── engine.test.ts        # Unit tests for UpdaterEngine, concurrency pool, and filters
│   ├── exec.test.ts          # Unit tests for safeExec and commandExists
│   ├── formatting.test.ts    # Unit tests for extractErrorMessage and rendering utilities
│   ├── managers.test.ts      # Unit tests for manager parsers, HTTP mocking, and fallback logic
│   └── version.test.ts       # Unit tests for dynamic package metadata and version resolution
├── package.json              # Binaries ("hmd", "heimdall"), dependencies, scripts
├── tsconfig.json             # ES2022, NodeNext module resolution, strict mode
└── tsup.config.ts            # tsup build configuration (ESM output with shebang)
```

---

## 3. Core Architectural Invariants

When modifying or extending the codebase, you **MUST** uphold the following rules:

### 3.1 Strict Non-Interactivity
- Subprocesses spawned by `hmd` must **NEVER** hang waiting for terminal input.
- Always use [`safeExec`](src/utils/exec.ts#L40) which automatically injects `CI=true`, `DEBIAN_FRONTEND=noninteractive`, and `stdin: 'ignore'`.
- If invoking commands that accept confirmation flags, explicitly pass `-y`, `--yes`, or `--noninteractive` (e.g. `apt-get -y`, `flatpak update -y`).

### 3.2 Never Leak Unhandled Rejections
- Core operations must never throw uncaught errors.
- Every manager's [`checkUpdates()`](src/types.ts#L65) and [`executeUpdate()`](src/types.ts#L66) must wrap calls in `try / catch` blocks and return structured failure objects (`available: false`, `success: false`, `error: string`).
- In [`UpdaterEngine`](src/core/engine.ts), individual manager errors are isolated so remaining managers complete unimpeded.

### 3.3 Strict Dry-Run Fidelity
- All execution logic must route through [`BasePackageManager.executeStep()`](src/managers/base.ts#L31) or inspect `options.dryRun`.
- When `options.dryRun` is `true`, no destructive shell commands may be executed. `executeStep` logs `[DRY-RUN] Would run: <command>` and returns `status: 'success'` with `durationMs: 0`.

### 3.4 Explicit Sudo Pre-Verification
- Never invoke `sudo <command>` directly without verifying non-interactive privileges beforehand.
- Follow the pattern established in [`MacPortsManager`](src/managers/macports.ts#L96-L117) and [`AptManager`](src/managers/linux.ts#L90-L111):
  ```typescript
  if (!options.dryRun && process.getuid?.() !== 0) {
    const sudoCheck = await safeExec('sudo', ['-n', 'true'], { timeoutMs: 3000 });
    if (!sudoCheck.success) {
      return {
        managerId: this.id,
        managerName: this.name,
        icon: this.icon,
        success: false,
        updatedCount: 0,
        durationMs: Date.now() - startTime,
        steps: [{ name: 'sudo privileges', command: 'sudo -n true', status: 'failed', error: '...' }],
        error: 'Requires sudo privileges. Run "sudo -v" before hmd.',
      };
    }
  }
  ```

### 3.5 Native HTTP Over N+1 Subprocesses
- When checking outdated packages for tools without bulk outdated commands (e.g. Yarn, pipx), **do not spawn child processes in a loop** (`npm view` or `pip index`).
- Use native `fetch()` against registry endpoints (`registry.npmjs.org`, `pypi.org/pypi/<pkg>/json`) protected by `AbortSignal.timeout(3000)` (see [ADR 004](ADR.md#adr-004-native-http-registry-checks-over-subprocess-spawning-yarn--pipx)).

### 3.6 Major Semver Overrides in Bun and Yarn
- Both `bun update -g` and `yarn global upgrade` refuse to cross major SemVer boundaries due to internal `package.json` constraints.
- You must prepend explicit `add -g <pkg>@latest` steps for outdated items before issuing general update commands (see [ADR 002](ADR.md#adr-002-bypassing-major-semver-range-restrictions-in-bun-and-yarn-global-packages)).

### 3.7 Sanitized Error Extraction
- Raw subprocess stderr output frequently contains ambient warnings (e.g. `npm warn EBADENGINE`), build notices, or truncated JSON brackets that obscure the underlying root cause.
- All step error recording routes through [`extractErrorMessage()`](src/utils/formatting.ts#L6) inside `BasePackageManager.executeStep()`, guaranteeing clean, single-line actionable diagnostics.

### 3.8 Distinguish Fallback Triggers from Real Failures
- When a batch step fails and transparently triggers an isolated per-package fallback (such as in `NpmManager`), mark the batch step as `status: 'skipped'`.
- This ensures that internal fallback triggers are suppressed from user summary cards and do not trigger false-positive manager failure states when subsequent per-package steps succeed.

---

## 4. How to Implement a New Package Manager

Follow this step-by-step recipe to add a new package manager (e.g. `dnf`, `zypper`, `nix`):

### Step 1: Create the Manager Class
Create `src/managers/<id>.ts` extending [`BasePackageManager`](src/managers/base.ts#L13):

```typescript
import { BasePackageManager } from './base.js';
import { safeExec } from '../utils/exec.js';
import type {
  ManagerCategory,
  CheckOptions,
  CheckResult,
  UpdateItem,
  ExecutionOptions,
  UpdateExecutionResult,
  UpdateStep,
} from '../types.js';

export class ExampleManager extends BasePackageManager {
  readonly id = 'example';
  readonly name = 'Example Manager';
  readonly icon = '📦';
  readonly category: ManagerCategory = 'system';
  protected readonly binary = 'example-cli';

  // Override isAvailable() if custom path or environment checks are required
  // async isAvailable(): Promise<boolean> { ... }

  async checkUpdates(options?: CheckOptions): Promise<CheckResult> {
    const startTime = Date.now();
    const isAvail = await this.isAvailable();
    if (!isAvail) {
      return {
        managerId: this.id,
        managerName: this.name,
        icon: this.icon,
        category: this.category,
        available: false,
        updates: [],
        durationMs: 0,
      };
    }

    try {
      const execRes = await safeExec(this.binary, ['check', '--json'], {
        timeoutMs: options?.timeoutMs ?? 25000,
      });

      const updates: UpdateItem[] = [];
      // Parse execRes.stdout into UpdateItem[]

      return {
        managerId: this.id,
        managerName: this.name,
        icon: this.icon,
        category: this.category,
        available: true,
        updates,
        durationMs: Date.now() - startTime,
      };
    } catch (err) {
      return {
        managerId: this.id,
        managerName: this.name,
        icon: this.icon,
        category: this.category,
        available: true,
        updates: [],
        durationMs: Date.now() - startTime,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async executeUpdate(
    items: UpdateItem[],
    options: ExecutionOptions
  ): Promise<UpdateExecutionResult> {
    const startTime = Date.now();
    const steps: UpdateStep[] = [];

    const step = await this.executeStep(
      'example update',
      this.binary,
      ['upgrade', '-y'],
      options
    );
    steps.push(step);

    const success = steps.every((s) => s.status === 'success');

    return {
      managerId: this.id,
      managerName: this.name,
      icon: this.icon,
      success,
      updatedCount: items.length,
      durationMs: Date.now() - startTime,
      steps,
      error: !success ? steps.find((s) => s.status === 'failed')?.error : undefined,
    };
  }
}
```

### Step 2: Register the Manager
Register your new class in [`src/managers/registry.ts`](src/managers/registry.ts):
```typescript
import { ExampleManager } from './example.js';

export function createDefaultManagers(): PackageManager[] {
  return [
    // ... existing managers
    new ExampleManager(),
  ];
}
```

### Step 3: Write Comprehensive Unit Tests
Add parser and execution tests in [`tests/managers.test.ts`](tests/managers.test.ts) using `vi.spyOn(execUtils, 'safeExec')` and `vi.spyOn(manager, 'isAvailable')`.

### Step 4: Verify and Build
Execute test and build suites:
```bash
pnpm test
pnpm build
```

---

## 5. Development & Testing Workflow

### Available Scripts
- `pnpm dev`: Runs CLI in development mode using `tsx` (`tsx src/cli.ts`).
- `pnpm test`: Runs the Vitest test suite once (`vitest run`).
- `pnpm build`: Bundles the CLI using `tsup` into `dist/cli.js`.
- `pnpm start`: Executes the compiled bundle (`node dist/cli.js`).

### Testing Conventions
1. **Mocking Subprocesses**: Never allow unit tests to invoke live system binaries like `brew` or `apt`. Mock [`safeExec`](src/utils/exec.ts#L40) using `vi.spyOn(execUtils, 'safeExec')`.
2. **Mocking HTTP**: Mock global `fetch` using `vi.spyOn(globalThis, 'fetch')` and ensure `mockRestore()` is called after each test.
3. **TypeScript Module Extensions**: Under `"moduleResolution": "NodeNext"`, all relative imports in TypeScript source files must end with the `.js` extension (e.g. `import { safeExec } from '../utils/exec.js';`).
