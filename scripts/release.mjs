// Publishes a new version that installed apps pick up automatically.
//
//   npm run release                    -> next patch version (0.2.0 -> 0.2.1)
//   npm run release -- minor           -> 0.3.0   (or: major, or an exact 1.2.3)
//   npm run release -- --notes "Tekst" -> release notes shown in the update notice
//
// Steps: bump version, test, build + sign the installer (low priority),
// write latest.json, commit + tag + push, create a GitHub release.
// Needs: clean git tree, gh logged in, signing key in ~/.tauri/editor.key.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const REPO = 'esv25/editor';
const root = path.resolve(import.meta.dirname, '..');
const keyPath = path.join(homedir(), '.tauri', 'editor.key');

// npx is a .cmd script on Windows and needs a shell; git and gh don't, and running
// them without one keeps arguments with spaces (commit messages, titles) intact.
const run = (cmd, args, opts = {}) =>
  (execFileSync(cmd, args, { cwd: root, encoding: 'utf8', shell: cmd === 'npx', ...opts }) ?? '').trim();
const fail = (msg) => {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
};

// ---- Arguments ----
const args = process.argv.slice(2);
// Everything after --notes is the text (npm on Windows may drop the quotes and split it).
const notesIndex = args.indexOf('--notes');
let notes = notesIndex >= 0 ? args.splice(notesIndex).slice(1).join(' ') : '';
const bump = args[0] ?? 'patch';

// ---- Checks ----
if (run('git', ['status', '--porcelain'])) fail('Arbeidsmappa har ucommittede endringer. Commit dem først.');
if (!existsSync(keyPath)) fail(`Fant ikke signeringsnøkkelen ${keyPath}.`);
try {
  run('gh', ['auth', 'status']);
} catch {
  fail('gh er ikke logget inn (kjør: gh auth login).');
}

// ---- Version ----
const pkgPath = path.join(root, 'package.json');
const confPath = path.join(root, 'src-tauri', 'tauri.conf.json');
const cargoPath = path.join(root, 'src-tauri', 'Cargo.toml');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const [major, minor, patch] = pkg.version.split('.').map(Number);
const version =
  bump === 'major' ? `${major + 1}.0.0`
  : bump === 'minor' ? `${major}.${minor + 1}.0`
  : bump === 'patch' ? `${major}.${minor}.${patch + 1}`
  : /^\d+\.\d+\.\d+$/.test(bump) ? bump
  : fail(`Ukjent versjon «${bump}» (bruk patch, minor, major eller x.y.z).`);
const tag = `v${version}`;

if (!notes) {
  // Commit subjects since the previous release.
  let range = 'HEAD';
  try {
    range = `${run('git', ['describe', '--tags', '--abbrev=0'])}..HEAD`;
  } catch {
    // No earlier tag: use recent history.
  }
  notes = run('git', ['log', range, '--pretty=format:- %s', '-n', '15']) || 'Forbedringer og feilrettinger.';
}

console.log(`→ Lager versjon ${version} (var ${pkg.version})`);
const originals = [pkgPath, confPath, cargoPath].map((p) => [p, readFileSync(p, 'utf8')]);
const restore = () => originals.forEach(([p, text]) => writeFileSync(p, text));

pkg.version = version;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
const conf = JSON.parse(readFileSync(confPath, 'utf8'));
conf.version = version;
writeFileSync(confPath, JSON.stringify(conf, null, 2) + '\n');
writeFileSync(cargoPath, readFileSync(cargoPath, 'utf8').replace(/^version = ".*"$/m, `version = "${version}"`));

// ---- Test + build ----
try {
  console.log('→ Typesjekk og tester');
  run('npx', ['tsc', '--noEmit'], { stdio: 'inherit' });
  run('npx', ['vitest', 'run'], { stdio: 'inherit' });

  console.log('→ Bygger og signerer (lav prioritet, 2 kjerner – tar noen minutter)');
  const cargoBin = path.join(homedir(), '.cargo', 'bin');
  const env = {
    ...process.env,
    PATH: `${process.env.PATH}${path.delimiter}${cargoBin}`,
    TAURI_SIGNING_PRIVATE_KEY: keyPath,
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: '',
    CARGO_BUILD_JOBS: '2',
  };
  const build = spawnSync('cmd', ['/c', 'start', '/low', '/b', '/wait', 'npx', 'tauri', 'build', '--bundles', 'nsis'], {
    cwd: root,
    env,
    stdio: 'inherit',
  });
  if (build.status !== 0) throw new Error('Bygget feilet.');
} catch (err) {
  restore();
  fail(`${err.message ?? err}\nVersjonsnummeret er satt tilbake.`);
}

// ---- Update manifest ----
const bundleDir = path.join(root, 'src-tauri', 'target', 'release', 'bundle', 'nsis');
const installer = path.join(bundleDir, `Editor_${version}_x64-setup.exe`);
const signature = `${installer}.sig`;
if (!existsSync(installer) || !existsSync(signature)) {
  restore();
  fail(`Fant ikke ${installer} og .sig.`);
}
const manifestPath = path.join(bundleDir, 'latest.json');
writeFileSync(
  manifestPath,
  JSON.stringify(
    {
      version,
      notes,
      pub_date: new Date().toISOString(),
      platforms: {
        'windows-x86_64': {
          signature: readFileSync(signature, 'utf8').trim(),
          url: `https://github.com/${REPO}/releases/download/${tag}/${path.basename(installer)}`,
        },
      },
    },
    null,
    2,
  ),
);

// ---- Publish ----
console.log('→ Commit, tag og push');
run('git', ['add', 'package.json', 'src-tauri/tauri.conf.json', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock']);
run('git', ['commit', '-m', `Versjon ${version}`]);
run('git', ['tag', tag]);
run('git', ['push', 'origin', 'HEAD']);
run('git', ['push', 'origin', tag]);

console.log('→ Lager GitHub-release');
const notesFile = path.join(bundleDir, 'release-notes.md');
writeFileSync(notesFile, notes);
run('gh', ['release', 'create', tag, installer, manifestPath, '--repo', REPO, '--title', `Editor ${version}`, '--notes-file', notesFile]);

console.log(`\n✓ Versjon ${version} er publisert. Installerte apper får tilbud om oppdatering ved neste oppstart.`);
console.log(`  https://github.com/${REPO}/releases/tag/${tag}`);
