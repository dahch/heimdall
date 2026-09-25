# Architecture Decision Records (ADR) — Universal Updater

This document captures key architectural and design decisions made in Universal Updater (`uup`), including context, evaluation, trade-offs, and consequences.

---

## Index of Architectural Decisions

| ADR ID | Title | Status | Date |
| :--- | :--- | :---: | :---: |
| [ADR 001](#adr-001-provideradapter-architecture-for-package-managers) | Provider/Adapter Architecture for Package Managers | **Accepted** | 2026-09-03 |
| [ADR 002](#adr-002-bypassing-major-semver-range-restrictions-in-bun-and-yarn-global-packages) | Bypassing Major Semver Range Restrictions in Bun and Yarn Global Packages | **Accepted** | 2026-09-03 |
| [ADR 003](#adr-003-deprecating-and-skipping-apple-system-ruby-usrbinruby-gem) | Deprecating and Skipping Apple System Ruby (`/usr/bin/gem`) | **Accepted** | 2026-09-03 |
| [ADR 004](#adr-004-native-http-registry-checks-over-subprocess-spawning-yarn--pipx) | Native HTTP Registry Checks Over Subprocess Spawning (Yarn & Pipx) | **Accepted** | 2026-09-03 |

---

## ADR 001: Provider/Adapter Architecture for Package Managers

### Status
**Accepted**

### Context
Universal Updater must coordinate updates across 10+ heterogeneous package managers spanning operating system packages (Homebrew, MacPorts, APT, Flatpak), runtime managers (npm, pnpm, Bun, Yarn), language environments (pip, pipx, cargo, gem), and GUI app stores (mas).

Each manager exhibits drastically different characteristics:
- Diverse discovery mechanisms (CLI binaries, environment variables, toolchain presence).
- Non-standard outdated reporting formats (JSON schemas, ASCII markdown tables, custom plaintext outputs, or lack of outdated flags).
- Heterogeneous execution models (multi-step recipes, elevated root/sudo requirements, interactive prompt risks, self-upgrades vs package upgrades).

Hardcoding update workflows into a central procedural script would lead to tightly coupled, brittle spaghetti code that is difficult to test, maintain, or extend.

### Decision
We adopted an object-oriented **Provider / Adapter Pattern** anchored by an abstract base class [`BasePackageManager`](src/managers/base.ts#L13) implementing the [`PackageManager`](src/types.ts#L58-L67) interface.

Key elements of this architecture include:
1. **Uniform Lifecycle Contract**:
   - `isAvailable(): Promise<boolean>`: Non-throwing discovery check.
   - `checkUpdates(options?: CheckOptions): Promise<CheckResult>`: Read-only scan returning normalized [`UpdateItem`](src/types.ts#L3-L11) records.
   - `executeUpdate(items: UpdateItem[], options: ExecutionOptions): Promise<UpdateExecutionResult>`: Execution routine returning detailed step metrics.
2. **Template Method for Step Execution**:
   - [`BasePackageManager.executeStep()`](src/managers/base.ts#L31) encapsulates subprocess timeouts (default 180s), stdout/stderr streaming callbacks, and dry-run branching across all adapters.
3. **Registry & Filtering Decoupling**:
   - Managers are instantiated in [`src/managers/registry.ts`](src/managers/registry.ts) via `createDefaultManagers()` and filtered by ID/name via `filterManagers()`. The core [`UpdaterEngine`](src/core/engine.ts#L15) operates strictly against `PackageManager[]`.

### Consequences

#### Positive:
- **High Cohesion & Extensibility**: Adding a new package manager requires only subclassing `BasePackageManager` and registering it in `registry.ts`. Core engine code remains untouched (Open/Closed Principle).
- **Isolated Unit Testing**: Each adapter's parsing and execution routine can be unit tested in complete isolation using Vitest mocks without invoking external system binaries (see [`tests/managers.test.ts`](tests/managers.test.ts)).
- **Consistent Dry-Run Semantics**: Because dry-run logic is handled inside `BasePackageManager.executeStep()`, all adapters automatically inherit mock execution without duplicate boilerplate.

#### Negative / Trade-offs:
- Requires minor class boilerplate for each new manager.
- Adapters must adhere strictly to the `safeExec` error handling model to avoid leaking exceptions.

---

## ADR 002: Bypassing Major Semver Range Restrictions in Bun and Yarn Global Packages

### Status
**Accepted**

### Context
Both Bun (`bun`) and Yarn v1 (`yarn`) maintain internal package manifests for globally installed packages:
- Bun persists global dependencies in `~/.bun/install/global/package.json`.
- Yarn v1 persists global dependencies in `~/.config/yarn/global/package.json`.

When a package is installed globally (e.g. `bun add -g eslint@^8.0.0` or `yarn global add typescript@^4.0.0`), the manifest pins or bounds the version according to standard SemVer caret/tilde rules.

When invoking standard global update commands:
- `bun update -g`
- `yarn global upgrade`

Both package managers intentionally refuse to upgrade packages across major version boundaries (e.g. ESLint `8.57.0` -> `9.0.0`), reporting them as "up to date" or ignoring the newer major version. In an administrative updater whose purpose is to bring all tools to their newest release, this leaves global tooling silently outdated.

### Decision
In [`BunManager`](src/managers/bun.ts#L104-L121) and [`YarnManager`](src/managers/yarn.ts#L113-L128), we structure the execution phase into a multi-step routine:

1. **Step 1 (Explicit Latest Pinning)**: For every outdated package identified during the check phase, construct explicit `@<latest>` targets and execute:
   - Bun: `bun add -g <pkg1>@<latest> <pkg2>@<latest> ...`
   - Yarn: `yarn global add <pkg1>@<latest> <pkg2>@<latest> ...`
   This overwrites the SemVer constraint in their global `package.json` files and forces resolution to the latest registry version.
2. **Step 2 (Transitive Upgrade)**: Follow up with the standard update command:
   - Bun: `bun update -g`
   - Yarn: `yarn global upgrade`
   This updates any unpinned or transitive dependencies and synchronizes the lockfile.

### Consequences

#### Positive:
- Global packages reliably update across major version increments (e.g. ESLint 8 -> 9, TypeScript 4 -> 5).
- Matches user expectations of an administrative universal updater.
- Retains lockfile and transitive dependency consistency.

#### Negative / Trade-offs:
- Requires an additional execution step (`add -g` followed by `update -g`). However, the overhead is negligible compared to the network installation time.

---

## ADR 003: Deprecating and Skipping Apple System Ruby (`/usr/bin/gem`)

### Status
**Accepted**

### Context
macOS ships with a legacy system installation of Ruby and RubyGems located at `/usr/bin/ruby` and `/usr/bin/gem`.

On macOS 10.15 (Catalina) and later:
1. **System Integrity Protection (SIP)**: The root filesystem and `/System/Library` are mounted as read-only.
2. **Missing C Headers & Toolchain**: Apple's system Ruby environment lacks headers required to compile native C gems.
3. **Permission Denial**: Executing `gem update` or `gem update --user-install` against `/usr/bin/gem` results in terminal hangs, infinite permission loops, or compile crashes when building gems like `nokogiri` or `eventmachine`.
4. **Apple Deprecation Notice**: Apple has officially marked built-in scripting runtimes as deprecated and unmaintained for user workloads.

### Decision
In [`RubyGemManager.isAvailable()`](src/managers/gem.ts#L20-L33), we inspect the absolute binary path using `which gem`:

```typescript
const whichRes = await safeExec('which', ['gem'], { timeoutMs: 3000 });
const gemPath = whichRes.stdout.trim();
if (gemPath === '/usr/bin/gem' || gemPath.startsWith('/System/Library')) {
  return false;
}
```

If `which gem` points to `/usr/bin/gem` or any path under `/System/Library`, `isAvailable()` returns `false`, causing `uup` to cleanly skip Ruby Gem updates.

Only user-managed Ruby installations (installed via Homebrew at `/opt/homebrew/bin/gem` or `/usr/local/bin/gem`, or version managers such as `rbenv`, `rvm`, `chruby`, or `asdf`) are recognized as active package managers.

### Consequences

#### Positive:
- Completely eliminates unexplained build errors, permission denials, and SIP conflicts on macOS machines.
- Users who intentionally install and maintain modern Ruby via Homebrew or version managers retain 100% full update functionality.
- Fails cleanly and silently during the discovery phase without showing frightening error messages.

#### Negative / Trade-offs:
- Users attempting to manage gems solely with Apple's default system Ruby will not have those gems updated by `uup`. However, updating system gems without a custom toolchain is unsupported by macOS and broken by design.

---

## ADR 004: Native HTTP Registry Checks Over Subprocess Spawning (Yarn & Pipx)

### Status
**Accepted**

### Context
Certain package managers lack native CLI commands to output outdated packages in machine-readable JSON:
1. **Yarn v1**: `yarn outdated` only inspects project-level directories containing a `package.json`. `yarn global list --depth=0` lists installed global packages, but does not check registry versions.
2. **pipx**: `pipx list --json` outputs all isolated virtual environments and installed package versions, but does not query PyPI for newer versions (`pipx upgrade-all` exists, but there is no dry-run or inspection query command).

Initially, checking latest versions required spawning external CLI subprocesses for each installed package (e.g. `npm view <pkg> version` or `pip index versions <pkg>`).

On developer machines with 20+ global Yarn packages or 15+ pipx CLI tools, spawning sequential or unbounded child processes resulted in:
- High latency (10–25+ seconds spent spawning Node/Python subprocesses).
- Heavy CPU overhead and thread exhaustion.
- External dependency on `npm` being present to query Yarn packages.

### Decision
We replaced CLI child process spawning with **direct HTTP queries to public registry JSON endpoints** using Node's built-in `fetch` and `AbortSignal.timeout(3000)`:

1. **Yarn Global Packages** ([`src/managers/yarn.ts`](src/managers/yarn.ts#L53-L81)):
   - Query endpoint: `https://registry.npmjs.org/<pkg>/latest`
   - Scoped packages (e.g. `@angular/cli`) are URL-encoded (`%40angular/cli`).
2. **pipx Applications** ([`src/managers/pipx.ts`](src/managers/pipx.ts#L56-L84)):
   - Query endpoint: `https://pypi.org/pypi/<pkg>/json`
   - Version extraction: `data.info.version`.

All package queries are dispatched in parallel via `Promise.all` with a strict 3-second timeout and individual try/catch error suppression.

### Consequences

#### Positive:
- **Over 80–90% Latency Reduction**: Inspecting 20 global packages drops from ~15 seconds to under 800 milliseconds.
- **Decoupled Architecture**: Checking Yarn outdated packages no longer requires the `npm` binary to be installed on the system.
- **Resource Efficiency**: HTTP connection pooling in Node.js consumes negligible memory and CPU compared to child process forks.
- **Zero Orphaned Subprocesses**: Even if a registry hangs, `AbortSignal.timeout(3000)` aborts the network socket cleanly without leaving runaway processes.

#### Negative / Trade-offs:
- Relies on outbound HTTPS access to `registry.npmjs.org` and `pypi.org`. If an enterprise uses private npm/pip mirrors without standard environment variables or proxy setups, direct HTTP requests might fail. However, failures are caught gracefully and will simply skip reporting those updates rather than failing the scan.

---

## ADR-005: Targeted npm Package Updates with Multi-Tier Fallback and `--ignore-scripts` Recovery

- **Status**: Accepted
- **Context**: In environments with numerous global npm packages, executing monolithic `npm update -g --legacy-peer-deps` frequently takes ~60 seconds and fails completely if ANY global package encounters peer dependency resolution errors, engine warnings, or broken preinstall scripts (e.g. `npx only-allow pnpm` inside transitive dependencies like `ip-set` in `torlnk`). Furthermore, standard stderr output includes non-fatal `npm warn` notices that obscure the actual error cause when reported to users.
- **Decision**:
  1. `NpmManager` executes targeted installations for only the packages identified during `checkUpdates()`: `npm install -g --legacy-peer-deps -- <pkg>@<latest>`. If multiple packages are pending, it runs targeted batch installation; if only 1 package is pending, it executes isolated installation directly.
  2. Targets are delimited using POSIX `--` argument separation to prevent package specifiers or scoped packages from colliding with npm CLI options.
  3. If batch installation fails, it seamlessly falls back to isolated per-package installation.
  4. If an individual package install fails with a script error, it retries once with `--ignore-scripts -- <target>` to bypass non-essential scripts (such as package manager enforcement hooks).
  5. The initial batch failure is treated as a fallback trigger (`status: 'skipped'`) rather than counting as failed package steps if fallback resolves packages.
  6. Error output is filtered through a dedicated `extractErrorMessage()` utility that filters out `npm warn`/`warning:` lines and extracts genuine error lines.
- **Consequences**:
  - Positive: Execution time drops by up to 90% (from ~64s to <5s). Resilient recovery from install-script failures (e.g. `torlnk`). Clean, actionable error reporting without truncated warning brackets.
  - Trade-off: `--ignore-scripts` is only applied as a last-resort fallback for individual packages when the initial install fails.

---

## ADR-006: Minimalist Modern UI/UX with Persistent Real-Time Step Progression

- **Status**: Accepted
- **Context**: The existing CLI interface relied on heavy full-border ASCII tables (`cli-table3` default grid) and a single transient spinner line that flickered during concurrent discovery and hid intermediate step durations during execution. Users requested a refined, modern, minimalist aesthetic with clear and constant feedback.
- **Decision**:
  1. Introduce a refined header banner with clean typography and version badges.
  2. Format the pending updates table with micro-borders, clean column alignment, category badges, and version diff arrows (`1.8.0 → 1.9.0`).
  3. During execution, display persistent indented step marks (`✔ brew update (1.3s)`) so the user maintains a continuous visual log of completed steps.
  4. Present execution summaries with exact package counts (`5/6 updated, 1 failed` instead of ambiguous totals) and clean error summaries.
- **Consequences**:
  - Positive: Drastically improved legibility, modern aesthetic comparable to modern developer tooling (Vite, Bun, Turborepo), zero flickering, and crystal-clear feedback at every step.
  - Trade-off: Requires custom formatting utilities alongside `cli-table3` configuration.

---

## ADR-007: Homebrew Non-Redundant Targeted Upgrade by Package Classification

- **Status**: Accepted
- **Context**: In macOS environments using Homebrew, `brew upgrade` updates both formulae and casks, while `brew upgrade --cask` updates only casks. Executing `brew upgrade` followed unconditionally by `brew upgrade --cask` is redundant and wasteful when only one category has pending updates. When only GUI casks (e.g. Raycast, Docker) require updates, running a full `brew upgrade` forces Homebrew to unnecessarily traverse formula dependency graphs and evaluate bottled formulas, adding 15–45 seconds of needless overhead.
- **Decision**:
  1. `HomebrewManager` inspects the classification (`type === 'cask'` vs `type === 'formula'`) of outdated items detected during `checkUpdates()`.
  2. If only casks are pending (`hasCasks && !hasFormulae`), it executes targeted `brew upgrade --cask`.
  3. If only formulae are pending (`hasFormulae && !hasCasks`), it executes targeted `brew upgrade --formula`.
  4. If both categories (or unclassified packages) are pending, it falls back to full `brew upgrade`.
  5. Both paths run `brew update` beforehand and `brew cleanup` afterwards.
  6. The `updatedCount` metric accurately reflects package updates only when the actual upgrade step succeeds (`upgradeSucceeded ? items.length : 0`).
- **Consequences**:
  - Positive: Eliminates redundant upgrade passes, significantly shortening execution times when updating only casks or only formulae.
  - Trade-off: None; formula and cask classifications are reliably provided by `brew outdated --json=v2`.

