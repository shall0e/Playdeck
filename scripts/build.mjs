import { buildSync } from 'esbuild';
import { cpSync, mkdirSync, rmSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
// Stored ZIPs need no dependencies and can be extracted by standard archive tools.
function files(root, prefix = '') {
  return readdirSync(join(root, prefix), { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const path = prefix ? prefix + '/' + entry.name : entry.name;
      return entry.isDirectory()
        ? files(root, path)
        : [{ name: path, data: readFileSync(join(root, path)) }];
    });
}
function zip(entries) {
  const parts = [],
    directory = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const filename = Buffer.from(name);
    let crc = 0xffffffff;
    for (const byte of data) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6);
    header.writeUInt16LE(33, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(filename.length, 26);
    parts.push(header, filename, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50);
    central.writeUInt16LE(20, 4);
    header.copy(central, 6, 4, 28);
    central.writeUInt32LE(offset, 42);
    directory.push(central, filename);
    offset += header.length + filename.length + data.length;
  }
  const table = Buffer.concat(directory),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(table.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, table, end]);
}
rmSync('dist', { recursive: true, force: true });
cpSync('website', 'dist', { recursive: true });
buildSync({
  entryPoints: ['website/player/toolbar-icons.js'],
  outfile: 'dist/player/toolbar-icons.js',
  bundle: true,
  format: 'esm',
  minify: true,
  target: 'es2020',
});
const revision = process.env.GITHUB_SHA || 'local';
writeFileSync('dist/player/build.json', JSON.stringify({ revision }));
const html = readFileSync('dist/player/index.html', 'utf8').replace(
  '<head>',
  '<head><meta name="playdeck-build" content="' + revision + '">',
);
writeFileSync('dist/player/index.html', html);
const source = ['website', 'tests', 'scripts', '.github'].flatMap((root) =>
  files(root).map((file) => ({ ...file, name: root + '/' + file.name })),
);
for (const name of ['README.md', 'LICENSE', 'package.json', 'wrangler.jsonc', '.gitignore'])
  source.push({ name, data: readFileSync(name) });
const deployment = files('dist');
deployment.push(
  { name: 'README.md', data: readFileSync('README.md') },
  { name: 'LICENSE', data: readFileSync('LICENSE') },
);
mkdirSync('dist/downloads', { recursive: true });
writeFileSync('dist/downloads/playdeck-source.zip', zip(source));
writeFileSync('dist/downloads/playdeck-deploy.zip', zip(deployment));
console.log('Built standalone Playdeck and downloadable source/deployment bundles.');
