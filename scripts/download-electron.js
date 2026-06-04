const { downloadArtifact } = require('@electron/get');
const extract = require('extract-zip');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const version = require(path.join(root, 'node_modules/electron/package.json')).version;
const distDir = path.join(root, 'node_modules', 'electron', 'dist');

async function main() {
  fs.mkdirSync(distDir, { recursive: true });
  console.log('Downloading Electron', version, '...');
  const zipPath = await downloadArtifact({
    version,
    artifactName: 'electron',
    platform: 'win32',
    arch: 'x64',
    mirrorOptions: {
      mirror: 'https://npmmirror.com/mirrors/electron/',
    },
  });
  console.log('Extracting to', distDir);
  await extract(zipPath, { dir: distDir });
  await fs.promises.writeFile(
    path.join(root, 'node_modules', 'electron', 'path.txt'),
    'electron.exe'
  );
  console.log('Done:', fs.existsSync(path.join(distDir, 'electron.exe')));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
