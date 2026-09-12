import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const child = spawn(process.execPath, [require.resolve('@playwright/test/cli'), 'test', 'tests/e2e/gpu-export.spec.ts', ...process.argv.slice(2)], {
  stdio: 'inherit', windowsHide: true, env: {...process.env, FRAMECRAFT_TEST_GPU: 'nvidia'},
});
child.on('error', error => {console.error(error.message); process.exitCode = 1;});
child.on('exit', code => {process.exitCode = code ?? 1;});
