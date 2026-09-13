import type {CSSProperties} from 'react';
import type {Clip, Project} from '../../../shared/project';
import {maskGeometry} from '../../../shared/mask-geometry';

/** SVG alpha masks clip media, HTML titles and artwork identically in both renderers. */
export function visualGeometryStyle(clip: Clip, project: Pick<Project, 'width' | 'height'>): CSSProperties {
  const style: CSSProperties = {};
  if(clip.crop) {const {top, right, bottom, left} = clip.crop; style.clipPath = `inset(${top}% ${right}% ${bottom}% ${left}%)`;}
  if(!clip.mask) return style;
  const mask = clip.mask; const {width, height} = project;
  const {x, y, width: w, height: h, sigma} = maskGeometry(mask, project);
  const shape = mask.shape === 'ellipse' ? `<ellipse cx="${x}" cy="${y}" rx="${w / 2}" ry="${h / 2}"/>`
    : mask.shape === 'polygon' ? `<polygon points="${mask.points.map(point => `${point.x * width / 100},${point.y * height / 100}`).join(' ')}"/>`
    : `<rect x="${x - w / 2}" y="${y - h / 2}" width="${w}" height="${h}"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none"><defs><filter id="blur" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="${sigma}"/></filter><mask id="shape" maskUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="${mask.inverted ? 'white' : 'black'}"/><g fill="${mask.inverted ? 'black' : 'white'}"${mask.feather ? ' filter="url(#blur)"' : ''}>${shape}</g></mask></defs><rect width="${width}" height="${height}" fill="white" mask="url(#shape)"/></svg>`;
  const image = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  return {...style, maskImage: image, WebkitMaskImage: image, maskSize: '100% 100%', WebkitMaskSize: '100% 100%', maskRepeat: 'no-repeat', WebkitMaskRepeat: 'no-repeat'};
}
