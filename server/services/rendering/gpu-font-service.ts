import path from 'node:path';
import {access, stat} from 'node:fs/promises';
import {open, type Font, type PathCommand} from 'fontkit';
import {runProcess} from '../process-service';
import type {GpuTextOutline} from '../../../shared/gpu-artwork';

type Point = [number, number];
type Edge = [number, number, number, number];
export interface GlyphShape {edges: Edge[]; bounds: Edge; start?: number; end?: number}
export interface FontLayout {shapes: GlyphShape[]; width: number; height: number}

/** Font parsing/shaping produces geometry only. The GPU rasterizes it.
 * Font selection follows the preview's Arial/Helvetica/sans-serif stack.
 * Cache lifetime is one export; no growing global glyph/image cache.
 */
export class GpuFontService {
  private fonts = new Map<string, Promise<Font>>();
  private layouts = new Map<string, FontLayout>();
  private totalBytes = 0;
  accountGeometry(edges: number) {
    this.totalBytes += edges * 16 + 64;
    if(this.totalBytes > 16 * 1024 ** 2) throw new Error('GPU text geometry exceeds the 16 MiB per-export preparation budget. Split this export range. No GPU was opened.');
  }
  async font(weight: string): Promise<Font> {
    const key = Number(weight) >= 600 ? 'bold' : 'regular';
    let found = this.fonts.get(key);
    if(!found) {found = this.load(key); this.fonts.set(key, found);}
    return found;
  }
  private async load(weight: string): Promise<Font> {
    const candidates = process.platform === 'win32'
      ? [path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts', weight === 'bold' ? 'arialbd.ttf' : 'arial.ttf')]
      : [];
    if(process.platform !== 'win32') {
      try {candidates.push((await runProcess('fc-match', ['-f', '%{file}', `Arial:style=${weight === 'bold' ? 'Bold' : 'Regular'}`], 5000)).trim());} catch { /* Known Linux locations below. */ }
      for(const root of ['/usr/share/fonts/truetype/liberation2', '/usr/share/fonts/truetype/liberation', '/usr/share/fonts/liberation']) candidates.push(path.join(root, `LiberationSans-${weight === 'bold' ? 'Bold' : 'Regular'}.ttf`));
    }
    for(const file of candidates.filter(Boolean)) {
      try {await access(file);} catch {continue;}
      if((await stat(file)).size > 64 * 1024 ** 2) throw new Error('The selected font exceeds the 64 MiB font file budget.');
      const loaded = await open(file); return 'fonts' in loaded ? loaded.fonts[0] : loaded;
    }
    throw new Error('Native GPU text needs Arial or Liberation Sans. Install a matching font (fonts-liberation on Linux) before exporting. No browser/text-image fallback was used.');
  }
  async outline(text: string, weight: string, align: 'left'|'center'|'right', name: string, htmlSize?: number): Promise<GpuTextOutline> {
    const layout = await this.layout(text, weight, align, htmlSize);
    return {...encodeOutline(layout.shapes, name), width: layout.width, height: layout.height};
  }
  async layout(text: string, weight: string, align: 'left'|'center'|'right', htmlSize?: number): Promise<FontLayout> {
    const key = JSON.stringify([text, weight, align, htmlSize]);
    let layout = this.layouts.get(key);
    if(!layout) {
      const font = await this.font(weight);
      const missing = [...text].find(char => !/\s/u.test(char) && !font.hasGlyphForCodePoint(char.codePointAt(0)!));
      if(missing) throw new Error(`Native font ${font.familyName} has no glyph for ${JSON.stringify(missing)}. Choose supported text or the compatible renderer; missing glyphs are never silently replaced.`);
      const shapes: GlyphShape[] = []; let maxWidth = 0;
      const lines = text.split('\n');
      const spacing = htmlSize === undefined ? 0 : htmlSize > 60 ? -.045 : .14;
      for(const [lineIndex, line] of lines.entries()) {
        const run = font.layout(line);
        const width = run.positions.reduce((sum, pos) => sum + pos.xAdvance, 0) / font.unitsPerEm + spacing * run.glyphs.length;
        maxWidth = Math.max(maxWidth, width);
        let x = align === 'center' ? -width / 2 : align === 'right' ? -width : 0;
        const y = htmlSize === undefined ? (lineIndex - (lines.length - 1) / 2) * 1.15 + .35
          : lineIndex * 1.02 + (1.02 - (font.ascent - font.descent) / font.unitsPerEm) / 2 + font.ascent / font.unitsPerEm;
        for(const [index, glyph] of run.glyphs.entries()) {
          const pos = run.positions[index];
          const edges = flattenOutline(glyph.path.commands, font.unitsPerEm, x + pos.xOffset / font.unitsPerEm, y - pos.yOffset / font.unitsPerEm);
          if(edges.length) {
            const bounds: Edge = [Infinity, Infinity, -Infinity, -Infinity];
            for(const [x0, y0, x1, y1] of edges) {bounds[0] = Math.min(bounds[0], x0, x1); bounds[1] = Math.min(bounds[1], y0, y1); bounds[2] = Math.max(bounds[2], x0, x1); bounds[3] = Math.max(bounds[3], y0, y1);}
            shapes.push({edges, bounds});
            this.accountGeometry(edges.length);
          }
          x += pos.xAdvance / font.unitsPerEm + spacing;
        }
      }
      // CSS white-space:pre does not create an extra line box for the final
      // newline. This matters when a typewriter reveals that newline alone.
      const lineCount = lines.length - (htmlSize !== undefined && text.endsWith('\n') ? 1 : 0);
      layout = {shapes, width: maxWidth, height: text ? lineCount * (htmlSize === undefined ? 1.15 : 1.02) : 0};
      this.layouts.set(key, layout);
    }
    return layout;
  }
}

/** Adaptive subdivision is geometry preparation, not pixel rasterization.
 * Tolerance is 1/8192 em; loops and memory are bounded for malformed fonts.
 */
export function flattenOutline(commands: PathCommand[], units: number, offsetX = 0, offsetY = 0): Edge[] {
  const edges: Edge[] = []; let current: Point = [0, 0]; let start: Point = [0, 0];
  const point = (x: number, y: number): Point => [x / units + offsetX, -y / units + offsetY];
  const line = (a: Point, b: Point) => {if(a[0] !== b[0] || a[1] !== b[1]) edges.push([...a, ...b]); if(edges.length > 16384) throw new Error('Font glyph outline exceeds the geometry budget.');};
  const midpoint = (a: Point, b: Point): Point => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const curve = (points: Point[], depth = 0) => {
    const a = points[0]; const b = points.at(-1)!;
    const distance = (p: Point) => Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / Math.max(.0000001, Math.hypot(b[0] - a[0], b[1] - a[1]));
    const flat = points.slice(1, -1).every(p => distance(p) < 1 / 8192);
    if(flat || depth >= 16) {line(a, b); return;}
    const left = [a]; const right = [b]; let row = points;
    while(row.length > 1) {row = row.slice(1).map((p, i) => midpoint(row[i], p)); left.push(row[0]); right.unshift(row.at(-1)!);}
    curve(left, depth + 1); curve(right, depth + 1);
  };
  for(const command of commands) {
    const p = command.args;
    if(command.command === 'moveTo') {current = point(p[0], p[1]); start = current;}
    else if(command.command === 'closePath') {line(current, start); current = start;}
    else if(command.command === 'lineTo') {const next = point(p[0], p[1]); line(current, next); current = next;}
    else {const points = [current]; for(let i = 0; i < p.length; i += 2) points.push(point(p[i], p[i + 1])); curve(points); current = points.at(-1)!;}
  }
  return edges;
}

function encodeOutline(shapes: GlyphShape[], name: string): GpuTextOutline {
  return encodeTextLayouts([{shapes, width: 0, height: 0}], name);
}

/** One geometry buffer and shader for all typewriter states. Each state has
 * its own BVH root; a pixel visits only the selected text, never every prefix.
 * Caption leaves also carry source-frame highlight intervals.
 */
export function encodeTextLayouts(layouts: FontLayout[], name: string): GpuTextOutline {
  const nodes: {bounds: Edge; skip: number; start: number; count: number; timing: [number, number]}[] = [];
  const edges: Edge[] = []; const edgeOffsets = new Map<string, number>();
  const tree = (items: GlyphShape[]) => {
    const bounds: Edge = [Math.min(...items.map(i => i.bounds[0])), Math.min(...items.map(i => i.bounds[1])), Math.max(...items.map(i => i.bounds[2])), Math.max(...items.map(i => i.bounds[3]))];
    const node = {bounds, skip: 0, start: 0, count: 0, timing: [-1, -1] as [number, number]}; nodes.push(node);
    if(items.length === 1) {
      const item = items[0]; const key = JSON.stringify(item.edges);
      let start = edgeOffsets.get(key);
      if(start === undefined) {start = edges.length; for(const edge of item.edges) edges.push(edge); edgeOffsets.set(key, start);}
      node.start = start; node.count = item.edges.length; node.timing = [item.start ?? -1, item.end ?? -1];
    } else {
      const axis = bounds[2] - bounds[0] > bounds[3] - bounds[1] ? 0 : 1;
      items = [...items].sort((a, b) => a.bounds[axis] + a.bounds[axis + 2] - b.bounds[axis] - b.bounds[axis + 2]);
      const half = Math.floor(items.length / 2); tree(items.slice(0, half)); tree(items.slice(half));
    }
    node.skip = nodes.length;
  };
  const roots = layouts.map(layout => {const start = nodes.length; if(layout.shapes.length) tree(layout.shapes); return [start, nodes.length, layout.width, layout.height];});
  const edgeBase = roots.length + nodes.length * 3;
  const words: number[] = roots.flat();
  for(const node of nodes) words.push(...node.bounds, node.start + edgeBase, node.count, node.skip, 0, ...node.timing, 0, 0);
  for(const edge of edges) words.push(...edge);
  const width = Math.min(1024, Math.max(1, words.length / 4)); const height = Math.max(2, Math.ceil(words.length / 4 / width));
  if(width * height * 16 > 16 * 1024 ** 2) throw new Error('GPU text states exceed the 16 MiB geometry budget. Shorten the export range or text. No GPU was opened.');
  const data = Buffer.alloc(width * height * 16); words.forEach((value, index) => {if(!Number.isFinite(value)) throw new Error('Invalid font outline.'); data.writeFloatLE(value, index * 4);});
  const binding = `${name}_geometry`;
  const fetch = (index: string) => `texelFetch(${binding},ivec2((${index})%${width},(${index})/${width}),0)`;
  return {binding, bytes: data.length, texture: `//!TEXTURE ${binding}\n//!SIZE ${width} ${height}\n//!FORMAT rgba32f\n//!FILTER NEAREST\n${data.toString('hex')}\n`,
    function: `vec2 ${name}_box(int state){return ${fetch('state')}.zw;}
    vec2 ${name}_sample(vec2 p,float padding,int state,float time){
      vec4 root=${fetch('state')}; vec2 result=vec2(1e10);int node=int(root.x);
      while(node<int(root.y)){
        int offset=${roots.length}+node*3;vec4 b=${fetch('offset')};vec4 info=${fetch('offset+1')};
        if(any(lessThan(p,b.xy-vec2(padding)))||any(greaterThan(p,b.zw+vec2(padding)))){node=int(info.z);continue;}
        if(info.y>0.0){float d=1e10;int winding=0;
          for(int i=0;i<int(info.y);i++){int at=int(info.x)+i;vec4 e=${fetch('at')};vec2 v=e.zw-e.xy;vec2 q=p-e.xy;
            d=min(d,length(q-v*clamp(dot(q,v)/max(dot(v,v),1e-20),0.0,1.0)));float cross=v.x*q.y-v.y*q.x;
            if(e.y<=p.y&&e.w>p.y&&cross>0.0)winding++;if(e.y>p.y&&e.w<=p.y&&cross<0.0)winding--;
          }
          d=winding==0?d:-d;result.x=min(result.x,d);vec2 timing=${fetch('offset+2')}.xy;
          if(time>=timing.x&&time<timing.y)result.y=min(result.y,d);
        }node++;
      }return result;
    }
    float ${name}(vec2 p,float padding){return ${name}_sample(p,padding,0,-2.0).x;}`};
}
