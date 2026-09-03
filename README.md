# Universal Updater (`uup`)

> A dynamic, resilient, and modern CLI to inspect, validate, and update system packages, runtimes, and global tools across macOS and Linux.

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
- 🎨 **Modern Animated UX**: Terminal interface powered by `@clack/prompts`, live spinners with truncated streaming progress output, color-coded version diffs, and structured execution summaries.
- ⚙ **Flexible Targeting**: Run interactively, execute non-interactively with `--yes`, or filter target managers using `--only` and `--exclude`.

---

## 📦 Supported Package Managers

`uup` supports 11 package managers across system, runtime, language, and application store categories:

| Manager | Icon | Category | Detection Strategy | Update Routine & Resilience Rules |
| :--- | :---: | :---: | :--- | :--- |
| **[Homebrew](https://brew.sh)** | 🍺 | `system` | `brew outdated --json=v2` (JSON parsing with raw text fallback) | 1. `brew update`<br>2. `brew upgrade`<br>3. `brew upgrade --cask`<br>4. `brew cleanup` |
| **[npm (global)](https://www.npmjs.com)** | 📦 | `runtime` | `npm outdated -g --json` (tolerates exit code 1) | 1. `npm update -g --legacy-peer-deps`<br>2. Explicit `npm install -g --legacy-peer-deps <pkg>@latest` for major bumps.<br>3. *Fallback*: If bulk update fails due to peer conflicts, automatically falls back to isolated per-package upgrades. |
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

### Prerequisites
- Node.js >= 20.0.0
- pnpm (recommended) or npm

### Local Development Setup

```bash
# Clone repository
git clone https://github.com/user/universal-updater.git
cd universal-updater

# Install dependencies
pnpm install

# Build binary with tsup
pnpm build

# Link binary globally
npm link
```

After linking, both `uup` and `universal-updater` will be available in your terminal.

---

## 💻 CLI Usage

```bash
uup [options]
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
| `-V` | `--version` | Output current version | `1.0.0` |

### Usage Examples

```bash
# 1. Standard Interactive Workflow
# Discovers managers, scans updates, presents color table, prompts for choice
uup

# 2. Dry-run Mode
# Discovers managers, scans updates, runs simulated steps through the engine
uup --dry-run

# 3. Automated Routine (ideal for CI, cron jobs, or shell scripts)
uup --yes

# 4. Target Specific Package Managers
uup --only brew,npm,bun

# 5. Exclude Slow or Privileged Managers
uup --exclude macports,apt

# 6. Adjust Check Timeout & Enable Verbose Diagnostic Logging
uup --timeout 40000 --verbose
```

---

## 🧪 Testing

The test suite is powered by [Vitest](https://vitest.dev/) and provides comprehensive unit coverage for parser routines, engine concurrency, timeout isolation, and manager fallback logic:

```bash
# Run test suite
pnpm test

# Run tests in watch mode
pnpm vitest
```

Test coverage includes:
- JSON and text parser edge cases (npm exit code 1, mixed pnpm CLI output, bun table formats).
- Concurrency pool bounds and error isolation in [`UpdaterEngine`](file:///Volumes/DahchDev/projects/universal-updater/src/core/engine.ts).
- Pre-check behaviors (skipping `/usr/bin/gem`, sudo privilege checks for MacPorts and APT).
- HTTP registry lookup error handling for Yarn and pipx.

---

## 📄 Documentation

- [SPEC.md](SPEC.md): Technical specification, CLI contract, data models, and exit codes.
- [DESIGN.md](DESIGN.md): System architecture, Two-Phase workflow, Engine concurrency pool, and Mermaid diagrams.
- [ADR.md](ADR.md): Architectural Decision Records documenting key engineering decisions.
- [AGENTS.md](AGENTS.md): Developer and AI agent reference manual for maintaining and extending the codebase.

---

## 📜 License

MIT © [Daniel Hernández](https://github.com)
