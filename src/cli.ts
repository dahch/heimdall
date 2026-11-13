import { Command } from 'commander';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { createDefaultManagers, filterManagers } from './managers/registry.js';
import { UpdaterEngine } from './core/engine.js';
import {
  applyDistroUpgrade,
  detectDistroUpgrade,
  type DistroUpgradePlan,
} from './core/distro.js';
import { renderUpdatesTable, renderExecutionSummary, formatDuration } from './utils/formatting.js';
import { getPackageMetadata } from './utils/version.js';
import { ensureSudo, startSudoKeepAlive } from './utils/exec.js';
import type { GlobalSummary, UpdateItem } from './types.js';

interface CliOptions {
  yes?: boolean;
  dryRun?: boolean;
  only?: string;
  exclude?: string;
  timeout?: string;
  verbose?: boolean;
  distroUpgrade?: boolean;
  upgradeDistro?: boolean;
}

/**
 * Final stage: detect a newer distribution release (Fedora n+1, Ubuntu/Debian) and,
 * when supported, offer to apply it. Never auto-applies under `--yes`.
 */
async function offerDistroUpgrade(
  options: CliOptions,
  timeoutMs: number,
  isSimulated: boolean
): Promise<boolean> {
  if (process.platform !== 'linux' || options.distroUpgrade === false) return true;

  const scanSpinner = p.spinner();
  scanSpinner.start('Checking for distribution release upgrades...');

  let plan: DistroUpgradePlan | null = null;
  try {
    plan = await detectDistroUpgrade({ timeoutMs: Math.max(timeoutMs, 6000) });
  } catch {
    plan = null;
  }

  scanSpinner.stop(
    plan
      ? `Distribution upgrade available: ${plan.targetName}`
      : 'Distribution release is up to date'
  );

  if (!plan) {
    if (options.verbose) {
      p.log.step(pc.dim('No newer distribution release detected.'));
    }
    return true;
  }

  p.note(
    [
      `${pc.bold(plan.targetName)} is available ${pc.dim(`(current: ${plan.currentVersion})`)}.`,
      plan.supported
        ? 'Heimdall can stage/apply the upgrade; it never reboots the machine by itself.'
        : 'Heimdall cannot apply this upgrade automatically.',
    ].join('\n'),
    'Distribution upgrade available'
  );

  for (const line of plan.guidance) {
    p.log.step(pc.dim(`↳ ${line}`));
  }

  if (isSimulated) {
    for (const step of plan.steps) {
      p.log.info(pc.yellow(`[DRY RUN] Would run: ${[step.file, ...step.args].join(' ')}`));
    }
    return true;
  }

  if (!plan.supported) return true;

  const autoApply = options.upgradeDistro === true;
  const canPrompt = Boolean(process.stdin.isTTY) && !options.yes && !autoApply;

  if (!autoApply && !canPrompt) {
    const [first] = plan.steps;
    if (first) {
      p.log.info(
        pc.dim(`Not applied automatically. Run: ${[first.file, ...first.args].join(' ')}`)
      );
    }
    return true;
  }

  let proceed = autoApply;
  if (!autoApply) {
    const answer = await p.confirm({
      message: `Apply the ${plan.targetName} release upgrade now?`,
      initialValue: false,
    });
    if (p.isCancel(answer)) {
      p.cancel('Distribution upgrade cancelled.');
      return true;
    }
    proceed = answer;
  }

  if (!proceed) {
    p.log.info(pc.yellow('Distribution upgrade skipped.'));
    return true;
  }

  const upgradeSpinner = p.spinner();
  let stopSudoKeepAlive: (() => void) | undefined;

  if (process.getuid?.() !== 0) {
    p.log.step(pc.dim('Requesting sudo privileges for the distribution upgrade...'));
    if (!(await ensureSudo())) {
      p.log.warn(
        pc.yellow(
          'Sudo privileges not granted: the distribution upgrade cannot run. Run "sudo -v" in this terminal and retry.'
        )
      );
      return false;
    }
    stopSudoKeepAlive = startSudoKeepAlive();
  }

  upgradeSpinner.start(pc.dim('Running the distribution release upgrade...'));

  let result;
  try {
    result = await applyDistroUpgrade(plan, {
    onStepStart: (stepName) => upgradeSpinner.message(pc.dim(`Running: ${stepName}...`)),
    onStepProgress: (_stepName, logLine) => {
      if (!logLine) return;
      const truncated = logLine.length > 55 ? `${logLine.slice(0, 52)}...` : logLine;
      upgradeSpinner.message(pc.dim(truncated));
    },
    onStepEnd: (stepName, success, error, durationMs) => {
      const mark = success ? pc.green('✔') : pc.red('✖');
      const durStr = durationMs !== undefined ? pc.dim(` [${formatDuration(durationMs)}]`) : '';
      const detail = error ? pc.red(` ↳ ${error.split('\n')[0]}`) : '';
      upgradeSpinner.stop(`  ${mark} ${pc.dim(stepName)}${durStr}${detail}`);
      upgradeSpinner.start(pc.dim('Working...'));
    },
    });
  } finally {
    stopSudoKeepAlive?.();
  }

  upgradeSpinner.stop(
    result.success
      ? pc.green('✔ Distribution upgrade routine completed')
      : pc.red('✖ Distribution upgrade failed')
  );

  if (!result.success) {
    if (result.error) p.log.error(pc.red(result.error));
    return false;
  }

  if (plan.rebootRequired) {
    p.note(
      `Reboot to finish the upgrade:\n  ${pc.bold(plan.rebootCommand ?? 'sudo reboot')}`,
      'Reboot required'
    );
  }

  return true;
}

async function main() {
  const { version, description } = getPackageMetadata();
  const program = new Command();

  program
    .name('hmd')
    .description(description || 'Heimdall: resilient validator and updater for system and global packages')
    .version(version)
    .option('-y, --yes', 'Skip confirmation prompt and update all automatically')
    .option('-d, --dry-run', 'Inspect outdated packages and simulate update without running changes')
    .option('-o, --only <managers>', 'Only check and update specified managers (comma-separated, e.g. brew,npm)')
    .option('-x, --exclude <managers>', 'Exclude specified managers (comma-separated, e.g. macports,pip)')
    .option('-t, --timeout <ms>', 'Timeout per check in milliseconds', '25000')
    .option('-v, --verbose', 'Show detailed output and logs')
    .option('--no-distro-upgrade', 'Skip the distribution release upgrade check at the end')
    .option(
      '-U, --upgrade-distro',
      'Apply a detected distribution release upgrade without asking (never reboots)'
    )
    .parse(process.argv);

  const options = program.opts<CliOptions>();

  // Display intro banner
  if (process.stdout.isTTY && !options.verbose) {
    console.clear();
  }
  p.intro(`${pc.cyan('●')} ${pc.bold('hmd')} ${pc.dim(`v${version}`)} — ${pc.dim('Heimdall System Updater')}`);

  const rawTimeout = parseInt(options.timeout || '25000', 10);
  const timeoutMs = Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : 25000;

  const onlyList = options.only ? options.only.split(',') : undefined;
  const excludeList = options.exclude ? options.exclude.split(',') : undefined;

  const allManagers = createDefaultManagers();
  const selectedManagers = filterManagers(allManagers, onlyList, excludeList);

  if (selectedManagers.length === 0) {
    p.log.error(pc.red('No package managers matched your filter.'));
    p.outro(pc.yellow('Exiting without changes.'));
    process.exit(1);
  }

  const engine = new UpdaterEngine(selectedManagers);

  // Stage 1: Animated Discovery & Validation
  const scanSpinner = p.spinner();
  scanSpinner.start('Discovering available package managers and checking for updates...');

  let activeChecks = 0;
  const { availableResults, allUpdates, unavailableManagers } = await engine.scan(timeoutMs, {
    onManagerStart: (mgr) => {
      activeChecks++;
      scanSpinner.message(`Querying ${mgr.icon} ${mgr.name} (${activeChecks} in progress)...`);
    },
    onManagerComplete: (mgr, res) => {
      activeChecks = Math.max(0, activeChecks - 1);
      const countStr = res.updates.length > 0 ? pc.yellow(`${res.updates.length} outdated`) : pc.green('up to date');
      scanSpinner.message(`Checked ${mgr.icon} ${mgr.name}: ${countStr}`);
    },
  });

  scanSpinner.stop('Discovery and validation completed');

  // Summary of detected managers
  const availableManagers = availableResults.map((r) => `${r.icon} ${pc.bold(r.managerName)}`);
  p.log.info(
    `${pc.bold('Active package managers:')} ${availableManagers.join(' • ')}`
  );

  if (unavailableManagers.length > 0 && options.verbose) {
    const unavailStr = unavailableManagers.map((m) => `${m.icon} ${m.name}`).join(', ');
    p.log.step(pc.dim(`Inactive/not installed (skipped safely): ${unavailStr}`));
  }

  // Stage 2: Presentation & Aggregated Outdated List
  if (allUpdates.length === 0) {
    p.note(
      pc.green('All detected package managers and global packages are completely up to date! 🎉'),
      'Status: Up to Date'
    );
    const distroOk = await offerDistroUpgrade(options, timeoutMs, options.dryRun ?? false);
    p.outro(pc.cyan('No package updates needed. Have a great day!'));
    process.exit(distroOk ? 0 : 1);
  }

  // Display outdated packages table
  p.log.message(`\n${pc.bold('Pending updates')} ${pc.dim(`(${allUpdates.length} total):`)}`);
  console.log(renderUpdatesTable(allUpdates));
  console.log('');

  // Group updates by manager
  const itemsByManager = new Map<string, UpdateItem[]>();
  for (const update of allUpdates) {
    const list = itemsByManager.get(update.managerId) ?? [];
    list.push(update);
    itemsByManager.set(update.managerId, list);
  }

  // Stage 3: General Confirmation or Dry Run
  let managersToUpdate: string[] = [];

  if (options.dryRun) {
    managersToUpdate = Array.from(itemsByManager.keys());
    p.log.info(pc.yellow(`[DRY RUN] Simulating updates for ${allUpdates.length} package(s)...`));
  } else if (options.yes) {
    managersToUpdate = Array.from(itemsByManager.keys());
    p.log.info(pc.cyan('Flag -y provided: proceeding with all updates automatically.'));
  } else {
    const managerOptions = Array.from(itemsByManager.entries()).map(([mgrId, items]) => {
      const mgrInfo = availableResults.find((r) => r.managerId === mgrId);
      return {
        value: mgrId,
        label: `${mgrInfo?.icon ?? '📦'} ${mgrInfo?.managerName ?? mgrId} (${items.length} updates)`,
      };
    });

    const action = await p.select({
      message: `How would you like to proceed with the ${allUpdates.length} update(s)?`,
      options: [
        {
          value: 'all',
          label: `⚡ Confirm & Update everything (${allUpdates.length} packages across ${itemsByManager.size} managers)`,
          hint: 'Recommended',
        },
        {
          value: 'select',
          label: '⚙ Select specific package managers to update',
          hint: 'Fine-grained choice',
        },
        {
          value: 'cancel',
          label: '✖ Cancel and exit without updating',
        },
      ],
    });

    if (p.isCancel(action) || action === 'cancel') {
      p.cancel('Update operation cancelled by user.');
      process.exit(0);
    }

    if (action === 'all') {
      managersToUpdate = Array.from(itemsByManager.keys());
    } else if (action === 'select') {
      const chosen = await p.multiselect({
        message: 'Select the package managers you want to update:',
        options: managerOptions,
        initialValues: Array.from(itemsByManager.keys()),
        required: true,
      });

      if (p.isCancel(chosen)) {
        p.cancel('Selection cancelled.');
        process.exit(0);
      }

      managersToUpdate = chosen as string[];
    }
  }

  if (managersToUpdate.length === 0) {
    p.outro(pc.yellow('No managers selected for update.'));
    process.exit(0);
  }

  // Stage 3.5: Privilege Acquisition (interactive sudo, requested before any spinner owns the TTY)
  const isSimulated = options.dryRun ?? false;
  let stopSudoKeepAlive: (() => void) | undefined;

  const selectedIds = new Set(managersToUpdate);
  const needsSudo = selectedManagers.some((m) => selectedIds.has(m.id) && m.requiresSudo);

  if (needsSudo && !isSimulated) {
    p.log.step(pc.dim('Requesting sudo privileges required by system package managers...'));
    if (await ensureSudo()) {
      stopSudoKeepAlive = startSudoKeepAlive();
    } else {
      p.log.warn(
        pc.yellow(
          'Sudo privileges not granted: system package managers will fail. Run "sudo -v" in this terminal and retry.'
        )
      );
    }
  }

  // Stage 4: Animated Execution with Real-Time Feedback
  p.log.step(
    pc.bold(
      pc.cyan(
        `\n${isSimulated ? '[DRY RUN] Simulating' : 'Starting'} updates for ${managersToUpdate.length} package manager(s)...`
      )
    )
  );

  const updateSpinner = p.spinner();
  let managerIndex = 0;

  let summary: GlobalSummary;
  try {
    summary = await engine.execute(
      managersToUpdate,
      itemsByManager,
      {
        verbose: options.verbose,
        dryRun: isSimulated,
        confirmAction: async (message: string) => {
          if (options.yes) return true;
          updateSpinner.stop(pc.dim('Waiting for user confirmation...'));
          const confirmed = await p.confirm({ message, initialValue: false });
          updateSpinner.start(pc.dim('Continuing update...'));
          return typeof confirmed === 'boolean' ? confirmed : false;
        },
        onStepStart: (stepName) => {
          updateSpinner.message(pc.dim(`Running: ${stepName}...`));
        },
        onStepProgress: (stepName, logLine) => {
          if (logLine) {
            const truncated = logLine.length > 55 ? logLine.slice(0, 52) + '...' : logLine;
            updateSpinner.message(pc.dim(`${stepName} [${truncated}]`));
          }
        },
        onStepEnd: (stepName, success, error, durationMs) => {
          const mark = success ? pc.green('✔') : pc.red('✖');
          const durStr = durationMs !== undefined ? pc.dim(` [${formatDuration(durationMs)}]`) : '';
          const detail = error ? pc.red(` ↳ ${error.split('\n')[0]}`) : '';
          updateSpinner.stop(`  ${mark} ${pc.dim(stepName)}${durStr}${detail}`);
          updateSpinner.start(pc.dim('Working...'));
        },
      },
      (mgr) => {
        managerIndex++;
        console.log(pc.bold(pc.cyan(`\n● [${managerIndex}/${managersToUpdate.length}] ${mgr.icon} ${mgr.name}`)));
        updateSpinner.start(pc.dim('Starting update routine...'));
      },
      (mgr, res) => {
        if (res.success) {
          updateSpinner.stop(pc.green(`  ✔ ${mgr.name} completed in ${formatDuration(res.durationMs)}`));
        } else {
          updateSpinner.stop(pc.red(`  ✖ ${mgr.name} completed with issues in ${formatDuration(res.durationMs)}`));
        }
      }
    );
  } finally {
    stopSudoKeepAlive?.();
  }

  // Stage 5: Final Summary
  console.log(renderExecutionSummary(summary.results));

  // Stage 6: Distribution release upgrade (Fedora n+1, Ubuntu/Debian)
  const distroOk = await offerDistroUpgrade(options, timeoutMs, isSimulated);

  if (summary.failedCount === 0 && distroOk) {
    p.outro(
      pc.bold(
        pc.green(
          `✔ All operations completed successfully: ${summary.pendingUpdatesCount} package(s) updated across ${summary.successCount} manager(s) (${formatDuration(summary.totalDurationMs)})!`
        )
      )
    );
  } else {
    process.exitCode = 1;
    const distroNote = distroOk ? '' : ', distribution upgrade failed';
    p.outro(
      pc.bold(
        pc.yellow(
          `Completed with warnings: ${summary.successCount} succeeded, ${summary.failedCount} failed${distroNote} (${formatDuration(summary.totalDurationMs)}).`
        )
      )
    );
  }
}

main().catch((err) => {
  p.log.error(pc.red(`Fatal error: ${err instanceof Error ? err.message : String(err)}`));
  process.exit(1);
});
