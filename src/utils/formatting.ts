import pc from 'picocolors';
import Table from 'cli-table3';
import type { UpdateItem, UpdateExecutionResult } from '../types.js';

const ANSI_REGEX = /\u001b\[[0-9;?]*[a-zA-Z]/g;

export function extractErrorMessage(rawError?: string): string {
  if (!rawError) {
    return 'Command exited with error';
  }

  // Strip ANSI sequences
  const stripped = rawError.replace(ANSI_REGEX, '').trim();
  if (!stripped) {
    return 'Command exited with error';
  }

  // Split lines and clean whitespace
  const lines = stripped
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return 'Command exited with error';
  }

  // Filter out warning/notice lines
  const isWarningOrNotice = (line: string): boolean => {
    const lower = line.toLowerCase();
    return (
      lower.startsWith('npm warn') ||
      lower.startsWith('npm notice') ||
      lower.startsWith('warning:') ||
      lower.startsWith('[warn]') ||
      lower.startsWith('npm info')
    );
  };

  const filteredLines = lines.filter((line) => !isWarningOrNotice(line));
  const candidateLines = filteredLines.length > 0 ? filteredLines : lines;

  // Check for explicit error lines
  const npmErrorLines: string[] = [];
  const otherErrorLines: string[] = [];

  for (const line of candidateLines) {
    const lower = line.toLowerCase();
    if (lower.startsWith('npm error') || lower.startsWith('npm err!')) {
      const cleaned = line.replace(/^npm\s+(?:error|err!)\s*:?\s*/i, '').trim();
      if (cleaned) {
        npmErrorLines.push(cleaned);
      }
    } else if (line.includes('error:') || line.includes('Error:') || line.includes('fatal:')) {
      otherErrorLines.push(line);
    }
  }

  let result = '';

  if (npmErrorLines.length > 0) {
    const specificLines = npmErrorLines.filter((l) => {
      const low = l.toLowerCase();
      return (
        !low.startsWith('code ') &&
        !low.startsWith('path ') &&
        !low.startsWith('a complete log of this run')
      );
    });

    if (specificLines.length === 0) {
      result = npmErrorLines[0];
    } else if (specificLines.length === 1) {
      result = specificLines[0];
    } else {
      const hasCommandFailed = specificLines[0].toLowerCase().startsWith('command failed');
      if (hasCommandFailed && specificLines.length > 1) {
        const rest = specificLines.slice(1).map((l) => l.replace(/^command\s+/i, '')).join('; ');
        result = `command failed: ${rest}`;
      } else {
        result = specificLines.join('; ');
      }
    }
  } else if (otherErrorLines.length > 0) {
    result = otherErrorLines.join('; ');
  } else {
    // If no error-prefixed line found, take the last non-empty line that isn't a warning, or fallback to the first non-empty line
    result = filteredLines.length > 0 ? filteredLines[filteredLines.length - 1] : lines[0];
  }

  // Clean trailing open braces or punctuation like '{' from truncated JSON
  result = result.replace(/[\{\[\:\,\s]+$/, '').trim();

  if (!result) {
    return 'Command exited with error';
  }

  // Truncate cleanly if unreasonably long (max 120 chars)
  if (result.length > 120) {
    return result.slice(0, 117).trim() + '...';
  }

  return result;
}

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
