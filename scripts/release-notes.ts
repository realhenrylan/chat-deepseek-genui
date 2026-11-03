#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const categories: Record<string, string> = {
  added: '新增',
  changed: '更改',
  fixed: '修复',
  removed: '移除',
  deprecated: '弃用',
  security: '安全',
  validation: '验证情况',
  'breaking changes': '不兼容更改',
};

/** Prefer a version's curated notes; otherwise use only the current Unreleased section. */
export function renderReleaseNotes(changelog: string, version: string): string {
  if (!/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(version)) {
    throw new Error('Expected a release version x.y.z without v.');
  }

  const sections: { heading: string; lines: string[] }[] = [];
  let current: (typeof sections)[number] | undefined;
  let fence: string | undefined;
  for (const line of changelog.split(/\r?\n/)) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker && !fence) {
      fence = marker;
    } else if (fence && marker?.[0] === fence[0] && marker.length >= fence.length) {
      fence = undefined;
    } else if (!fence) {
      const heading = /^##\s+(.+?)\s*$/.exec(line)?.[1];
      if (heading) {
        current = { heading, lines: [] };
        sections.push(current);
        continue;
      }
    }
    current?.lines.push(line);
  }

  const selected = sections.find((section) =>
    /^\[?v?(\d+\.\d+\.\d+)\]?(?=$|[\s（(])/u.exec(section.heading)?.[1] === version,
  ) ?? sections.find((section) => /^\[?Unreleased\]?$/i.test(section.heading));
  const body = selected?.lines.join('\n').trim() ?? '';
  if (!body.replace(/^#{1,6}\s+.*$/gm, '').trim()) {
    throw new Error(`No release notes for ${version}; add entries to CHANGELOG.md before preparing a draft.`);
  }

  const translated = body.replace(/^###\s+(.+?)\s*$/gm, (heading, label: string) => {
    const translatedLabel = categories[label.toLowerCase()];
    return translatedLabel ? `### ${translatedLabel}` : heading;
  });
  return `## 本版更新\n\n${translated}\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  process.stdout.write(renderReleaseNotes(changelog, process.argv[2] ?? ''));
}
