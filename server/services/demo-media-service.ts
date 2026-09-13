import {copyFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {demoArtwork, demoMediaNames} from '../../shared/demo';

/** Prebuilt PNGs work in both compositors; no SVG rasterization during export. */
export async function prepareDemoMedia(root: string, media: string) {
  for(const [index, name] of demoMediaNames.entries()) {
    await copyFile(path.join(root, 'public', 'demo', `demo-${name}.png`), path.join(media, `demo-${name}.png`));
    // Keep legacy URLs valid for older saved references and external clients.
    await writeFile(path.join(media, `demo-${name}.svg`), demoArtwork(index));
  }
}
