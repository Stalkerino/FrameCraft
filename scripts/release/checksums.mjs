import {createReadStream} from 'node:fs';
import {readdir, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
const directory = path.resolve(process.argv[2] || '.runtime/release/artifacts');
const lines = [];
for(const name of (await readdir(directory)).sort()) {
  if(!/(?:-setup\.exe|\.AppImage|\.deb)$/.test(name)) continue;
  const hash = createHash('sha256');
  for await(const chunk of createReadStream(path.join(directory, name))) hash.update(chunk);
  lines.push(`${hash.digest('hex')}  ${name}`);
}
if(lines.length !== 3) throw new Error('Publish requires a Windows installer and both Linux packages.');
await writeFile(path.join(directory, 'SHA256SUMS.txt'), lines.join('\n') + '\n');
