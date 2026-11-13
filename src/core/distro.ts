import { readFileSync } from 'node:fs';
import { commandExists, safeExec, type SafeExecResult } from '../utils/exec.js';
import { runStep } from '../managers/base.js';
import type { ExecutionOptions, UpdateStep } from '../types.js';

export type DistroFamily = 'fedora' | 'ubuntu' | 'debian';

export interface DistroIdentity {
  id: string;
  idLike: string[];
  versionId: string;
  codename: string;
  prettyName: string;
}

export interface DistroUpgradeStep {
  name: string;
  file: string;
  args: string[];
  requiresSudo: boolean;
}

export interface DistroUpgradePlan {
  family: DistroFamily;
  currentVersion: string;
  nextVersion: string;
  targetName: string;
  /** Whether Heimdall can run the upgrade routine itself. */
  supported: boolean;
  steps: DistroUpgradeStep[];
  rebootRequired: boolean;
  rebootCommand?: string;
  guidance: string[];
}

export interface DistroUpgradeResult {
  success: boolean;
  steps: UpdateStep[];
  error?: string;
}

interface BodhiRelease {
  id_prefix?: string;
  version?: string;
  state?: string;
}

interface UbuntuReleaseBlock {
  dist: string;
  version: string;
  supported: boolean;
}

const FEDORA_RELEASES_URL = 'https://bodhi.fedoraproject.org/releases?state=current';
const UBUNTU_META_RELEASE_URL = 'https://changelogs.ubuntu.com/meta-release';
const DEBIAN_STABLE_RELEASE_URL = 'https://deb.debian.org/debian/dists/stable/Release';

/** Parses `/etc/os-release` content into the fields used by distro detection. */
export function parseOsRelease(content: string): DistroIdentity | null {
  const values: Record<string, string> = {};
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    values[match[1]] = match[2].replace(/^"(.*)"$/, '$1');
  }

  const id = values.ID?.toLowerCase();
  if (!id) return null;

  return {
    id,
    idLike: (values.ID_LIKE ?? '').toLowerCase().split(/\s+/).filter(Boolean),
    versionId: values.VERSION_ID ?? '',
    codename: values.VERSION_CODENAME ?? '',
    prettyName: values.PRETTY_NAME ?? values.NAME ?? id,
  };
}

export function readDistroIdentity(): DistroIdentity | null {
  try {
    return parseOsRelease(readFileSync('/etc/os-release', 'utf8'));
  } catch {
    return null;
  }
}

function numericVersion(value: string): number | undefined {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function fetchText(url: string, timeoutMs: number): Promise<string | undefined> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return undefined;
    return await response.text();
  } catch {
    return undefined;
  }
}

async function fetchJson(url: string, timeoutMs: number): Promise<unknown> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return undefined;
    return (await response.json()) as unknown;
  } catch {
    return undefined;
  }
}

async function detectFedora(identity: DistroIdentity, timeoutMs: number): Promise<DistroUpgradePlan | null> {
  const current = numericVersion(identity.versionId);
  if (current === undefined) return null;

  const data = (await fetchJson(FEDORA_RELEASES_URL, timeoutMs)) as
    | { releases?: BodhiRelease[] }
    | undefined;
  const versions = (data?.releases ?? [])
    .filter((release) => release.id_prefix === 'FEDORA' && release.version !== undefined)
    // Only GA Fedora releases are numeric; Rawhide/ELN/EPEL are not.
    .map((release) => numericVersion(release.version ?? ''))
    .filter((version): version is number => version !== undefined && Number.isInteger(version));

  if (versions.length === 0) return null;
  const latest = Math.max(...versions);
  if (latest <= current) return null;

  return {
    family: 'fedora',
    currentVersion: identity.versionId,
    nextVersion: String(latest),
    targetName: `Fedora Linux ${latest}`,
    supported: true,
    steps: [
      {
        name: `sudo dnf system-upgrade download --releasever=${latest}`,
        file: 'sudo',
        args: ['dnf', 'system-upgrade', 'download', `--releasever=${latest}`, '-y'],
        requiresSudo: true,
      },
    ],
    rebootRequired: true,
    rebootCommand: 'sudo dnf system-upgrade reboot',
    guidance: [
      `Packages for Fedora ${latest} are downloaded and staged; the upgrade runs offline during the next boot.`,
      `Reboot to apply it: sudo dnf system-upgrade reboot`,
      'If the system-upgrade plugin is missing, install `dnf-plugin-system-upgrade` (dnf4) or `dnf5-plugin-system-upgrade` (dnf5).',
    ],
  };
}

function parseUbuntuMetaRelease(content: string): UbuntuReleaseBlock[] {
  const blocks: UbuntuReleaseBlock[] = [];
  for (const chunk of content.split(/\n\s*\n/)) {
    const fields: Record<string, string> = {};
    for (const line of chunk.split('\n')) {
      const match = line.match(/^([A-Za-z-]+):\s*(.*)$/);
      if (match) fields[match[1].toLowerCase()] = match[2].trim();
    }
    if (fields.dist && fields.version) {
      blocks.push({
        dist: fields.dist,
        version: fields.version,
        supported: fields.supported === '1',
      });
    }
  }
  return blocks;
}

async function detectUbuntu(identity: DistroIdentity, timeoutMs: number): Promise<DistroUpgradePlan | null> {
  const current = numericVersion(identity.versionId);
  if (current === undefined) return null;

  // The official upgrader knows Ubuntu's LTS promotion rules; prefer its own check.
  if (await commandExists('do-release-upgrade')) {
    const check: SafeExecResult = await safeExec('do-release-upgrade', ['-c'], {
      timeoutMs: Math.max(timeoutMs, 20000),
    });
    const output = `${check.stdout}\n${check.stderr}`;
    const match = output.match(/New release '([^']+)' available/i);
    if (match) {
      return {
        family: 'ubuntu',
        currentVersion: identity.versionId,
        nextVersion: match[1],
        targetName: `Ubuntu ${match[1]}`,
        supported: true,
        steps: [
          {
            name: 'sudo do-release-upgrade -f DistUpgradeViewNonInteractive',
            file: 'sudo',
            args: ['do-release-upgrade', '-f', 'DistUpgradeViewNonInteractive'],
            requiresSudo: true,
          },
        ],
        rebootRequired: true,
        rebootCommand: 'sudo reboot',
        guidance: [
          'The release upgrade runs non-interactively and may take a long time; reboot when it asks or once it reports completion.',
          'Make sure your data is backed up before upgrading the distribution.',
        ],
      };
    }
    if (/no new release found/i.test(output)) return null;
  }

  // Fallback: derive the newest supported release from Ubuntu's meta-release index.
  const meta = await fetchText(UBUNTU_META_RELEASE_URL, timeoutMs);
  if (!meta) return null;

  const candidates = parseUbuntuMetaRelease(meta)
    .filter((release) => release.supported)
    .map((release) => ({ ...release, numeric: numericVersion(release.version) }))
    .filter(
      (release): release is UbuntuReleaseBlock & { numeric: number } =>
        release.numeric !== undefined && release.numeric > current
    )
    .sort((a, b) => a.numeric - b.numeric);

  const next = candidates[0];
  if (!next) return null;

  return {
    family: 'ubuntu',
    currentVersion: identity.versionId,
    nextVersion: next.version,
    targetName: `Ubuntu ${next.version}`,
    supported: false,
    steps: [],
    rebootRequired: true,
    guidance: [
      `Ubuntu ${next.version} is available, but the official upgrader is not installed.`,
      'Install it with: sudo apt install update-manager-core',
      'Then run: sudo do-release-upgrade',
    ],
  };
}

async function detectDebian(identity: DistroIdentity, timeoutMs: number): Promise<DistroUpgradePlan | null> {
  const current = numericVersion(identity.versionId);
  if (current === undefined) return null;

  const release = await fetchText(DEBIAN_STABLE_RELEASE_URL, timeoutMs);
  if (!release) return null;

  const versionMatch = release.match(/^Version:\s*(\S+)$/m);
  const codenameMatch = release.match(/^Codename:\s*(\S+)$/m);
  if (!versionMatch) return null;

  const stable = numericVersion(versionMatch[1]);
  if (stable === undefined) return null;
  const stableMajor = Math.trunc(stable);
  if (stableMajor <= Math.trunc(current)) return null;

  const codename = codenameMatch?.[1] ?? `debian-${stableMajor}`;
  const currentCodename = identity.codename || `version ${identity.versionId}`;

  return {
    family: 'debian',
    currentVersion: identity.versionId,
    nextVersion: String(stableMajor),
    targetName: `Debian ${stableMajor} (${codename})`,
    // Debian has no supported unattended in-place upgrader: sources.list must switch
    // suites deliberately, so Heimdall only reports the procedure.
    supported: false,
    steps: [],
    rebootRequired: true,
    guidance: [
      `Debian ${stableMajor} (${codename}) is available; this system runs ${identity.versionId} (${currentCodename}).`,
      `Replace "${currentCodename}" with "${codename}" in /etc/apt/sources.list and /etc/apt/sources.list.d/*.list.`,
      'Then run: sudo apt update && sudo apt full-upgrade',
      'Back up your data first and expect to reboot afterwards. Debian does not offer an unattended upgrade path.',
    ],
  };
}

/**
 * Detects whether a newer distribution release is available. Read-only and never throws:
 * on any network/parse failure it simply reports "no upgrade".
 */
export async function detectDistroUpgrade(options?: {
  timeoutMs?: number;
  identity?: DistroIdentity;
}): Promise<DistroUpgradePlan | null> {
  if (process.platform !== 'linux') return null;

  const identity = options?.identity ?? readDistroIdentity();
  if (!identity) return null;

  const timeoutMs = options?.timeoutMs ?? 6000;
  const family: DistroFamily | undefined =
    identity.id === 'fedora'
      ? 'fedora'
      : identity.id === 'ubuntu' || identity.idLike.includes('ubuntu')
      ? 'ubuntu'
      : identity.id === 'debian'
      ? 'debian'
      : undefined;

  try {
    if (family === 'fedora') return await detectFedora(identity, timeoutMs);
    if (family === 'ubuntu') return await detectUbuntu(identity, timeoutMs);
    if (family === 'debian') return await detectDebian(identity, timeoutMs);
    return null;
  } catch {
    return null;
  }
}

/**
 * Applies a supported distro upgrade plan. Never reboots: Fedora stages the offline
 * transaction and the user triggers the reboot; Ubuntu's upgrader reports its own
 * restart requirement. Returns a structured failure instead of throwing.
 */
export async function applyDistroUpgrade(
  plan: DistroUpgradePlan,
  options: ExecutionOptions
): Promise<DistroUpgradeResult> {
  const steps: UpdateStep[] = [];

  if (!plan.supported || plan.steps.length === 0) {
    return {
      success: false,
      steps,
      error: `No unattended upgrade routine is available for ${plan.targetName}.`,
    };
  }

  if (!options.dryRun && process.getuid?.() !== 0) {
    const ticket = await safeExec('sudo', ['-n', 'true'], { timeoutMs: 3000 });
    if (!ticket.success) {
      const error = `The distribution upgrade requires sudo privileges. Run "sudo -v" in this terminal and retry.`;
      return {
        success: false,
        steps: [
          {
            name: 'sudo privileges',
            command: 'sudo -n true',
            status: 'failed',
            error,
          },
        ],
        error,
      };
    }
  }

  for (const step of plan.steps) {
    const result = await runStep(step.name, step.file, step.args, {
      ...options,
      // Distribution upgrades are long operations: allow up to one hour per step.
      timeoutMs: 3600000,
    });
    steps.push(result);
    if (result.status !== 'success') break;
  }

  const success = steps.length > 0 && steps.every((step) => step.status === 'success');
  return {
    success,
    steps,
    error: !success ? steps.find((step) => step.status === 'failed')?.error : undefined,
  };
}
