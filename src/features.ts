import {readdir, readFile, realpath, stat} from 'node:fs/promises';
import path from 'node:path';

export type CliName = 'codex' | 'claude';
export type FeatureType = 'skill' | 'plugin';

export type Feature = {
  type: FeatureType;
  name: string;
  path: string;
  selected: boolean;
  group: string;
};

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function realDir(dir: string): Promise<string | undefined> {
  try {
    return await realpath(dir);
  } catch {
    return undefined;
  }
}

async function discoverSkillDir(root: string): Promise<Feature[]> {
  if (!(await pathExists(root))) {
    return [];
  }

  const features: Feature[] = [];
  const entries = await readdir(root, {withFileTypes: true});
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) {
      continue;
    }

    const entryPath = path.join(root, entry.name);
    const resolved = await realDir(entryPath);
    if (!resolved) {
      continue;
    }

    if (await pathExists(path.join(resolved, 'SKILL.md'))) {
      features.push({
        type: 'skill',
        name: entry.name,
        path: resolved,
        selected: true,
        group: 'skill'
      });
      continue;
    }

    const children = await readdir(resolved, {withFileTypes: true}).catch(() => []);
    for (const child of children.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!child.isDirectory() && !child.isSymbolicLink()) {
        continue;
      }
      const childPath = path.join(resolved, child.name);
      const childResolved = await realDir(childPath);
      if (!childResolved || !(await pathExists(path.join(childResolved, 'SKILL.md')))) {
        continue;
      }
      features.push({
        type: 'skill',
        name: `${entry.name}:${child.name}`,
        path: childResolved,
        selected: true,
        group: 'skill'
      });
    }
  }

  return features;
}

async function discoverCodexPlugins(home: string): Promise<Feature[]> {
  const configPath = path.join(home, '.codex/config.toml');
  const config = await readFile(configPath, 'utf8').catch(() => '');
  if (!config) {
    return [];
  }

  const features: Feature[] = [];
  let plugin = '';
  for (const line of config.split(/\r?\n/)) {
    const header = line.match(/^\[plugins\."([^"]+)"\]$/);
    if (header) {
      plugin = header[1] ?? '';
      continue;
    }
    if (plugin && /^enabled\s*=\s*true\s*$/.test(line)) {
      features.push({
        type: 'plugin',
        name: plugin,
        path: configPath,
        selected: true,
        group: 'plugin'
      });
      plugin = '';
    }
  }
  return features;
}

async function discoverClaudePlugins(home: string): Promise<Feature[]> {
  const root = path.join(home, '.claude/plugins/marketplaces');
  if (!(await pathExists(root))) {
    return [];
  }

  const features: Feature[] = [];
  const marketplaces = await readdir(root, {withFileTypes: true}).catch(() => []);
  for (const marketplace of marketplaces.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!marketplace.isDirectory() && !marketplace.isSymbolicLink()) {
      continue;
    }
    for (const section of ['plugins', 'external_plugins']) {
      const sectionPath = path.join(root, marketplace.name, section);
      const plugins = await readdir(sectionPath, {withFileTypes: true}).catch(() => []);
      for (const plugin of plugins.sort((a, b) => a.name.localeCompare(b.name))) {
        if (!plugin.isDirectory() && !plugin.isSymbolicLink()) {
          continue;
        }
        const pluginPath = path.join(sectionPath, plugin.name);
        if (!(await pathExists(path.join(pluginPath, '.claude-plugin/plugin.json')))) {
          continue;
        }
        features.push({
          type: 'plugin',
          name: `${marketplace.name}:${plugin.name}`,
          path: (await realDir(pluginPath)) ?? pluginPath,
          selected: true,
          group: 'plugin'
        });
      }
    }
  }
  return features;
}

export async function discoverFeatures(cli: CliName, home = process.env.HOME ?? ''): Promise<Feature[]> {
  const features = cli === 'codex'
    ? [
        ...(await discoverSkillDir(path.join(home, '.agents/skills'))),
        ...(await discoverSkillDir(path.join(home, '.codex/skills'))),
        ...(await discoverCodexPlugins(home))
      ]
    : [
        ...(await discoverSkillDir(path.join(home, '.claude/skills'))),
        ...(await discoverClaudePlugins(home))
      ];

  return groupFeatures(sortFeatures(features));
}

function typeRank(type: FeatureType): number {
  return type === 'skill' ? 0 : 1;
}

function baseName(feature: Pick<Feature, 'type' | 'name'>): string {
  if (feature.type === 'plugin' && feature.name.includes(':')) {
    return feature.name.split(':').slice(1).join(':');
  }
  return feature.name;
}

export function sortFeatures(features: Feature[]): Feature[] {
  return [...features].sort((a, b) => {
    const rank = typeRank(a.type) - typeRank(b.type);
    if (rank !== 0) {
      return rank;
    }
    const nameOrder = baseName(a).localeCompare(baseName(b));
    if (nameOrder !== 0) {
      return nameOrder;
    }
    return a.name.localeCompare(b.name);
  });
}

function prefixFor(feature: Feature): string {
  const base = baseName(feature);
  if (feature.type === 'skill' && feature.name.includes(':')) {
    return feature.name.split(':')[0] ?? base;
  }
  if (base.includes('-')) {
    return base.split('-')[0] ?? base;
  }
  return base;
}

export function groupFeatures(features: Feature[]): Feature[] {
  return features.map(feature => {
    const prefix = prefixFor(feature);
    const matches = features.filter(candidate => {
      if (candidate.type !== feature.type) {
        return false;
      }
      const candidateBase = baseName(candidate);
      if (candidate.type === 'skill' && candidate.name.startsWith(`${prefix}:`)) {
        return true;
      }
      return candidateBase === prefix || candidateBase.startsWith(`${prefix}-`);
    }).length;

    return {
      ...feature,
      group: matches > 1 ? `${feature.type}:${prefix}` : feature.type
    };
  });
}

export function buildCodexFeatureArgs(features: Feature[]): string[] {
  const disabled = features.filter(feature => !feature.selected);
  const skills = disabled
    .filter(feature => feature.type === 'skill')
    .map(feature => `{path="${path.join(feature.path, 'SKILL.md')}",enabled=false}`);
  const args: string[] = [];

  if (skills.length > 0) {
    args.push('-c', `skills.config=[${skills.join(',')}]`);
  }

  for (const plugin of disabled.filter(feature => feature.type === 'plugin')) {
    args.push('-c', `plugins."${plugin.name}".enabled=false`);
  }

  return args;
}

export function buildClaudeFeatureArgs(features: Feature[]): string[] {
  const disabled = features.filter(feature => !feature.selected);
  const skillOverrides: Record<string, 'off'> = {};
  const enabledPlugins: Record<string, false> = {};

  for (const feature of disabled) {
    if (feature.type === 'skill') {
      skillOverrides[feature.name] = 'off';
      continue;
    }
    if (feature.name.includes(':')) {
      const [marketplace, plugin] = feature.name.split(':');
      if (marketplace && plugin) {
        enabledPlugins[`${plugin}@${marketplace}`] = false;
      }
    } else {
      enabledPlugins[feature.name] = false;
    }
  }

  const settings: {skillOverrides?: Record<string, 'off'>; enabledPlugins?: Record<string, false>} = {};
  if (Object.keys(skillOverrides).length > 0) {
    settings.skillOverrides = skillOverrides;
  }
  if (Object.keys(enabledPlugins).length > 0) {
    settings.enabledPlugins = enabledPlugins;
  }

  if (Object.keys(settings).length === 0) {
    return [];
  }
  return ['--settings', JSON.stringify(settings)];
}

export function buildFeatureArgs(cli: CliName, features: Feature[]): string[] {
  return cli === 'codex' ? buildCodexFeatureArgs(features) : buildClaudeFeatureArgs(features);
}
