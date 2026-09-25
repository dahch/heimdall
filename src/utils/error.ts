const ANSI_REGEX = /\u001b\[[0-9;?]*[a-zA-Z]/g;

/**
 * Extracts a clean, concise, actionable error message from combined stderr/stdout.
 * Filters out harmless npm warnings, notices, and ANSI codes.
 */
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
      lower.startsWith('warn:') ||
      lower.startsWith('npm info')
    );
  };

  const filteredLines = lines.filter((line) => !isWarningOrNotice(line));

  // If the output only contains warnings and no meaningful errors, do not revert to displaying the warning
  if (filteredLines.length === 0) {
    return 'Command exited with error';
  }

  // Check for explicit error lines
  const npmErrorLines: string[] = [];
  const otherErrorLines: string[] = [];

  for (const line of filteredLines) {
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
        !low.startsWith('errno ') &&
        !low.startsWith('syscall ') &&
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
    // If no error-prefixed line found, take the last non-empty line that isn't a warning
    result = filteredLines[filteredLines.length - 1];
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
