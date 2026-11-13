import { describe, it, expect, vi, afterEach } from 'vitest';
import * as execUtils from '../src/utils/exec.js';
import {
  applyDistroUpgrade,
  detectDistroUpgrade,
  parseOsRelease,
  type DistroIdentity,
} from '../src/core/distro.js';

const fedoraIdentity: DistroIdentity = {
  id: 'fedora',
  idLike: [],
  versionId: '44',
  codename: '',
  prettyName: 'Fedora Linux 44 (KDE Plasma Desktop Edition)',
};

const ubuntuIdentity: DistroIdentity = {
  id: 'ubuntu',
  idLike: ['debian'],
  versionId: '24.04',
  codename: 'noble',
  prettyName: 'Ubuntu 24.04.5 LTS',
};

const debianIdentity: DistroIdentity = {
  id: 'debian',
  idLike: [],
  versionId: '12',
  codename: 'bookworm',
  prettyName: 'Debian GNU/Linux 12 (bookworm)',
};

const releaseText = (version: string) =>
  `Origin: Debian\nLabel: Debian\nSuite: stable\nVersion: ${version}\nCodename: trixie\nDate: Sat, 12 Sep 2026 07:55:41 UTC\n`;

const withNonRootUid = async <T>(fn: () => Promise<T>): Promise<T> => {
  const originalGetuid = process.getuid;
  process.getuid = () => 1000;
  try {
    return await fn();
  } finally {
    process.getuid = originalGetuid;
  }
};

describe.runIf(process.platform === 'linux')('Distro release upgrade detection', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('parseOsRelease', () => {
    it('extracts ID, VERSION_ID, codename and ID_LIKE', () => {
      const identity = parseOsRelease(
        [
          'NAME="Fedora Linux"',
          'VERSION="44 (KDE Plasma Desktop Edition)"',
          'ID=fedora',
          'ID_LIKE="rhel centos"',
          'VERSION_ID=44',
          'VERSION_CODENAME=""',
          'PRETTY_NAME="Fedora Linux 44"',
        ].join('\n')
      );

      expect(identity).not.toBeNull();
      expect(identity?.id).toBe('fedora');
      expect(identity?.versionId).toBe('44');
      expect(identity?.codename).toBe('');
      expect(identity?.idLike).toEqual(['rhel', 'centos']);
    });
  });

  describe('Fedora', () => {
    it('reports the newest GA release above the installed version', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({
          releases: [
            { id_prefix: 'FEDORA', version: '43' },
            { id_prefix: 'FEDORA', version: '44' },
            { id_prefix: 'FEDORA', version: '45' },
            { id_prefix: 'FEDORA-EPEL', version: '10.3' },
            { id_prefix: 'FEDORA', version: 'eln' },
          ],
        }),
      } as Response);

      const plan = await detectDistroUpgrade({ identity: fedoraIdentity });

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://bodhi.fedoraproject.org/releases?state=current',
        expect.any(Object)
      );
      expect(plan?.family).toBe('fedora');
      expect(plan?.nextVersion).toBe('45');
      expect(plan?.supported).toBe(true);
      expect(plan?.steps).toEqual([
        {
          name: 'sudo dnf system-upgrade download --releasever=45',
          file: 'sudo',
          args: ['dnf', 'system-upgrade', 'download', '--releasever=45', '-y'],
          requiresSudo: true,
        },
      ]);
      expect(plan?.rebootCommand).toBe('sudo dnf system-upgrade reboot');
    });

    it('returns null when the installed version is already the newest', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({
          releases: [
            { id_prefix: 'FEDORA', version: '44' },
            { id_prefix: 'FEDORA', version: '43' },
          ],
        }),
      } as Response);

      const plan = await detectDistroUpgrade({ identity: fedoraIdentity });
      expect(plan).toBeNull();
    });

    it('degrades to null when the release service is unreachable', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));
      const plan = await detectDistroUpgrade({ identity: fedoraIdentity });
      expect(plan).toBeNull();
    });
  });

  describe('Ubuntu', () => {
    it('uses do-release-upgrade -c as the authoritative check', async () => {
      vi.spyOn(execUtils, 'commandExists').mockResolvedValue(true);
      const execSpy = vi.spyOn(execUtils, 'safeExec').mockResolvedValue({
        stdout: "Checking for a new Ubuntu release...\nNew release '26.04.1 LTS' available.\n",
        stderr: '',
        exitCode: 0,
        success: true,
        timedOut: false,
      });

      const plan = await detectDistroUpgrade({ identity: ubuntuIdentity });

      expect(execSpy).toHaveBeenCalledWith('do-release-upgrade', ['-c'], expect.any(Object));
      expect(plan?.family).toBe('ubuntu');
      expect(plan?.nextVersion).toBe('26.04.1 LTS');
      expect(plan?.supported).toBe(true);
      expect(plan?.steps[0].args).toEqual([
        'do-release-upgrade',
        '-f',
        'DistUpgradeViewNonInteractive',
      ]);
    });

    it('returns null when the official checker reports no new release', async () => {
      vi.spyOn(execUtils, 'commandExists').mockResolvedValue(true);
      vi.spyOn(execUtils, 'safeExec').mockResolvedValue({
        stdout: 'Checking for a new Ubuntu release\nNo new release found.\n',
        stderr: '',
        exitCode: 1,
        success: false,
        timedOut: false,
      });
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      const plan = await detectDistroUpgrade({ identity: ubuntuIdentity });
      expect(plan).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('falls back to meta-release and reports guidance when the upgrader is missing', async () => {
      vi.spyOn(execUtils, 'commandExists').mockResolvedValue(false);
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        text: async () =>
          [
            'Dist: noble',
            'Version: 24.04.5 LTS',
            'Supported: 1',
            '',
            'Dist: resolute',
            'Version: 26.04.1 LTS',
            'Supported: 1',
            '',
            'Dist: plucky',
            'Version: 25.04',
            'Supported: 0',
            '',
          ].join('\n'),
      } as Response);

      const plan = await detectDistroUpgrade({ identity: ubuntuIdentity });

      expect(plan?.nextVersion).toBe('26.04.1 LTS');
      expect(plan?.supported).toBe(false);
      expect(plan?.guidance.join(' ')).toContain('update-manager-core');
    });
  });

  describe('Debian', () => {
    it('detects the next stable release and only reports guidance', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        text: async () => releaseText('13.7'),
      } as Response);

      const plan = await detectDistroUpgrade({ identity: debianIdentity });

      expect(plan?.family).toBe('debian');
      expect(plan?.nextVersion).toBe('13');
      expect(plan?.supported).toBe(false);
      expect(plan?.steps).toEqual([]);
      expect(plan?.guidance.join(' ')).toContain('sudo apt update && sudo apt full-upgrade');
      expect(plan?.guidance.join(' ')).toContain('trixie');
    });

    it('returns null when already on the stable major', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        text: async () => releaseText('13.7'),
      } as Response);

      const plan = await detectDistroUpgrade({ identity: { ...debianIdentity, versionId: '13', codename: 'trixie' } });
      expect(plan).toBeNull();
    });
  });

  describe('applyDistroUpgrade', () => {
    const fedoraPlan = {
      family: 'fedora' as const,
      currentVersion: '44',
      nextVersion: '45',
      targetName: 'Fedora Linux 45',
      supported: true,
      steps: [
        {
          name: 'sudo dnf system-upgrade download --releasever=45',
          file: 'sudo',
          args: ['dnf', 'system-upgrade', 'download', '--releasever=45', '-y'],
          requiresSudo: true,
        },
      ],
      rebootRequired: true,
      rebootCommand: 'sudo dnf system-upgrade reboot',
      guidance: [],
    };

    it('fails fast when non-interactive sudo is unavailable', async () => {
      vi.spyOn(execUtils, 'safeExec').mockResolvedValue({
        stdout: '',
        stderr: 'sudo: a password is required',
        exitCode: 1,
        success: false,
        timedOut: false,
      });

      const result = await withNonRootUid(() => applyDistroUpgrade(fedoraPlan, {}));

      expect(result.success).toBe(false);
      expect(result.error).toContain('sudo privileges');
      expect(result.steps[0].name).toBe('sudo privileges');
    });

    it('stages the Fedora upgrade without rebooting', async () => {
      const executed: string[] = [];
      vi.spyOn(execUtils, 'safeExec').mockImplementation(async (cmd, args) => {
        executed.push(`${cmd} ${(args ?? []).join(' ')}`);
        return { stdout: '', stderr: '', exitCode: 0, success: true, timedOut: false };
      });

      const result = await withNonRootUid(() => applyDistroUpgrade(fedoraPlan, {}));

      expect(result.success).toBe(true);
      expect(result.steps.map((step) => step.name)).toEqual([
        'sudo dnf system-upgrade download --releasever=45',
      ]);
      expect(executed).toEqual([
        'sudo -n true',
        'sudo dnf system-upgrade download --releasever=45 -y',
      ]);
      expect(executed.some((command) => command.includes('reboot'))).toBe(false);
    });

    it('simulates the plan in dry-run mode without executing anything', async () => {
      const execSpy = vi.spyOn(execUtils, 'safeExec');

      const result = await applyDistroUpgrade(fedoraPlan, { dryRun: true });

      expect(result.success).toBe(true);
      expect(execSpy).not.toHaveBeenCalled();
    });

    it('refuses to run plans without a supported routine', async () => {
      const result = await applyDistroUpgrade(
        { ...fedoraPlan, supported: false, steps: [] },
        {}
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('No unattended upgrade routine');
    });
  });
});
