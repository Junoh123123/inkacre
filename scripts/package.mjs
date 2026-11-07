// Builds the download for this computer's system: Inkacre with its own Node runtime, so nothing else needs to be
// installed. Run on each system (the release workflow does): the runtime is the Node running this script.
//   macOS   → dist/Inkacre-<version>-macos-<arch>.dmg      (a disk image: drag Inkacre.app onto Applications)
//             dist/Inkacre-<version>-macos-<arch>.zip      (the same app, zipped)
//   Windows → dist/Inkacre-<version>-windows-<arch>.zip    (Inkacre\Inkacre.exe)
//   Linux   → dist/Inkacre-<version>-linux-<arch>.tar.gz   (inkacre/inkacre)
// Opening the app starts it in the background with its data in the system's per-user app folder and opens the
// browser (bin/cli.mjs `app`). 사용법: node scripts/package.mjs [--out dist] [--no-archive]
// If Node's distribution puts its LICENSE elsewhere, set NODE_LICENSE_PATH to that distribution's full LICENSE.
// macOS signing (the release workflow sets these from the repository's secrets): MACOS_SIGN_IDENTITY — a
// "Developer ID Application: …" identity in the keychain — signs the app and the disk image; with APPLE_API_KEY_PATH,
// APPLE_API_KEY_ID and APPLE_API_ISSUER_ID (an App Store Connect API key) both are notarized and stapled, so macOS
// opens them without a warning.
import { execFileSync } from 'node:child_process';
import { chmodSync, closeSync, copyFileSync, cpSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP } from '../src/app-info.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const outDir = path.resolve(args.includes('--out') ? args[args.indexOf('--out') + 1] : path.join(root, 'dist'));
const archive = !args.includes('--no-archive');
const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const system = { darwin: 'macos', win32: 'windows', linux: 'linux' }[process.platform];
if (!system) throw new Error(`No package for ${process.platform}.`);
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 16)) throw new Error(`The bundled runtime would be Node ${process.versions.node}; 22.16 or newer is needed (24 recommended).`);
const name = `${APP.name}-${version}-${system}-${process.arch}`;
const stage = path.join(outDir, name);
const macApp = `${APP.name}.app`;
// A step's errors are shown as they come and, on GitHub Actions, also as an annotation on the run (its log can't
// always be read from where the build is looked at).
function run(command, list, options = {}) {
  try { return execFileSync(command, list, { stdio: ['inherit', 'inherit', 'pipe'], ...options }); }
  catch (error) {
    const said = error.stderr?.toString().trim() ?? '';
    if (said) console.error(said);
    throw new Error(`${path.basename(command)} failed${said ? `: ${said.split('\n').slice(-12).join('\n')}` : ''}`);
  }
}
process.on('uncaughtException', error => {
  console.error(error.stack ?? error);
  if (process.env.GITHUB_ACTIONS) console.log(`::error title=Package build::${String(error.message).replace(/%/g, '%25').replace(/\r?\n/g, '%0A')}`);
  process.exit(1);
});
const identity = system === 'macos' ? process.env.MACOS_SIGN_IDENTITY || null : null;
const notary = system === 'macos' && process.env.APPLE_API_KEY_PATH && process.env.APPLE_API_KEY_ID && process.env.APPLE_API_ISSUER_ID
  ? ['--key', process.env.APPLE_API_KEY_PATH, '--key-id', process.env.APPLE_API_KEY_ID, '--issuer', process.env.APPLE_API_ISSUER_ID] : null;
if (notary && !identity) throw new Error('Notarizing needs MACOS_SIGN_IDENTITY as well.');

const uiNotices = path.join(root, 'web', 'app', 'THIRD_PARTY_NOTICES.md');
if (!existsSync(uiNotices)) throw new Error('Missing UI license notices. Run npm run build before packaging.');
const nodeBin = path.dirname(process.execPath);
const licenseCandidates = process.env.NODE_LICENSE_PATH
  ? [process.env.NODE_LICENSE_PATH]
  : [path.join(nodeBin, 'LICENSE'), path.resolve(nodeBin, '..', 'LICENSE')];
const nodeLicense = licenseCandidates.find(file =>
  existsSync(file) && readFileSync(file, 'utf8').startsWith('Node.js is licensed for use as follows:'));
if (!nodeLicense) throw new Error(`Missing the full LICENSE for Node ${process.version}. Set NODE_LICENSE_PATH to the LICENSE from this Node distribution.`);

rmSync(stage, { recursive: true, force: true });
// Where the app, the runtime and the launcher go in each layout.
const layout = system === 'macos'
  ? { top: path.join(stage, macApp), app: 'Contents/Resources/app', runtime: 'Contents/Resources/runtime' }
  : { top: path.join(stage, system === 'windows' ? APP.name : APP.command), app: 'app', runtime: 'runtime' };
const appDir = path.join(layout.top, layout.app), runtimeDir = path.join(layout.top, layout.runtime);
const macLauncher = path.join(layout.top, 'Contents', 'MacOS', APP.name);
mkdirSync(appDir, { recursive: true }); mkdirSync(runtimeDir, { recursive: true });

// The app: what `npm install` would ship (bin, src, web — the interface already built) and its runtime dependencies.
for (const item of ['bin', 'src', 'web']) cpSync(path.join(root, item), path.join(appDir, item), { recursive: true });
for (const file of ['LICENSE', 'package.json', 'package-lock.json']) copyFileSync(path.join(root, file), path.join(appDir, file));
run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: appDir, shell: process.platform === 'win32' });

// The runtime: this Node.
const node = path.join(runtimeDir, process.platform === 'win32' ? 'node.exe' : 'node');
copyFileSync(process.execPath, node); chmodSync(node, 0o755);
copyFileSync(nodeLicense, path.join(runtimeDir, 'LICENSE'));

const packaging = path.join(root, 'packaging');
if (system === 'macos') {
  const contents = path.join(layout.top, 'Contents');
  mkdirSync(path.join(contents, 'MacOS'), { recursive: true });
  writeFileSync(path.join(contents, 'Info.plist'), readFileSync(path.join(packaging, 'macos', 'Info.plist'), 'utf8')
    .replaceAll('@VERSION@', version).replaceAll('@NAME@', APP.name));
  run('clang', ['-O2', '-mmacosx-version-min=13.5', '-o', macLauncher, path.join(packaging, 'macos', 'launcher.c')]);
  copyFileSync(path.join(packaging, 'icons', 'AppIcon.icns'), path.join(contents, 'Resources', 'AppIcon.icns'));
} else if (system === 'windows') {
  // Build the launcher with the C# compiler that ships with Windows.
  const windir = process.env.WINDIR ?? 'C:\\Windows';
  const csc = ['Framework64', 'Framework'].map(dir => path.join(windir, 'Microsoft.NET', dir, 'v4.0.30319', 'csc.exe')).find(existsSync);
  if (!csc) throw new Error('The C# compiler (csc.exe, .NET Framework 4) was not found.');
  run(csc, ['/nologo', '/target:winexe', '/optimize+', `/win32icon:${path.join(packaging, 'icons', APP.command + '.ico')}`,
    '/reference:System.Windows.Forms.dll', `/out:${path.join(layout.top, APP.name + '.exe')}`, path.join(packaging, 'windows', 'Launcher.cs')]);
} else {
  const launcher = path.join(layout.top, APP.command);
  copyFileSync(path.join(packaging, 'linux', APP.command), launcher);
  chmodSync(launcher, 0o755);
  copyFileSync(path.join(packaging, 'icons', APP.command + '.png'), path.join(layout.top, APP.command + '.png'));
}

// Signing, inside out: every program in the app (the Node gets the entitlements its JavaScript engine needs under the
// hardened runtime), the launcher, then the app itself, which seals everything else in it. Then notarized and stapled.
const signed = file => run('codesign', ['--force', '--timestamp', '--options', 'runtime', ...(file === node ? ['--entitlements', path.join(packaging, 'macos', 'node.entitlements')] : []), '--sign', identity, file]);
if (identity) {
  for (const file of machOFiles(path.join(layout.top, 'Contents', 'Resources'))) signed(file);
  signed(macLauncher);
  signed(layout.top);
} else if (system === 'macos') {
  // Without a Developer ID the app is still sealed whole with an ad-hoc signature. The compiler signs only the
  // launcher, and an app whose launcher is signed but whose contents aren't is "damaged" to macOS (no way to open it);
  // sealed, it is an app from an unidentified developer, which System Settings › Privacy & Security can allow.
  run('codesign', ['--force', '--sign', '-', macLauncher]);
  run('codesign', ['--force', '--sign', '-', layout.top]);
}
if (system === 'macos') run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', layout.top]);
if (notary) {
  const submission = path.join(stage, 'notarize.zip');
  run('ditto', ['-c', '-k', '--keepParent', layout.top, submission]);
  notarize(submission);
  run('xcrun', ['stapler', 'staple', layout.top]);
  run('spctl', ['--assess', '--type', 'execute', '--verbose=2', layout.top]);
  rmSync(submission);
}

if (archive) {
  const target = path.join(outDir, `${name}${system === 'linux' ? '.tar.gz' : '.zip'}`);
  rmSync(target, { force: true });
  if (system === 'macos') run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', layout.top, target]);
  else if (system === 'windows') run('tar.exe', ['-a', '-c', '-f', target, '-C', stage, path.basename(layout.top)]);
  else run('tar', ['-czf', target, '-C', stage, path.basename(layout.top)]);
  console.log(`package → ${path.relative(root, target)}`);
}

// macOS disk image: the app and a link to Applications side by side over a background that says to drag one onto
// the other (laid out by create-dmg, which the release workflow installs; without it, or if it can't arrange the
// Finder window, a plain image with the same two items).
if (archive && system === 'macos') {
  const dmg = path.join(outDir, `${name}.dmg`), source = path.join(stage, 'disk-image');
  rmSync(dmg, { force: true }); rmSync(source, { recursive: true, force: true }); mkdirSync(source);
  run('ditto', [layout.top, path.join(source, macApp)]);
  // Unsigned, the background also says how to allow the app the first time; signed and notarized it needn't.
  const backgroundTiff = path.join(stage, 'dmg-background.tiff'), background = notary ? 'dmg-background' : 'dmg-background-unsigned';
  run('tiffutil', ['-cathidpicheck', path.join(packaging, 'macos', `${background}.png`), path.join(packaging, 'macos', `${background}@2x.png`), '-out', backgroundTiff]);
  let laidOut = false;
  try { execFileSync('which', ['create-dmg'], { stdio: 'ignore' }); laidOut = true; } catch { console.warn('create-dmg is not installed: a plain disk image.'); }
  if (laidOut) {
    try {
      run('create-dmg', ['--volname', APP.name, '--volicon', path.join(packaging, 'icons', 'AppIcon.icns'), '--background', backgroundTiff,
        '--window-pos', '200', '120', '--window-size', '600', '400', '--icon-size', '128', '--text-size', '13',
        '--icon', macApp, '160', '180', '--hide-extension', macApp, '--app-drop-link', '440', '180', dmg, source]);
    } catch { console.warn('create-dmg could not lay out the window: a plain disk image.'); laidOut = false; rmSync(dmg, { force: true }); }
  }
  if (!laidOut) {
    symlinkSync('/Applications', path.join(source, 'Applications'));
    run('hdiutil', ['create', '-volname', APP.name, '-srcfolder', source, '-ov', '-format', 'UDZO', dmg]);
  }
  if (process.env.GITHUB_ACTIONS) console.log(laidOut ? '::notice title=Disk image::Laid out: background, the app beside Applications.' : '::warning title=Disk image::Plain disk image (create-dmg did not lay out the window).');
  if (identity) run('codesign', ['--force', '--timestamp', '--sign', identity, dmg]);
  if (notary) {
    notarize(dmg);
    run('xcrun', ['stapler', 'staple', dmg]);
    run('spctl', ['--assess', '--type', 'open', '--context', 'context:primary-signature', '--verbose=2', dmg]);
  }
  console.log(`package → ${path.relative(root, dmg)}${notary ? ' (signed, notarized)' : identity ? ' (signed)' : ''}`);
}
console.log(`folder  → ${path.relative(root, layout.top)}`);

// Programs (Mach-O files, single or universal) anywhere under a folder.
function machOFiles(folder) {
  const found = [];
  for (const entry of readdirSync(folder, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath ?? entry.path, entry.name), head = Buffer.alloc(8), fd = openSync(file, 'r');
    const read = readSync(fd, head, 0, 8, 0); closeSync(fd);
    if (read < 8) continue;
    const magic = head.readUInt32BE(0);
    if (magic === 0xcffaedfe || magic === 0xcefaedfe || magic === 0xfeedfacf || magic === 0xfeedface) found.push(file);
    else if (magic === 0xcafebabe && head.readUInt32BE(4) < 20) found.push(file); // universal (a Java class has its version here)
  }
  return found;
}
// Sends a file to Apple's notary service and waits; anything but "Accepted" stops the build with Apple's log.
function notarize(file) {
  const result = JSON.parse(execFileSync('xcrun', ['notarytool', 'submit', file, ...notary, '--wait', '--output-format', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }));
  if (result.status !== 'Accepted') {
    try { console.log(execFileSync('xcrun', ['notarytool', 'log', result.id, ...notary], { encoding: 'utf8' })); } catch { /* no log */ }
    throw new Error(`Notarization of ${path.basename(file)}: ${result.status}`);
  }
  console.log(`notarized ${path.basename(file)} (${result.id})`);
}
