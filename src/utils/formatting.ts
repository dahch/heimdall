import pc from 'picocolors';
import Table from 'cli-table3';
import type { UpdateItem, UpdateExecutionResult } from '../types.js';

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = (ms / 1000).toFixed(1);
  return `${seconds}s`;
}

export function formatVersionChange(current: string, latest: string): string {
  if (!current || current === 'unknown') {
    return `${pc.dim('unknown')} ${pc.cyan('➜')} ${pc.green(latest || 'latest')}`;
  }
  if (!latest || latest === 'unknown') {
    return `${pc.yellow(current)} ${pc.cyan('➜')} ${pc.green('update')}`;
  }
  return `${pc.yellow(current)} ${pc.cyan('➜')} ${pc.green(pc.bold(latest))}`;
}

export function renderUpdatesTable(items: UpdateItem[]): string {
  if (items.length === 0) {
    return pc.dim('  No updates pending.');
  }

  const table = new Table({
    head: [
      pc.bold(pc.white('Manager')),
      pc.bold(pc.white('Package')),
      pc.bold(pc.white('Type')),
      pc.bold(pc.white('Current')),
      pc.bold(pc.white('Latest')),
    ],
    style: {
      head: [],
      border: ['dim'],
    },
    chars: {
      top: '─',
      'top-mid': '┬',
      'top-left': '┌',
      'top-right': '┐',
      bottom: '─',
      'bottom-mid': '┴',
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
    table.push([
      pc.cyan(item.managerName),
      pc.bold(pc.white(item.name)),
      item.type ? pc.magenta(item.type) : pc.dim('-'),
      pc.yellow(item.currentVersion || '?'),
      pc.green(pc.bold(item.latestVersion || '?')),
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
  lines.push(pc.bold('─'.repeat(55)));
  lines.push(pc.bold(pc.cyan('  Universal Updater — Execution Summary')));
  lines.push(pc.bold('─'.repeat(55)));

  for (const res of results) {
    const icon = res.icon || '📦';
    const status = res.success ? pc.green('✔ SUCCESS') : pc.red('✖ FAILED');
    const time = pc.dim(`(${formatDuration(res.durationMs)})`);
    const count = pc.dim(`• ${res.updatedCount} package(s)`);

    lines.push(`  ${icon} ${pc.bold(res.managerName)} ${status} ${count} ${time}`);

    if (!res.success && res.error) {
      lines.push(`     ${pc.red('↳ Error:')} ${pc.dim(res.error.trim().split('\n')[0])}`);
    }

    if (res.steps.length > 0) {
      for (const step of res.steps) {
        const stepStatus = step.status === 'success'
          ? pc.green('✔')
          : step.status === 'failed'
          ? pc.red('✖')
          : pc.dim('⊝');
        const stepDuration = step.durationMs ? pc.dim(`[${formatDuration(step.durationMs)}]`) : '';
        lines.push(`       ${stepStatus} ${pc.dim(step.name)} ${stepDuration}`);
      }
    }
  }

  lines.push(pc.bold('─'.repeat(55)));
  const summaryParts = [
    pc.green(`${successful}/${total} managers succeeded`),
    failed > 0 ? pc.red(`${failed} failed`) : null,
    pc.cyan(`${totalUpdated} package(s) updated`),
  ].filter(Boolean);

  lines.push(`  ${summaryParts.join(' • ')}`);
  lines.push(pc.bold('─'.repeat(55)));

  return lines.join('\n');
}
