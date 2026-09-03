import type { PackageManager } from '../types.js';
import { HomebrewManager } from './homebrew.js';
import { NpmManager } from './npm.js';
import { PnpmManager } from './pnpm.js';
import { BunManager } from './bun.js';
import { YarnManager } from './yarn.js';
import { PythonPipManager } from './python.js';
import { PipxManager } from './pipx.js';
import { CargoManager } from './cargo.js';
import { RubyGemManager } from './gem.js';
import { MacPortsManager } from './macports.js';
import { MacAppStoreManager } from './mas.js';
import { AptManager, FlatpakManager } from './linux.js';

export function createDefaultManagers(): PackageManager[] {
  return [
    new HomebrewManager(),
    new NpmManager(),
    new PnpmManager(),
    new BunManager(),
    new YarnManager(),
    new PythonPipManager(),
    new PipxManager(),
    new CargoManager(),
    new RubyGemManager(),
    new MacPortsManager(),
    new MacAppStoreManager(),
    new AptManager(),
    new FlatpakManager(),
  ];
}

export function filterManagers(
  managers: PackageManager[],
  only?: string[],
  exclude?: string[]
): PackageManager[] {
  let result = [...managers];

  if (only && only.length > 0) {
    const onlySet = new Set(only.map((s) => s.toLowerCase().trim()));
    result = result.filter(
      (m) => onlySet.has(m.id.toLowerCase()) || onlySet.has(m.name.toLowerCase())
    );
  }

  if (exclude && exclude.length > 0) {
    const excludeSet = new Set(exclude.map((s) => s.toLowerCase().trim()));
    result = result.filter(
      (m) => !excludeSet.has(m.id.toLowerCase()) && !excludeSet.has(m.name.toLowerCase())
    );
  }

  return result;
}
