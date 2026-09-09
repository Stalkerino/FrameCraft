import {chromium, defineConfig} from '@playwright/test';
import {existsSync} from 'node:fs';
import path from 'node:path';
const chromiumPath = process.env.CHROME_PATH || (process.platform === 'linux' && existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : existsSync(chromium.executablePath()) ? chromium.executablePath() : undefined);
const testDataDir = path.resolve(`.cache/e2e-${Date.now()}`);
export default defineConfig({
  testDir: './tests/e2e', fullyParallel: false, workers: 1, timeout: 180_000,
  use: {baseURL: 'http://127.0.0.1:4319', viewport: {width: 1440, height: 960}, launchOptions: {executablePath: chromiumPath}, screenshot: 'only-on-failure', trace: 'retain-on-failure'},
  webServer: {command: 'npm start', url: 'http://127.0.0.1:4319/api/project', reuseExistingServer: false, timeout: 30_000, env: {PORT: '4319', FRAMECRAFT_DATA_DIR: testDataDir, FRAMECRAFT_LIBRARY_DIR: path.join(testDataDir, 'asset-library'), FRAMECRAFT_CODEX_PATH: path.resolve('tests/fixtures/fake-codex.mjs'), ...(chromiumPath ? {CHROME_PATH: chromiumPath} : {})}},
});
