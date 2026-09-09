import {existsSync} from 'node:fs';

export const browserExecutable = () => process.env.CHROME_PATH || (process.platform === 'linux' && existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
