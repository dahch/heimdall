# Heimdall (`hmd`)

> A dynamic, resilient, and modern CLI to inspect, validate, and update system packages, runtimes, and global tools across macOS and Linux.

[![npm version](https://img.shields.io/npm/v/@dahch/heimdall.svg)](https://www.npmjs.com/package/@dahch/heimdall)
[![CI / Publish](https://github.com/dahch/heimdall/actions/workflows/publish.yml/badge.svg)](https://github.com/dahch/heimdall/actions/workflows/publish.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-ES2022-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20.0.0-green.svg)](https://nodejs.org/)
[![Vitest](https://img.shields.io/badge/Tested%20with-Vitest-yellow.svg)](https://vitest.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-purple.svg)](LICENSE)

---

## ✨ Features

- 🔍 **Dynamic Discovery**: Automatically identifies which package managers are installed on the host operating system without requiring static machine configuration.
- 🛡 **Extremely Resilient**: Network timeouts, missing binaries, or individual package build errors are isolated gracefully. If one package or manager encounters an issue, all other managers continue uninterrupted.
- 📋 **Two-Phase Workflow**:
  1. **Detection & Bounded Scan**: Available package managers are checked concurrently using an internal worker pool (concurrency limit of 4) to query pending updates without overloading CPU or network.
  2. **Aggregated Review & Confirmation**: Shows an interactive tabular overview comparing current and latest package versions across all managers, prompting for confirmation before modifying the system.
- 🧪 **True Simulated Dry-Run (`--dry-run`)**: Traverses the full engine lifecycle, formats outdated packages, and executes mock update routines step-by-step with real-time feedback without touching system files.
- ⚡ **High-Speed Registry Queries**: Yarn and pipx bypass heavy CLI subprocess spawning by querying the npm Registry and PyPI JSON APIs directly over HTTP with strict 3-second abort timeouts.
- 🔐 **Non-Interactive Sudo Pre-Checks**: Privileged managers (MacPorts, Linux APT) verify cached credentials using `sudo -n true` beforehand, preventing terminal lockups and password prompt hangs.
- 🎨 **Modern Minimalist UX**: Terminal interface powered by `@clack/prompts`, micro-border tabular layouts with directional version transitions (`current → latest`), persistent real-time step progression with elapsed durations, and actionable error extraction.
- 🏷 **Dynamic Version Resolution**: Reads package name and version dynamically from `package.json` at runtime via `import.meta.url`, ensuring banners and `--version` flags remain in sync with repository releases.
- ⚙ **Flexible Targeting**: Run interactively, execute non-interactively with `--yes`, or filter target managers using `--only` and `--exclude`.

---

## 📦 Supported Package Managers

Heimdall (`hmd`) supports 13 package managers across system, runtime, language, and application store categories:

| Manager | Icon | Category | Detection Strategy | Update Routine & Resilience Rules |
| :--- | :---: | :---: | :--- | :--- |
| **[Homebrew](https://brew.sh)** | 🍺 | `system` | `brew outdated --json=v2` (JSON parsing with raw text fallback) | 1. `brew update`<br>2. Selective upgrade based on pending item types: `brew upgrade --cask` (if only casks), `brew upgrade --formula` (if only formulae), or full `brew upgrade` (if both)<br>3. `brew cleanup` |
| **[npm (global)](https://www.npmjs.com)** | 📦 | `runtime` | `npm outdated -g --json` (tolerates exit code 1) | 1. Targeted install: `npm install -g --legacy-peer-deps -- <targets>` (batched if multiple, direct if single)<br>2. *Fallback*: If batch install hits peer conflicts, falls back to isolated per-package installs.<br>3. *Script Resilience*: Retries failing packages with `--ignore-scripts -- <target>` if install lifecycle hooks fail (e.g. `only-allow pnpm`). |
| **[pnpm (global)](https://pnpm.io)** | ⚡ | `runtime` | `pnpm outdated -g --format json` (extracts embedded JSON chunks) | `pnpm update -g --latest` |
| **[Bun](https://bun.sh)** | 🍞 | `runtime` | `bun outdated -g` (ASCII table column parser) | 1. `bun add -g <pkg>@latest` (bypasses global semver pin lockouts)<br>2. `bun update -g`<br>3. `bun upgrade` (automatically skipped if Bun is managed via Homebrew) |
| **[Yarn (global)](https://yarnpkg.com)** | 🧶 | `runtime` | `yarn global list --depth=0` + native npm registry HTTP checks | 1. `yarn global add <pkg>@latest` (bypasses global semver lockouts)<br>2. `yarn global upgrade` |
| **[Python (pip user)](https://pip.pypa.io)** | 🐍 | `language` | `pip3 list --user --outdated --format=json` (targets user site-packages) | `pip3 install --user --upgrade <pkgs>` (complies with PEP 668 externally managed environment protections) |
| **[pipx](https://pipx.pypa.io)** | 📦 | `language` | `pipx list --json` + native PyPI JSON API lookups | `pipx upgrade-all` |
| **[Rust (Cargo & Rustup)](https://doc.rust-lang.org/cargo/)** | 🦀 | `language` | `rustup check` (toolchains) + `cargo install-update -l` (crates) | 1. `rustup update` (if `rustup` exists)<br>2. `cargo install-update -a` (if `cargo-update` is installed) |
| **[Ruby Gem](https://rubygems.org)** | 💎 | `language` | `gem outdated` (skips deprecated Apple System Ruby `/usr/bin/gem`) | 1. `gem update --user-install`<br>2. `gem cleanup` |
| **[MacPorts](https://www.macports.org)** | ⚓ | `system` | `port outdated` + non-interactive `sudo -n true` verification | 1. `sudo port selfupdate`<br>2. `sudo port upgrade outdated` |
| **[Mac App Store (mas)](https://github.com/mas-cli/mas)** | 🍎 | `appstore` | `mas outdated` | `mas upgrade` |
| **[APT (Debian/Ubuntu)](https://wiki.debian.org/Apt)** | 🐧 | `system` | `apt list --upgradable` + non-interactive `sudo -n true` check | 1. `sudo apt-get update -y`<br>2. `sudo apt-get upgrade -y`<br>3. `sudo apt-get autoremove -y` |
| **[Flatpak](https://flatpak.org)** | 📦 | `system` | `flatpak remote-ls --updates` | `flatpak update -y --noninteractive` |

---

## 🚀 Installation & Setup

### Global Installation

```bash
npm install -g @dahch/heimdall
# or
bun add -g @dahch/heimdall
# or
pnpm add -g @dahch/heimdall
```

### Prerequisites
- Node.js >= 20.0.0
- Bun or pnpm or npm

### Local Development Setup

```bash
# Clone repository
git clone https://github.com/dahch/heimdall.git
cd heimdall

# Install dependencies
bun install
# or: pnpm install

# Build binary with tsup
bun run build
# or: pnpm build

# Link binary globally
npm link
```

After linking, both `hmd` (primary short command) and `heimdall` (canonical alias) will be available in your terminal.

---

## 💻 CLI Usage

```bash
hmd [options]
# Or using the canonical alias:
heimdall [options]
```

### Options Reference

| Flag | Long Flag | Description | Default |
| :--- | :--- | :--- | :--- |
| `-y` | `--yes` | Skip confirmation prompt and apply all detected updates automatically | `false` |
| `-d` | `--dry-run` | Inspect outdated packages and simulate update execution without modifying the host | `false` |
| `-o` | `--only <mgrs>` | Comma-separated list of managers to include (e.g. `brew,npm,bun`) | *All available* |
| `-x` | `--exclude <mgrs>` | Comma-separated list of managers to exclude (e.g. `gem,macports`) | *None* |
| `-t` | `--timeout <ms>` | Network/subprocess timeout per check phase in milliseconds | `25000` |
| `-v` | `--verbose` | Output detailed diagnostic messages and skipped manager listings | `false` |
| `-h` | `--help` | Display command help and option summary | — |
| `-V` | `--version` | Output CLI version (dynamically resolved from `package.json`) | Dynamic |

### Usage Examples

```bash
# 1. Standard Interactive Workflow
# Discovers managers, scans updates, presents color table, prompts for choice
hmd

# 2. Dry-run Mode
# Discovers managers, scans updates, runs simulated steps through the engine
hmd --dry-run

# 3. Automated Routine (ideal for CI, cron jobs, or shell scripts)
hmd --yes

# 4. Target Specific Package Managers
hmd --only brew,npm,bun

# 5. Exclude Slow or Privileged Managers
hmd --exclude macports,apt

# 6. Adjust Check Timeout & Enable Verbose Diagnostic Logging
hmd --timeout 40000 --verbose

# 7. Using the Canonical Alias
heimdall --dry-run
```

---

## 🧪 Testing

The test suite is powered by [Vitest](https://vitest.dev/) and provides comprehensive unit coverage for parser routines, engine concurrency, timeout isolation, and manager fallback logic:

```bash
# Run test suite (Vitest)
bun run test # or: pnpm test

# Run static typecheck
bun run typecheck
```

Test coverage includes:
- JSON and text parser edge cases (npm exit code 1, mixed pnpm CLI output, bun table formats).
- Error extraction and sanitization ([`extractErrorMessage`](src/utils/formatting.ts#L6)) handling npm warnings, command failure chains, and clean truncation.
- Concurrency pool bounds and error isolation in [`UpdaterEngine`](src/core/engine.ts).
- `NpmManager` targeted batch installation, fallback trigger handling, and `--ignore-scripts` resilience.
- `HomebrewManager` selective formula vs. cask execution branches.
- Pre-check behaviors (skipping `/usr/bin/gem`, sudo privilege checks for MacPorts and APT).
- HTTP registry lookup error handling for Yarn and pipx.
- Formatting renderers (micro-border table, directional version diffs, execution summary metrics).

---

## 🚀 Release & Publishing Pipeline

Heimdall employs an automated GitHub Actions CI/CD workflow ([`.github/workflows/publish.yml`](.github/workflows/publish.yml)) for publishing to npm:

1. **Tag-Driven Trigger**: Releases trigger on git tag pushes matching `v*` (e.g. `v1.0.0`).
2. **Version Verification**: Verifies tag name strictly matches the `version` field in `package.json`.
3. **Reproducible Build**: Installs dependencies with `bun install --frozen-lockfile` and builds the bundle via `bun run build`.
4. **Verification Gates**: Runs the test suite and static typecheck via `bun run test && bun run typecheck`.
5. **NPM Provenance**: Publishes to npm under `@dahch/heimdall` with cryptographic provenance attestations (`npm publish --provenance`) via OpenID Connect (OIDC).

---

## 📄 Documentation

- [SPEC.md](SPEC.md): Technical specification, CLI contract, data models, and exit codes.
- [DESIGN.md](DESIGN.md): System architecture, Two-Phase workflow, Engine concurrency pool, and Mermaid diagrams.
- [ADR.md](ADR.md): Architectural Decision Records (ADR-001 through ADR-009) documenting key engineering decisions.
- [AGENTS.md](AGENTS.md): Developer and AI agent reference manual for maintaining and extending the codebase.

---

## 📜 License

MIT © [Daniel Hernández](https://github.com)
