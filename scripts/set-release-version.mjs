#!/usr/bin/env node
// Apply the user's chosen version in a workflow checkout before building.
import { readFileSync, writeFileSync } from 'node:fs';
import { URL } from 'node:url';

const version = process.argv[2] ?? '';
const components = version.split('.');
if (
  !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(version) ||
  components.some((component) => Number(component) > 65535) ||
  components.every((component) => Number(component) === 0)
) {
  throw new Error('Choose an extension version x.y.z (without v), components 0–65535, not all zero.');
}

const paths = ['package.json', 'package-lock.json', 'public/manifest.json'];
// Read and validate every file before writing any of them.
const files = paths.map((path) => {
  const url = new URL(`../${path}`, import.meta.url);
  return { url, data: JSON.parse(readFileSync(url, 'utf8')) };
});
if (!files[1].data.packages?.['']) throw new Error('Missing package-lock.json root package.');
for (const { url, data } of files) {
  data.version = version;
  if (data.packages) data.packages[''].version = version;
  writeFileSync(url, `${JSON.stringify(data, null, 2)}\n`);
}
console.log(`Release checkout version set to ${version}.`);
