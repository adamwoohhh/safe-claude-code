import React, {useMemo, useState} from 'react';
import {Box, render, Text, useApp, useInput} from 'ink';
import type {CliName, Feature} from './features.js';
import type {DetectedCli, NetworkInfo, ProxyType} from './launcher.js';

type Resolver<T> = (value: T) => void;

function groupLabel(group: string): string {
  return group.includes(':') ? group.split(':').slice(1).join(':') : group;
}

type Row =
  | {kind: 'group'; group: string}
  | {kind: 'feature'; featureIndex: number; group: string};

function groupMark(features: Feature[], group: string): string {
  const members = features.filter(feature => feature.group === group);
  const selected = members.filter(feature => feature.selected).length;
  if (selected === 0) {
    return '[ ]';
  }
  if (selected === members.length) {
    return '[x]';
  }
  return '[-]';
}

function groupSize(features: Feature[], group: string): number {
  return features.filter(feature => feature.group === group).length;
}

function buildRows(features: Feature[], collapsedGroups: Set<string>): Row[] {
  const rows: Row[] = [];
  let previousGroup = '';

  features.forEach((feature, featureIndex) => {
    if (feature.group !== previousGroup) {
      previousGroup = feature.group;
      rows.push({kind: 'group', group: feature.group});
    }
    if (!collapsedGroups.has(feature.group)) {
      rows.push({kind: 'feature', featureIndex, group: feature.group});
    }
  });

  return rows;
}

function initialCollapsedGroups(features: Feature[]): Set<string> {
  const groups = new Set(features.map(feature => feature.group));
  return new Set([...groups].filter(group => groupSize(features, group) > 5));
}

function initialCursor(rows: Row[]): number {
  const firstItem = rows.findIndex(row => row.kind === 'feature');
  return firstItem >= 0 ? firstItem : 0;
}

function CliSelector({clis, resolve}: {clis: DetectedCli[]; resolve: Resolver<DetectedCli | undefined>}) {
  const {exit} = useApp();
  const [selected, setSelected] = useState(0);

  useInput((input, key) => {
    if (input === 'q') {
      resolve(undefined);
      exit();
      return;
    }
    if (key.upArrow) {
      setSelected(current => current === 0 ? clis.length - 1 : current - 1);
      return;
    }
    if (key.downArrow) {
      setSelected(current => (current + 1) % clis.length);
      return;
    }
    if (key.return) {
      resolve(clis[selected]);
      exit();
    }
  });

  return (
    <Box flexDirection="column">
      <Text>Select CLI to launch:</Text>
      <Text> </Text>
      {clis.map((cli, index) => (
        <Text key={cli.name}>
          {index === selected ? '>' : ' '} {cli.name.padEnd(10)} {cli.path}
        </Text>
      ))}
      <Text> </Text>
      <Text dimColor>up/down move, Enter select, q cancel</Text>
    </Box>
  );
}

function FeatureSelector({features: initialFeatures, resolve}: {features: Feature[]; resolve: Resolver<Feature[] | undefined>}) {
  const {exit} = useApp();
  const [features, setFeatures] = useState(initialFeatures);
  const [collapsed, setCollapsed] = useState(() => initialCollapsedGroups(initialFeatures));
  const rows = useMemo(() => buildRows(features, collapsed), [features, collapsed]);
  const [cursor, setCursor] = useState(() => initialCursor(buildRows(initialFeatures, initialCollapsedGroups(initialFeatures))));
  const bodyLines = 16;
  const scroll = Math.max(0, Math.min(
    Math.max(0, rows.length - bodyLines),
    cursor < 3 ? 0 : cursor - bodyLines + 4
  ));
  const visibleRows = rows.slice(scroll, scroll + bodyLines);

  const toggleGroup = (group: string) => {
    const anySelected = features.some(feature => feature.group === group && feature.selected);
    setFeatures(current => current.map(feature => feature.group === group ? {...feature, selected: !anySelected} : feature));
  };

  useInput((input, key) => {
    const row = rows[cursor];
    if (input === 'q') {
      resolve(undefined);
      exit();
      return;
    }
    if (input === 'a' || input === 'A') {
      const anySelected = features.some(feature => feature.selected);
      setFeatures(current => current.map(feature => ({...feature, selected: !anySelected})));
      return;
    }
    if (key.upArrow) {
      setCursor(current => current === 0 ? rows.length - 1 : current - 1);
      return;
    }
    if (key.downArrow) {
      setCursor(current => (current + 1) % rows.length);
      return;
    }
    if (key.leftArrow && row) {
      if (row.kind === 'group' || row.kind === 'feature') {
        setCollapsed(current => new Set(current).add(row.group));
        const groupRow = rows.findIndex(candidate => candidate.kind === 'group' && candidate.group === row.group);
        if (groupRow >= 0) {
          setCursor(groupRow);
        }
      }
      return;
    }
    if (key.rightArrow && row?.kind === 'group') {
      setCollapsed(current => {
        const next = new Set(current);
        next.delete(row.group);
        return next;
      });
      return;
    }
    if (input === ' ' && row) {
      if (row.kind === 'group') {
        toggleGroup(row.group);
      } else {
        setFeatures(current => current.map((feature, index) => (
          index === row.featureIndex ? {...feature, selected: !feature.selected} : feature
        )));
      }
      return;
    }
    if (key.return) {
      resolve(features);
      exit();
    }
  });

  return (
    <Box flexDirection="column">
      <Text>Select features to enable:</Text>
      <Text> </Text>
      {visibleRows.map((row, index) => {
        const absoluteIndex = scroll + index;
        const pointer = absoluteIndex === cursor ? '>' : ' ';
        if (row.kind === 'group') {
          const suffix = collapsed.has(row.group)
            ? ` (${groupSize(features, row.group)}, collapsed)`
            : ` (${groupSize(features, row.group)})`;
          return <Text key={`${row.group}-${absoluteIndex}`}>{pointer} {groupMark(features, row.group)} <Text bold>{groupLabel(row.group)}</Text>{suffix}</Text>;
        }
        const feature = features[row.featureIndex]!;
        return (
          <Text key={`${feature.type}-${feature.name}`}>
            {pointer}   {feature.selected ? '[x]' : '[ ]'} {feature.type.padEnd(7)} {feature.name}
          </Text>
        );
      })}
      {Array.from({length: Math.max(0, bodyLines - visibleRows.length)}).map((_, index) => <Text key={`blank-${index}`}> </Text>)}
      <Text> </Text>
      <Text dimColor>up/down move, left/right collapse/expand, Space toggle, Enter continue, a toggle all, q cancel</Text>
    </Box>
  );
}

function proxyTypeLabel(proxyType: ProxyType): string {
  switch (proxyType) {
    case 'no-proxy':
      return 'no proxy';
    case 'http-proxy':
      return 'HTTP proxy';
    case 'socks5-proxy':
      return 'SOCKS5 proxy';
    case 'virtual-nic-proxy':
      return 'virtual NIC proxy';
    case 'unknown':
      return 'unknown';
  }
}

function Confirm({cli, networkInfo, resolve}: {cli: CliName; networkInfo: NetworkInfo; resolve: Resolver<boolean>}) {
  const {exit} = useApp();

  useInput((input, key) => {
    if (key.return || input === 'y' || input === 'Y') {
      resolve(true);
      exit();
      return;
    }
    if (input === 'n' || input === 'N') {
      resolve(false);
      exit();
    }
  });

  return (
    <Box flexDirection="column">
      <Text>Public IP check:</Text>
      <Text>{networkInfo.publicIpInfo}</Text>
      <Text> </Text>
      <Text>Local proxy type: {proxyTypeLabel(networkInfo.proxyType)}</Text>
      <Text> </Text>
      <Text>Continue and launch {cli}? [Y/n]</Text>
    </Box>
  );
}

function NetworkFailure({message, resolve}: {message: string; resolve: Resolver<boolean>}) {
  const {exit} = useApp();

  useInput((input, key) => {
    if (input === 'y' || input === 'Y') {
      resolve(true);
      exit();
      return;
    }
    if (key.return || input === 'n' || input === 'N') {
      resolve(false);
      exit();
    }
  });

  return (
    <Box flexDirection="column">
      <Text>Public IP check failed:</Text>
      <Text>{message}</Text>
      <Text> </Text>
      <Text>Ignore this failure and continue? [y/N]</Text>
    </Box>
  );
}

async function renderPrompt<T>(element: React.ReactElement): Promise<T> {
  if (!process.stdin.isTTY) {
    throw new Error('Interactive selection requires a TTY.');
  }
  return await new Promise<T>(resolve => {
    render(React.cloneElement(element, {resolve}));
  });
}

export async function promptCli(clis: DetectedCli[]): Promise<DetectedCli> {
  const selected = await renderPrompt<DetectedCli | undefined>(<CliSelector clis={clis} resolve={() => undefined} />);
  if (!selected) {
    throw new Error('Cancelled.');
  }
  return selected;
}

export async function promptFeatures(features: Feature[], _cli: CliName): Promise<Feature[]> {
  const selected = await renderPrompt<Feature[] | undefined>(<FeatureSelector features={features} resolve={() => undefined} />);
  if (!selected) {
    throw new Error('Cancelled.');
  }
  return selected;
}

export async function promptConfirm(cli: CliName, networkInfo: NetworkInfo): Promise<boolean> {
  return await renderPrompt<boolean>(<Confirm cli={cli} networkInfo={networkInfo} resolve={() => undefined} />);
}

export async function promptNetworkFailure(message: string): Promise<boolean> {
  return await renderPrompt<boolean>(<NetworkFailure message={message} resolve={() => undefined} />);
}
