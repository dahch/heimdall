import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

export interface PackageMetadata {
  name: string;
  version: string;
  description: string;
}

export interface VersionFsAdapter {
  existsSync: (path: string) => boolean;
  readFileSync: (path: string, encoding: 'utf-8') => string;
}

export const FALLBACK_METADATA: PackageMetadata = {
  name: '@dahch/heimdall',
  version: '1.0.0',
  description: 'Heimdall: resilient validator and updater for system and global packages',
};

let cachedMetadata: PackageMetadata | null = null;
let customFsAdapter: Partial<VersionFsAdapter> | null = null;

/**
 * Resets the in-memory cached package metadata.
 */
export function clearMetadataCache(): void {
  cachedMetadata = null;
}

/**
 * Allows injecting custom fs functions (primarily for testing edge cases).
 */
export function setFsAdapter(adapter: Partial<VersionFsAdapter> | null): void {
  customFsAdapter = adapter;
}

export interface ResolveOptions {
  bypassCache?: boolean;
  basePath?: string;
  fsAdapter?: Partial<VersionFsAdapter>;
}

/**
 * Resolves package metadata by testing candidate package.json locations.
 */
function resolvePackageMetadata(options?: ResolveOptions): PackageMetadata {
  const exists = options?.fsAdapter?.existsSync ?? customFsAdapter?.existsSync ?? existsSync;
  const read = options?.fsAdapter?.readFileSync ?? customFsAdapter?.readFileSync ?? readFileSync;

  try {
    let currentDir: string | undefined;

    if (options?.basePath) {
      currentDir = options.basePath;
    } else {
      try {
        if (typeof import.meta !== 'undefined' && import.meta.url) {
          currentDir = dirname(fileURLToPath(import.meta.url));
        }
      } catch {
        // Safe fallback if URL conversion fails
      }
    }

    const candidates: string[] = [];

    if (currentDir) {
      candidates.push(
        resolve(currentDir, '../package.json'),
        resolve(currentDir, '../../package.json'),
        resolve(currentDir, './package.json')
      );
    }


    for (const candidate of candidates) {
      try {
        if (exists(candidate)) {
          const raw = read(candidate, 'utf-8');
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object') {
            const name =
              typeof parsed.name === 'string' && parsed.name.trim().length > 0
                ? parsed.name.trim()
                : FALLBACK_METADATA.name;

            const version =
              typeof parsed.version === 'string' && parsed.version.trim().length > 0
                ? parsed.version.trim()
                : FALLBACK_METADATA.version;

            const description =
              typeof parsed.description === 'string' && parsed.description.trim().length > 0
                ? parsed.description.trim()
                : FALLBACK_METADATA.description;

            return { name, version, description };
          }
        }
      } catch {
        // Continue to the next candidate if reading or parsing fails
        continue;
      }
    }
  } catch {
    // Safe top-level fallback
  }

  return { ...FALLBACK_METADATA };
}

/**
 * Returns package metadata (name, version, description) dynamically resolved
 * from package.json with safe fallbacks.
 */
export function getPackageMetadata(options?: ResolveOptions): PackageMetadata {
  if (!options?.bypassCache && cachedMetadata && !options?.basePath) {
    return cachedMetadata;
  }

  const meta = resolvePackageMetadata(options);
  if (!options?.basePath) {
    cachedMetadata = meta;
  }
  return meta;
}

/**
 * Returns the resolved package version string.
 */
export function getPackageVersion(options?: ResolveOptions): string {
  return getPackageMetadata(options).version;
}
