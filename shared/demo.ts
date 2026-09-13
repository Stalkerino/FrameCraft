import {clipSchema, type Project} from './project';

export const demoMediaNames = ['world', 'build', 'detail'] as const;

/** Upgrade only bundled artwork references, including saved undo/redo states. */
export function normalizeDemoMedia(project: Project): Project {
  return {...project, assets: project.assets.map(asset => {
    if(!asset.demo || !demoMediaNames.some(name => asset.src === `/media/demo-${name}.svg`)) return asset;
    const src = asset.src.replace(/\.svg$/, '.png');
    return {...asset, src, name: asset.name.replace(/\.svg$/i, '.png'), thumbnail: asset.thumbnail === asset.src ? src : asset.thumbnail};
  })};
}

export function createDemo(): Project {
  return {
    version: 1, id: 'local-project', name: 'A world in the making', revision: 0, width: 1920, height: 1080, fps: 30,
    assets: [
      {id: 'demo-world', name: '01 — The new world.png', kind: 'image', src: '/media/demo-world.png', thumbnail: '/media/demo-world.png', duration: 6, width: 1920, height: 1080, demo: true},
      {id: 'demo-build', name: '02 — Building the atmosphere.png', kind: 'image', src: '/media/demo-build.png', thumbnail: '/media/demo-build.png', duration: 6, width: 1920, height: 1080, demo: true},
      {id: 'demo-detail', name: '03 — A closer look.png', kind: 'image', src: '/media/demo-detail.png', thumbnail: '/media/demo-detail.png', duration: 6, width: 1920, height: 1080, demo: true},
    ],
    clips: [
      clipSchema.parse({id: 'scene-1', name: 'The new world', kind: 'image', assetId: 'demo-world', track: 'visual', start: 0, duration: 180}),
      clipSchema.parse({id: 'scene-2', name: 'Building the atmosphere', kind: 'image', assetId: 'demo-build', track: 'visual', start: 180, duration: 180, transition: 'diagonal', transitionFrames: 24}),
      clipSchema.parse({id: 'scene-3', name: 'A closer look', kind: 'image', assetId: 'demo-detail', track: 'visual', start: 360, duration: 180, transition: 'pixel', transitionFrames: 24}),
      clipSchema.parse({id: 'title-1', name: 'Opening title', kind: 'text', track: 'text', start: 12, duration: 145, text: 'A WORLD\nIN THE MAKING.', x: 9, y: 56, align: 'left', fontSize: 112}),
      clipSchema.parse({id: 'title-2', name: 'Devlog label', kind: 'text', track: 'text', start: 0, duration: 168, text: 'DEVLOG 001   /   THE BEGINNING', x: 9.3, y: 46, align: 'left', fontSize: 24, color: '#c5f277', weight: '600'}),
      clipSchema.parse({id: 'title-3', name: 'Chapter two', kind: 'text', track: 'text', start: 195, duration: 140, text: 'Small details.\nA different feeling.', x: 9, y: 64, align: 'left', fontSize: 92}),
    ],
  };
}

/** Repo-native demo artwork, generated locally; no remote assets or fonts. */
export function demoArtwork(variant: number) {
  const palettes = [['#162831', '#678e91', '#c5f277'], ['#302c39', '#a78892', '#eac7aa'], ['#152d31', '#769d8c', '#d5e4a3']];
  const [dark, mid, light] = palettes[variant];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
  <defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="${dark}"/><stop offset="1" stop-color="${mid}"/></linearGradient><linearGradient id="ground" x2="0" y2="1"><stop stop-color="${dark}"/><stop offset="1" stop-color="#091418"/></linearGradient><radialGradient id="glow"><stop stop-color="${light}" stop-opacity=".28"/><stop offset="1" stop-color="${light}" stop-opacity="0"/></radialGradient><linearGradient id="shade"><stop stop-color="#071013" stop-opacity=".68"/><stop offset=".7" stop-color="#071013" stop-opacity="0"/></linearGradient><filter id="mist"><feGaussianBlur stdDeviation="20"/></filter><pattern id="lines" width="6" height="6" patternUnits="userSpaceOnUse"><path d="M0 0h6" stroke="#fff" stroke-opacity=".025"/></pattern></defs>
  <path fill="url(#sky)" d="M0 0h1920v1080H0z"/><ellipse cx="1350" cy="370" rx="650" ry="480" fill="url(#glow)"/>
  <circle cx="${1400 - variant * 160}" cy="${260 + variant * 45}" r="${92 + variant * 30}" fill="${light}" opacity=".5"/>
  <path d="M0 650L200 430 330 510 510 270 660 410 780 310 1060 560 1250 340 1440 590 1720 370 1920 500V1080H0Z" fill="${mid}" opacity=".7"/>
  <path d="M0 780L240 550 390 650 560 490 850 760 1110 490 1320 620 1490 520 1730 730 1920 580V1080H0Z" fill="${dark}" opacity=".75"/>
  <path d="M0 820Q500 670 1020 810T1920 730V1080H0Z" fill="url(#ground)"/>
  <path d="M850 1080L1320 750 1450 730 1160 1080Z" fill="${mid}" opacity=".16"/>
  <g transform="translate(${1250 - variant * 100} ${380 + variant * 35})">
  <path d="M0 50L170 0 170 440 0 490Z" fill="#14272b"/><path d="M170 0L320 75V495L170 440Z" fill="#0b1c20"/><path d="M0 50L170 0 320 75 155 135Z" fill="${mid}"/>
  <path d="M30 95L140 62V385L30 420Z" fill="#07171c"/><path d="M54 115L113 97V350L54 370Z" fill="${light}" opacity=".8"/>
  <path d="M198 84L277 123V414L198 379Z" fill="#061418"/><path d="M215 115L240 126V357L215 346Z" fill="${light}" opacity=".27"/>
  <path d="M-40 490L155 425 365 500 160 575Z" fill="#10282b"/><path d="M-40 490V522L160 610V575Z" fill="#08191c"/><path d="M160 575L365 500V536L160 610Z" fill="#0a2022"/>
  </g>
  <g fill="#0a1c20">${Array.from({length: 26}, (_, i) => {const x = (i * 179 + variant * 70) % 1920; const y = 760 + (i * 61) % 210; const h = 40 + (i * 37) % 150; return `<path d="M${x} ${y}l${h / 3} -${h} ${h / 3} ${h}Z"/>`;}).join('')}</g>
  <path d="M0 815Q650 720 1100 820T1920 760" stroke="${mid}" stroke-width="70" opacity=".15" fill="none" filter="url(#mist)"/>
  <path fill="url(#shade)" d="M0 0h1920v1080H0z"/><path fill="url(#lines)" d="M0 0h1920v1080H0z"/>
  <g fill="${light}" opacity=".55">${Array.from({length: 28}, (_, i) => `<circle cx="${(i * 271) % 1920}" cy="${300 + (i * 117) % 600}" r="${i % 3 + 1}"/>`).join('')}</g>
  </svg>`;
}
