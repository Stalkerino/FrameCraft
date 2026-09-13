import type {Mask} from './visual-editing';

/** The SVG viewBox is the project canvas, including for HTML text boxes. */
export function maskGeometry(mask: Mask, canvas: {width: number; height: number}) {
  const x = mask.x * canvas.width / 100; const y = mask.y * canvas.height / 100;
  const width = mask.width * canvas.width / 100; const height = mask.height * canvas.height / 100;
  const points = mask.points.map(point => ({x: point.x * canvas.width / 100, y: point.y * canvas.height / 100}));
  const bounds = mask.shape === 'polygon' ? points.reduce((b, p) => ({left: Math.min(b.left, p.x), top: Math.min(b.top, p.y), right: Math.max(b.right, p.x), bottom: Math.max(b.bottom, p.y)}), {left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity})
    : {left: x - width / 2, top: y - height / 2, right: x + width / 2, bottom: y + height / 2};
  return {x, y, width, height, points, bounds, sigma: mask.feather / 2};
}

// Bounds per-fragment scanline sorting in the native Gaussian shader. This
// does not restrict editing/MCP or the compatible renderer.
export const nativeMaskVertexBudget = 128;
