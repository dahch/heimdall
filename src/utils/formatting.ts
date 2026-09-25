import pc from 'picocolors';
import Table from 'cli-table3';
import type { UpdateItem, UpdateExecutionResult } from '../types.js';

export { extractErrorMessage } from './error.js';

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = (ms / 1000).toFixed(1);
  return `${seconds}s`;
}

export function renderUpdatesTable(items: UpdateItem[]): string {
  if (items.length === 0) {
    return pc.dim('  No updates pending.');
  }

  const table = new Table({
    head: [
      pc.dim('Manager'),
      pc.dim('Package'),
      pc.dim('Type'),
      pc.dim('Version Transition'),
    ],
    style: {
      head: [],
      border: ['dim'],
    },
    chars: {
      top: '─',
      'top-mid': '─',
      'top-left': '┌',
      'top-right': '┐',
      bottom: '─',
      'bottom-mid': '─',
      'bottom-left': '└',
      'bottom-right': '┘',
      left: '│',
      'left-mid': '├',
      mid: '─',
      'mid-mid': '┼',
      right: '│',
      'right-mid': '┤',
      middle: '│',
    },
  });

  for (const item of items) {
    const typeLabel = item.type ? pc.dim(`[${item.type}]`) : pc.dim('-');
    const currentVer = pc.yellow(item.currentVersion || '?');
    const arrow = pc.dim(' → ');
    const latestVer = pc.green(pc.bold(item.latestVersion || '?'));

    table.push([
      pc.cyan(item.managerName),
      pc.bold(pc.white(item.name)),
      typeLabel,
      `${currentVer}${arrow}${latestVer}`,
    ]);
  }

  return table.toString();
}

export function renderExecutionSummary(results: UpdateExecutionResult[]): string {
  const total = results.length;
  const successful = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;
  const totalUpdated = results.reduce((acc, r) => acc + r.updatedCount, 0);

  const lines: string[] = [];
  lines.push('');
  lines.push(pc.dim('─'.repeat(60)));
  lines.push(`  ${pc.bold(pc.cyan('Universal Updater'))} ${pc.dim('• Execution Summary')}`);
  lines.push(pc.dim('─'.repeat(60)));

  for (const res of results) {
    const icon = res.icon || '📦';
    const status = res.success ? pc.green('✔ SUCCESS') : pc.red('✖ FAILED');
    const time = pc.dim(`(${formatDuration(res.durationMs)})`);
    const count = res.success
      ? pc.dim(`• ${res.updatedCount} updated`)
      : pc.dim(`• ${res.updatedCount} updated, ${res.steps.filter((s) => s.status === 'failed').length} issue(s)`);

    lines.push(`  ${icon} ${pc.bold(res.managerName)} ${status} ${count} ${time}`);

    if (!res.success && res.error) {
      lines.push(`     ${pc.red('↳ Error:')} ${pc.dim(res.error.trim().split('\n')[0])}`);
    }

    if (res.steps.length > 0) {
      for (const step of res.steps) {
        if (step.status === 'skipped') continue; // Don't show internal fallback triggers
        const stepStatus =
          step.status === 'success'
            ? pc.green('✔')
            : step.status === 'failed'
            ? pc.red('✖')
            : pc.dim('○');
        const stepDuration = step.durationMs ? pc.dim(`[${formatDuration(step.durationMs)}]`) : '';
        const stepError = step.error && step.status === 'failed' ? pc.red(` (${step.error.split('\n')[0]})`) : '';
        lines.push(`       ${stepStatus} ${pc.dim(step.name)} ${stepDuration}${stepError}`);
      }
    }
  }

  lines.push(pc.dim('─'.repeat(60)));
  const summaryParts = [
    pc.green(`${successful}/${total} managers succeeded`),
    failed > 0 ? pc.red(`${failed} failed`) : null,
    pc.cyan(`${totalUpdated} package(s) updated`),
  ].filter(Boolean);

  lines.push(`  ${summaryParts.join(' • ')}`);
  lines.push(pc.dim('─'.repeat(60)));

  return lines.join('\n');
}
