import {expect, it} from 'vitest';
const {resolveBrowserPath} = await import(new URL('../scripts/install/browser-path.mjs', import.meta.url).href);

it('returns null for stale browser overrides so automatic download can run', () => {
  expect(resolveBrowserPath({root: 'C:\\Framecraft', platform: 'win32', env: {CHROME_PATH: '/usr/bin/chromium'}, configured: 'node_modules/.remotion/deleted/chrome.exe', isFile: () => false})).toBeNull();
});
it('uses a valid saved browser after an invalid inherited override, including paths with spaces', () => {
  const browser = 'C:\\My Projects\\Framecraft\\.runtime\\browser\\chrome.exe';
  expect(resolveBrowserPath({root: 'C:\\My Projects\\Framecraft', platform: 'win32', env: {CHROME_PATH: 'C:\\deleted\\chrome.exe'}, configured: '.runtime/browser/chrome.exe', isFile: (file: string) => file === browser})).toBe(browser);
  expect(resolveBrowserPath({root: 'C:\\Framecraft', platform: 'win32', env: {CHROME_PATH: `"${browser}"`}, isFile: (file: string) => file === browser})).toBe(browser);
});
it('discovers Windows Edge without requiring a separate Chromium installation', () => {
  const browser = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  expect(resolveBrowserPath({root: 'C:\\Framecraft', platform: 'win32', env: {'ProgramFiles(x86)': 'C:\\Program Files (x86)'}, isFile: (file: string) => file === browser})).toBe(browser);
});
it('reuses the download cache outside node_modules after npm ci', () => {
  const browser = '/project/.runtime/browser/node_modules/.remotion/chrome-headless-shell/linux64/chrome-headless-shell';
  expect(resolveBrowserPath({root: '/project', platform: 'linux', env: {}, configured: '/project/node_modules/.remotion/deleted', cached: browser, isFile: (file: string) => file === browser})).toBe(browser);
});
