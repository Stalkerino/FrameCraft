import {describe, expect, it} from 'vitest';

const build = await import(new URL('../scripts/build/desktop-environment.mjs', import.meta.url).href);

describe('shared desktop build plan (no compilation or GPU initialization)', () => {
  it('locates platform executables under the explicitly selected Cargo target', () => {
    expect(build.desktopBinary('/project/target', 'x86_64-unknown-linux-gnu', false, 'linux')).toBe('/project/target/x86_64-unknown-linux-gnu/release/framecraft-desktop');
    expect(build.desktopBinary('C:\\Project Folder\\target', 'x86_64-pc-windows-msvc', true, 'win32')).toBe('C:\\Project Folder\\target\\x86_64-pc-windows-msvc\\debug\\framecraft-desktop.exe');
  });
  it('passes the lockfile requirement to Cargo without requesting installers or running the app', () => {
    expect(build.nativeBuildArgs('x86_64-pc-windows-msvc', true)).toEqual(['build', '--no-bundle', '--target', 'x86_64-pc-windows-msvc', '--debug', '--', '--locked']);
    expect(build.nativeBuildArgs('x86_64-unknown-linux-gnu')).not.toContain('--debug');
  });
});
