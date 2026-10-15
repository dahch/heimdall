# Changelog

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
