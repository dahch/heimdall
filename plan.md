# Plan: Universal Updater Audit, Resilience & Modern UI/UX Refinement

## Iteration 1 — Core Error Extraction & Resilient Update Fallbacks
modules: src/utils/formatting.ts, src/managers/base.ts, src/managers/npm.ts, src/managers/homebrew.ts

Implement a robust error extractor `extractErrorMessage()` that filters out non-fatal `npm warn`/`warning:` stderr lines and captures real error messages.
Refactor `NpmManager` to perform targeted package updates instead of blanket monolithic `npm update -g`, and add automatic `--ignore-scripts` retry fallback when scripts fail.
Optimize `HomebrewManager` to prevent redundant cask upgrades based on pending items.
Ensure step failure tracking distinguishes between fallback triggers and final package failures.

## Iteration 2 — Modern Minimalist UI/UX & Live Feedback System
modules: src/utils/formatting.ts, src/cli.ts

Redesign the CLI interface for a modern, minimalist, and pleasant aesthetic:
1. Minimalist header banner with clean typography and versioning.
2. Micro-border modern tabular layout for pending updates with clear `current → latest` version transitions and package type tags.
3. Live, continuous execution feedback with persistent indented step markers (`✔ step (time)`) and active spinner showing live timers and real-time activity.
4. Clean, comprehensive execution summary highlighting updated vs failed counts with high precision.

## Iteration 3 — Test Suite Expansion & End-to-End Verification
modules: tests/formatting.test.ts, tests/managers.test.ts, tests/exec.test.ts

Expand the Vitest suite to rigorously test:
1. `extractErrorMessage` handling npm warnings, stack traces, and multi-line stderr.
2. `NpmManager` targeted updates, monolithic failure fallback, and `--ignore-scripts` recovery.
3. `HomebrewManager` selective formula/cask execution.
4. Formatting rendering functions (updates table, execution summary, duration).
Run complete test suite and build verification (`pnpm test` and `pnpm build`).
