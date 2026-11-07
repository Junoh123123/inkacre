import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { defaultDataDirectory, APP } from '../src/app-info.mjs';

// The command line entry used by ./app-local start, npx, a global install and the Docker image.
test('new installs keep data in the platform application data folder', () => {
  assert.equal(defaultDataDirectory('darwin', {}, '/Users/a'), '/Users/a/Library/Application Support/Pageyard');
  assert.equal(defaultDataDirectory('linux', {}, '/home/a'), `/home/a/.local/share/${APP.id}`);
  assert.equal(defaultDataDirectory('linux', { XDG_DATA_HOME: '/x' }, '/home/a'), `/x/${APP.id}`);
  assert.match(defaultDataDirectory('win32', { APPDATA: 'C:\\Users\\a\\AppData\\Roaming' }, 'C:\\Users\\a'), /Pageyard$/);
});

test('help, version and option errors', () => {
  const run = (...args) => spawnSync(process.execPath, ['bin/cli.mjs', ...args], { encoding: 'utf8' });
  const help = run('--help');
  assert.equal(help.status, 0); assert.match(help.stdout, /--lang <code>/);
  assert.match(run('--version').stdout, /^\d+\.\d+\.\d+/);
  const lang = run('--lang', 'xx', '--no-open');
  assert.equal(lang.status, 2); assert.match(lang.stderr, /Unknown language/);
  assert.equal(run('--bogus').status, 2);
});
