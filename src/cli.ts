import { Command } from 'commander';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { createDefaultManagers, filterManagers } from './managers/registry.js';
import { UpdaterEngine } from './core/engine.js';
import { renderUpdatesTable, renderExecutionSummary, formatDuration } from './utils/formatting.js';
import type { UpdateItem } from './types.js';

interface CliOptions {
  yes?: boolean;
  dryRun?: boolean;
  only?: string;
  exclude?: string;
  timeout?: string;
  verbose?: boolean;
}

async function main() {
  const program = new Command();

  program
    .name('uup')
    .description('Universal System Updater: resilient validator and updater for system and global packages')
    .version('1.0.0')
    .option('-y, --yes', 'Skip confirmation prompt and update all automatically')
    .option('-d, --dry-run', 'Inspect outdated packages and simulate update without running changes')
    .option('-o, --only <managers>', 'Only check and update specified managers (comma-separated, e.g. brew,npm)')
    .option('-x, --exclude <managers>', 'Exclude specified managers (comma-separated, e.g. macports,pip)')
    .option('-t, --timeout <ms>', 'Timeout per check in milliseconds', '25000')
    .option('-v, --verbose', 'Show detailed output and logs')
    .parse(process.argv);

  const options = program.opts<CliOptions>();

  // Display intro banner
  console.clear();
  p.intro(pc.bgCyan(pc.black(' Universal Updater (uup) ')));

  const timeoutMs = parseInt(options.timeout || '25000', 10);
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
  const availableManagers = availableResults.map((r) => `${r.icon} ${r.managerName}`);
  p.log.info(
    `${pc.bold('Active package managers detected:')} ${availableManagers.join(' • ')}`
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
    p.outro(pc.cyan('No updates needed. Have a great day!'));
    process.exit(0);
  }

  // Display outdated packages table
  p.log.message(pc.bold(`\nPending updates found (${pc.yellow(String(allUpdates.length))} total):`));
  console.log(renderUpdatesTable(allUpdates));
  console.log('');

  // Group updates by manager
  const itemsByManager = new Map<string, UpdateItem[]>();
  for (const update of allUpdates) {
    const list = itemsByManager.get(update.managerId) ?? [];
    list.push(update);
    itemsByManager.set(update.managerId, list);
  }

  // If dry-run, output simulation and exit
  if (options.dryRun) {
    p.note(
      pc.yellow(`[DRY RUN] ${allUpdates.length} update(s) detected across ${itemsByManager.size} manager(s). No actions taken.`),
      'Dry Run Mode'
    );
    p.outro(pc.cyan('Dry run completed.'));
    process.exit(0);
  }

  // Stage 3: General Confirmation
  let managersToUpdate: string[] = [];

  if (options.yes) {
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

  // Stage 4: Animated Execution with Real-Time Feedback
  p.log.step(pc.bold(pc.cyan(`\nStarting updates for ${managersToUpdate.length} package manager(s)...`)));

  const updateSpinner = p.spinner();

  const summary = await engine.execute(
    managersToUpdate,
    itemsByManager,
    {
      verbose: options.verbose,
      dryRun: false,
      onStepStart: (stepName) => {
        updateSpinner.message(pc.cyan(`Running: ${stepName}...`));
      },
      onStepProgress: (stepName, logLine) => {
        if (options.verbose && logLine) {
          p.log.message(pc.dim(`  [${stepName}] ${logLine}`));
        }
      },
      onStepEnd: (stepName, success, error) => {
        if (!success && error) {
          p.log.warn(pc.yellow(`  ⚠ ${stepName} encountered issue: ${error.split('\n')[0]}`));
        }
      },
    },
    (mgr) => {
      updateSpinner.start(`Starting update for ${mgr.icon} ${mgr.name}...`);
    },
    (mgr, res) => {
      if (res.success) {
        updateSpinner.stop(`Completed ${mgr.icon} ${mgr.name} in ${formatDuration(res.durationMs)}`);
      } else {
        updateSpinner.stop(pc.red(`Failed ${mgr.icon} ${mgr.name} after ${formatDuration(res.durationMs)}`));
      }
    }
  );

  // Stage 5: Final Summary
  console.log(renderExecutionSummary(summary.results));

  if (summary.failedCount === 0) {
    p.outro(
      pc.bold(
        pc.green(
          `✔ All operations completed successfully in ${formatDuration(summary.totalDurationMs)}!`
        )
      )
    );
  } else {
    p.outro(
      pc.bold(
        pc.yellow(
          `Completed with warnings: ${summary.successCount} succeeded, ${summary.failedCount} failed (${formatDuration(summary.totalDurationMs)}).`
        )
      )
    );
  }
}

main().catch((err) => {
  p.log.error(pc.red(`Fatal error: ${err instanceof Error ? err.message : String(err)}`));
  process.exit(1);
});
