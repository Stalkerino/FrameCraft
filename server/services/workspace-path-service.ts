import {realpath} from 'node:fs/promises';
import path from 'node:path';

/** Resolve aliases/Windows short names even when the final directory or file
 * does not exist yet. Protected roots must use the same spelling as targets. */
export async function canonicalWorkspacePath(file: string): Promise<string> {
  const target = path.resolve(file);
  let ancestor = target;
  while(true) {
    try {return path.resolve(await realpath(ancestor), path.relative(ancestor, target));}
    catch(error) {
      if((error as NodeJS.ErrnoException).code !== 'ENOENT' || path.dirname(ancestor) === ancestor) throw error;
      ancestor = path.dirname(ancestor);
    }
  }
}
