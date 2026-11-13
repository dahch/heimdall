# Changelog

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### 🚀 Features
- **python**: add `uv` tools adapter (PyPI lookups, cross-major reinstalls)
- **python**: add `poetry` self-update adapter
- **python**: add `conda` adapter driven by the solver dry-run
- **firmware**: add Linux `fwupd` adapter (`refresh` + `get-updates` + `update`, reboot-safe)
- **distro**: detect and offer the next distribution release (Fedora via Bodhi, Ubuntu via `do-release-upgrade -c`, Debian via the stable suite)

### ⚠️ Behavior Changes
- New managers are registered by default and can be targeted with `--only uv,poetry,conda,firmware` (or excluded with `--exclude`).
- `firmware` runs `sudo fwupdmgr refresh --force` and `sudo fwupdmgr update -y --no-reboot-check --no-unreported-check --no-metadata-check`, so pending firmware is applied without rebooting the machine automatically.
- `conda` checks with `conda update --all --dry-run --json` on a 60-second solver budget, even when `--timeout` is lower.
- Every run now ends with a distribution release check: a newer OS release is reported, and applied only after confirmation (or `--upgrade-distro`). `--yes` reports it but never applies it, and Heimdall never reboots: Fedora stages `dnf system-upgrade` and leaves `sudo dnf system-upgrade reboot` to the user.
- New flags: `--no-distro-upgrade` (skip the check) and `-U, --upgrade-distro` (apply without asking).

### 🐛 Bug Fixes
- **npm**: stop reporting the diagnostic `error`/`problems` keys of `npm outdated -g --json` as a package called `error`, and surface the real npm error summary when no update is found.

### 📝 Documentation
- README/SPEC/DESIGN/AGENTS: document the four new managers, the firmware and distribution-release stages, the new flags, and ADR-013/014/015.
- Fix stale source line anchors for `BasePackageManager`, `executeStep`, `DnfManager` and the CLI sudo block.

## [v1.2.0] - 2026-10-15

### 🚀 Features
- **privileges**: acquire sudo interactively before execution ([`7ed7423`]) - Daniel Hernández
- **flatpak**: update user and system installations separately ([`902ffc8`]) - Daniel Hernández

### 🐛 Bug Fixes
- **apt**: stop leaving kept-back packages and gate autoremove ([`977e9c2`]) - Daniel Hernández

### 📝 Documentation
- document interactive sudo acquisition and Flatpak dual scope ([`d24bac0`]) - Daniel Hernández

### ⚠️ Behavior Changes
- Privileged managers (`apt`, `dnf`, `macports`, `flatpak`) request the sudo password once through `sudo -v` on the controlling terminal, with a keep-alive refreshing the ticket during execution. `--dry-run` never prompts, root skips it, and denying privileges is non-fatal: unprivileged managers still complete.
- `flatpak` mirrors its detection split at execution time: `flatpak update --user` runs unprivileged and `sudo flatpak update --system` runs only with root or a cached ticket, reporting `failed` with sudo guidance when system apps exist and `skipped` when none do.
- `apt-get upgrade` runs with `--with-new-pkgs`, so dependency-gaining upgrades are no longer left `kept back` behind a success summary.
- `apt-get autoremove -y` is consent-gated like DNF: prompted interactively, auto-approved with `--yes`, and skipped when declined or after a failed upgrade.

### 📊 Detailed Diff

```
 ADR.md                   |  60 ++++++++
 AGENTS.md                |  34 +++--
 DESIGN.md                |  13 +-
 README.md                |  10 +-
 SPEC.md                  |  20 ++-
 src/cli.ts               | 107 ++++++++------
 src/managers/base.ts     |   9 ++
 src/managers/linux.ts    | 188 +++++++++++++++++++------
 src/managers/macports.ts |  11 +-
 src/types.ts             |   1 +
 src/utils/exec.ts        |  34 +++++
 tests/managers.test.ts   | 295 ++++++++++++++++++++++++++++++++++++++-
 tests/sudo.test.ts       |  83 +++++++++++
 13 files changed, 754 insertions(+), 111 deletions(-)
```

*13 files changed, 754 insertions(+), 111 deletions(-)*

## [v1.1.0] - 2026-10-10

### 🚀 Features
- **cli**: integrate interactive confirmation prompts in execution options ([`aba763c`]) - Daniel Hernández
- **managers**: implement DnfManager and register in default managers ([`cec58c7`]) - Daniel Hernández
- **types**: add confirmAction callback to ExecutionOptions ([`023af4e`]) - Daniel Hernández

### 🛠️ Refactoring & Maintenance
- **managers**: add comprehensive test coverage for DnfManager and registry ([`aeb9994`]) - Daniel Hernández

### 📝 Documentation
- document DNF manager architecture, ADR-010, and updated specifications ([`443a34c`]) - Daniel Hernández

*10 files changed, 705 insertions(+), 11 deletions(-)*
