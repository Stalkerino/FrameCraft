import path from 'node:path';

export function packageConfig({version, app, libraries, names, icons, root, platform = process.platform}) {
  if(!['linux', 'win32'].includes(platform)) throw new Error('Unsupported release platform.');
  const paths = platform === 'win32' ? path.win32 : path.posix;
  // linuxdeploy scans usr/lib recursively and rewrites every ELF it finds.
  // The Node payload includes static executables and private library namespaces;
  // retain these unmodified in usr/share, alongside other application resources.
  const resources = platform === 'win32' ? {[app + paths.sep]: 'app/'} : {};
  const linuxFiles = platform === 'linux' ? {'/usr/share/framecraft/app': app} : {};
  for(const name of names) {
    if(platform === 'win32') resources[paths.join(libraries, name)] = name;
    else linuxFiles[`/usr/lib/framecraft/${name}`] = paths.join(libraries, name);
  }
  return {version, bundle: {active: true, useLocalToolsDir: true, category: 'Video',
    shortDescription: 'Video editing with local AI tools and native GPU rendering',
    license: 'GPL-3.0-or-later', licenseFile: paths.join(root, 'LICENSE'),
    icon: ['32x32.png', '128x128.png', '128x128@2x.png', 'icon.ico'].map(name => paths.join(icons, name)), resources,
    windows: {webviewInstallMode: {type: 'offlineInstaller', silent: true}, nsis: {installMode: 'currentUser', compression: 'zlib'}},
    linux: {deb: {files: linuxFiles, depends: ['libgtk-3-0', 'libwebkit2gtk-4.1-0', 'libvulkan1', 'libasound2', 'libatomic1', 'gstreamer1.0-libav']},
      appimage: {files: linuxFiles, bundleMediaFramework: true}}}};
}
