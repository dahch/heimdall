import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getPackageMetadata,
  getPackageVersion,
  clearMetadataCache,
  setFsAdapter,
  FALLBACK_METADATA,
} from '../src/utils/version.js';
import { safeExec } from '../src/utils/exec.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const cliPath = resolve(__dirname, '../src/cli.ts');
const rootPkgPath = resolve(__dirname, '../package.json');

describe('version utility', () => {
  beforeEach(() => {
    clearMetadataCache();
    setFsAdapter(null);
  });

  afterEach(() => {
    clearMetadataCache();
    setFsAdapter(null);
  });

  describe('getPackageVersion', () => {
    it('returns the valid semver version string matching package.json', () => {
      const version = getPackageVersion();
      expect(typeof version).toBe('string');
      expect(version).toMatch(/^\d+\.\d+\.\d+/);
      expect(version).toBe('1.0.0');
    });

    it('falls back to default version when reading fails', () => {
      setFsAdapter({
        readFileSync: () => {
          throw new Error('EACCES');
        },
      });
      const version = getPackageVersion();
      expect(version).toBe('1.0.0');
    });

    it('accepts per-call options with custom fsAdapter without changing global state', () => {
      const version = getPackageVersion({
        bypassCache: true,
        fsAdapter: {
          existsSync: () => true,
          readFileSync: () => JSON.stringify({ version: '9.9.9' }),
        },
      });
      expect(version).toBe('9.9.9');

      // Subsequent call without custom options should not see version 9.9.9
      clearMetadataCache();
      expect(getPackageVersion()).toBe('1.0.0');
    });
  });

  describe('getPackageMetadata', () => {
    it('returns metadata with name "heimdall" and appropriate description', () => {
      const metadata = getPackageMetadata();
      expect(metadata).toBeDefined();
      expect(metadata.name).toBe('heimdall');
      expect(metadata.version).toBe('1.0.0');
      expect(metadata.description).toBe(
        'Heimdall: resilient validator and updater for system and global packages'
      );
    });

    it('caches the resolved metadata for subsequent calls', () => {
      clearMetadataCache();
      const first = getPackageMetadata();
      expect(first.name).toBe('heimdall');

      let readCallCount = 0;
      setFsAdapter({
        readFileSync: (p, enc) => {
          readCallCount++;
          return readFileSync(p, enc);
        },
      });

      // Because cachedMetadata is already populated, it will NOT invoke readFileSync
      const second = getPackageMetadata();
      expect(second).toEqual(first);
      expect(readCallCount).toBe(0);

      // Clearing cache triggers read
      clearMetadataCache();
      const third = getPackageMetadata({ bypassCache: true });
      expect(third).toEqual(first);
      expect(readCallCount).toBeGreaterThan(0);
    });
  });

  describe('options and fsAdapter injection', () => {
    it('prioritizes options.fsAdapter over global customFsAdapter', () => {
      setFsAdapter({
        existsSync: () => true,
        readFileSync: () => JSON.stringify({ name: 'global-pkg', version: '2.0.0' }),
      });

      const metadata = getPackageMetadata({
        bypassCache: true,
        fsAdapter: {
          existsSync: () => true,
          readFileSync: () => JSON.stringify({ name: 'scoped-pkg', version: '3.0.0' }),
        },
      });

      expect(metadata.name).toBe('scoped-pkg');
      expect(metadata.version).toBe('3.0.0');
    });
  });

  describe('resilience and fallback handling', () => {
    it('falls back safely when readFileSync throws an I/O error', () => {
      setFsAdapter({
        readFileSync: () => {
          throw new Error('EACCES: permission denied');
        },
      });

      const metadata = getPackageMetadata({ bypassCache: true });
      expect(metadata).toEqual(FALLBACK_METADATA);
      expect(metadata.name).toBe('heimdall');
      expect(metadata.version).toBe('1.0.0');
    });

    it('falls back safely when package.json contains invalid/corrupted JSON', () => {
      setFsAdapter({
        readFileSync: () => '{ corrupted json: not valid ...',
      });

      const metadata = getPackageMetadata({ bypassCache: true });
      expect(metadata).toEqual(FALLBACK_METADATA);
      expect(metadata.name).toBe('heimdall');
      expect(metadata.version).toBe('1.0.0');
    });

    it('falls back safely when no candidate file exists', () => {
      setFsAdapter({
        existsSync: () => false,
      });

      const metadata = getPackageMetadata({ bypassCache: true });
      expect(metadata).toEqual(FALLBACK_METADATA);
      expect(metadata.name).toBe('heimdall');
      expect(metadata.version).toBe('1.0.0');
    });

    it('falls back safely when package.json has empty or invalid field types', () => {
      setFsAdapter({
        readFileSync: () =>
          JSON.stringify({
            name: '',
            version: 12345,
            description: null,
          }),
      });

      const metadata = getPackageMetadata({ bypassCache: true });
      expect(metadata.name).toBe(FALLBACK_METADATA.name);
      expect(metadata.version).toBe(FALLBACK_METADATA.version);
      expect(metadata.description).toBe(FALLBACK_METADATA.description);
    });

    it('falls back safely when resolving from a nonexistent basePath', () => {
      const metadata = getPackageMetadata({
        basePath: '/nonexistent/path/unlikely_to_exist_xyz_987',
        bypassCache: true,
      });
      // Should still resolve using remaining candidate(s) (e.g. process.cwd() or fallback)
      expect(metadata.name).toBe('heimdall');
      expect(metadata.version).toBe('1.0.0');
    });

    it('handles JSON primitives gracefully (number, boolean, null, string)', () => {
      const primitives = ['123', 'true', 'false', 'null', '"a raw string"'];

      for (const primitive of primitives) {
        setFsAdapter({
          existsSync: () => true,
          readFileSync: () => primitive,
        });

        const metadata = getPackageMetadata({ bypassCache: true });
        expect(metadata).toEqual(FALLBACK_METADATA);
      }
    });

    it('traverses candidates when the first candidate fails and subsequent succeeds', () => {
      let callIndex = 0;
      setFsAdapter({
        existsSync: () => true,
        readFileSync: () => {
          callIndex++;
          if (callIndex === 1) {
            throw new Error('Candidate 1 read failure');
          }
          return JSON.stringify({
            name: 'recovered-app',
            version: '5.6.7',
            description: 'Recovered from second candidate',
          });
        },
      });

      const metadata = getPackageMetadata({ bypassCache: true });
      expect(metadata.name).toBe('recovered-app');
      expect(metadata.version).toBe('5.6.7');
      expect(metadata.description).toBe('Recovered from second candidate');
      expect(callIndex).toBe(2);
    });
  });

  describe('realistic scenarios & data normalization', () => {
    it('trims leading and trailing whitespace from string fields', () => {
      setFsAdapter({
        existsSync: () => true,
        readFileSync: () =>
          JSON.stringify({
            name: '   trimmed-app   ',
            version: '   3.2.1-beta.1   ',
            description: '   A neatly trimmed package   ',
          }),
      });

      const metadata = getPackageMetadata({ bypassCache: true });
      expect(metadata.name).toBe('trimmed-app');
      expect(metadata.version).toBe('3.2.1-beta.1');
      expect(metadata.description).toBe('A neatly trimmed package');
    });

    it('partially falls back only for missing or whitespace-only fields', () => {
      setFsAdapter({
        existsSync: () => true,
        readFileSync: () =>
          JSON.stringify({
            name: '   ', // whitespace only -> fallback
            version: '2.0.4', // valid -> keep
            // description omitted -> fallback
          }),
      });

      const metadata = getPackageMetadata({ bypassCache: true });
      expect(metadata.name).toBe(FALLBACK_METADATA.name);
      expect(metadata.version).toBe('2.0.4');
      expect(metadata.description).toBe(FALLBACK_METADATA.description);
    });
  });

  describe('basePath isolation and caching behavior', () => {
    it('does not mutate or pollute cachedMetadata when basePath is provided', () => {
      // Warm global cache
      const initial = getPackageMetadata();
      expect(initial.name).toBe('heimdall');

      // Read with custom basePath and custom adapter
      const scoped = getPackageMetadata({
        basePath: '/some/custom/dir',
        bypassCache: true,
        fsAdapter: {
          existsSync: () => true,
          readFileSync: () => JSON.stringify({ name: 'isolated-app', version: '4.0.0' }),
        },
      });
      expect(scoped.name).toBe('isolated-app');

      // Subsequent call without basePath still returns original cached metadata
      const cached = getPackageMetadata();
      expect(cached.name).toBe('heimdall');
      expect(cached.version).toBe('1.0.0');
    });
  });

  describe('CLI version integration', () => {
    const tsxBin = resolve(__dirname, '../node_modules/.bin/tsx');

    it('outputs version matching getPackageVersion() when running CLI with --version', async () => {
      const result = await safeExec(tsxBin, [cliPath, '--version']);
      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe(getPackageVersion());
    }, 15000);

    it('outputs version matching getPackageVersion() when running CLI with -V', async () => {
      const result = await safeExec(tsxBin, [cliPath, '-V']);
      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe(getPackageVersion());
    }, 15000);

    it('includes command name and description in CLI --help output', async () => {
      const result = await safeExec(tsxBin, [cliPath, '--help']);
      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('hmd');
      expect(result.stdout).toContain('Heimdall');
    }, 15000);
  });

  describe('repository package.json consistency', () => {
    it('matches root package.json name, version, and description exactly', () => {
      const rawPkg = readFileSync(rootPkgPath, 'utf-8');
      const rootPkg = JSON.parse(rawPkg);

      const metadata = getPackageMetadata({ bypassCache: true });
      expect(metadata.name).toBe(rootPkg.name);
      expect(metadata.version).toBe(rootPkg.version);
      expect(metadata.description).toBe(rootPkg.description);
    });

    it('validates that version conforms strictly to semver format', () => {
      const version = getPackageVersion();
      // Strict semver regex (e.g. 1.0.0 or 1.0.0-alpha.1)
      const semverRegex = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
      expect(version).toMatch(semverRegex);
    });
  });
});
