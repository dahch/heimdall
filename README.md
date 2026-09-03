# Universal Updater (`uup`)

> A dynamic, resilient, and modern CLI to validate and update system packages, runtimes, and global packages in macOS and Linux.

---

## ✨ Features

- 🔍 **Dynamic Discovery**: Automatically discovers which package managers are installed in the host system.
- 🛡 **Extremely Resilient**: If a package manager is missing or a network check times out, it skips it cleanly without failing or crashing.
- 📋 **Two-Phase Workflow**:
  1. **Validation & Check**: Concurrently queries all detected package managers for outdated packages.
  2. **Aggregated Review & Confirmation**: Shows a unified table with current vs latest versions, package managers, and types. Prompts for general confirmation before applying any changes.
- 🎨 **Modern Animated UX**: Interactive prompts via `@clack/prompts`, live spinners, colorized version diffs, and structured execution summary.
- ⚙ **Selective Updates**: Choose to update everything at once, pick specific package managers interactively, or filter via flags.

---

## 📦 Supported Package Managers

| Manager | Icon | Outdated Check | Update Routine |
| :--- | :---: | :--- | :--- |
| **Homebrew** | 🍺 | `brew outdated --json=v2` | `brew update && brew upgrade && brew upgrade --cask && brew cleanup` |
| **npm (global)** | 📦 | `npm outdated -g --json` | `npm update -g` (+ major bumps) |
| **pnpm (global)** | ⚡ | `pnpm outdated -g --format json` | `pnpm update -g --latest` |
| **Bun** | 🍞 | `bun outdated -g` | `bun update -g && bun upgrade` |
| **Yarn (global)** | 🧶 | `yarn global list --depth=0` | `yarn global upgrade` |
| **Python (pip)** | 🐍 | `pip3 list --user --outdated --format=json` | `pip3 install --user --upgrade <pkgs>` |
| **pipx** | 📦 | `pipx list --json` | `pipx upgrade-all` |
| **Rust / Cargo** | 🦀 | `rustup check` / `cargo install-update -l` | `rustup update && cargo install-update -a` |
| **Ruby Gem** | 💎 | `gem outdated` | `gem update --user-install && gem cleanup` |
| **MacPorts** | ⚓ | `port outdated` | `sudo port selfupdate && sudo port upgrade outdated` |
| **Mac App Store** | 🍎 | `mas outdated` | `mas upgrade` |
| **APT (Linux)** | 🐧 | `apt list --upgradable` | `sudo apt-get update && sudo apt-get upgrade -y` |
| **Flatpak** | 📦 | `flatpak remote-ls --updates` | `flatpak update -y` |

---

## 🚀 Installation & Usage

### Running Locally

```bash
# Clone and install dependencies
pnpm install

# Build
pnpm build

# Link globally to use `uup` anywhere
npm link
```

### Usage Commands

```bash
# Standard interactive run: scans, presents summary table, asks confirmation
uup

# Dry-run: view pending updates without modifying anything
uup --dry-run

# Auto-confirm mode (ideal for automation or scripts)
uup --yes

# Target only specific managers
uup --only brew,npm

# Exclude specific managers
uup --exclude gem,macports

# Enable detailed verbose streaming logs
uup --verbose

# Custom timeout for network checks (in milliseconds)
uup --timeout 30000
```

---

## 🧪 Testing

```bash
pnpm test
```

Suite runs using `vitest` covering parser routines, resilient execution timeouts, and engine aggregation.
