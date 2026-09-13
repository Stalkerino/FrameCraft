import {sceneLayers} from '../../../shared/native-sequence-plan';
import type {Clip} from '../../../shared/project';
import type {NativeScenePlan} from '../../../shared/native-scene-plan';
import {typewriterCharacters, visibleCaptionWords} from '../../../shared/text-timing';
import {gpuTitleProgram, type CaptionBox} from '../../../shared/gpu-text';
import {GpuFontService, encodeTextLayouts, flattenOutline, type FontLayout, type GlyphShape} from './gpu-font-service';

/** Only prepare prefixes visible in this export. Split/ranged clips retain
 * their original motion clock. Prefixes are shaped independently so ligatures
 * and changing line alignment match the browser's substring semantics.
 */
export function titleStates(plan: NativeScenePlan, clip: Clip, fps: number): number[] {
  if(clip.animation !== 'typewriter' || clip.caption) return [clip.text.length];
  const counts = new Set<number>();
  for(const span of plan.spans) for(const layer of sceneLayers(span)) if(layer.clipId === clip.id) {
    const start = layer.animation!.localFrame + (clip.motionOffset ?? 0);
    const end = start + (layer.animation!.held ? 0 : span.duration - 1);
    // Once fully revealed, arbitrarily long clips add only one state.
    const last = Math.min(end, Math.ceil(clip.text.length * fps / 45));
    for(let frame = start; frame <= last; frame++) counts.add(typewriterCharacters(frame, fps, clip.text.length));
    counts.add(typewriterCharacters(end, fps, clip.text.length));
  }
  return [...counts].sort((a, b) => a - b);
}

export async function prepareGpuText(fonts: GpuFontService, plan: NativeScenePlan, clip: Clip, fps: number, width: number) {
  if(clip.caption) {
    const {layout, boxes} = await captionLayout(fonts, clip, width);
    return gpuTitleProgram(clip, fps, encodeTextLayouts([layout], 'fc_title_outline'), [clip.text.length], boxes);
  }
  const states = titleStates(plan, clip, fps); const layouts: FontLayout[] = [];
  for(const count of states) layouts.push(await fonts.layout(clip.text.slice(0, count), clip.weight, clip.align, clip.fontSize));
  return gpuTitleProgram(clip, fps, encodeTextLayouts(layouts, 'fc_title_outline'), states);
}

/** CSS normal whitespace, 88% paragraph width and 1.4 line height. Layout is
 * font geometry, not pixel work. Timed leaves let one GPU BVH traversal return
 * both ordinary and highlighted ink, even for overlapping word intervals.
 */
export async function captionLayout(fonts: GpuFontService, clip: Clip, projectWidth: number): Promise<{layout: FontLayout; boxes: CaptionBox[]}> {
  const font = await fonts.font(clip.weight); const units = font.unitsPerEm;
  const fs = clip.fontSize; const width = projectWidth * .88 / fs;
  const pad = clip.caption!.style === 'boxed' ? 24 / fs : 0;
  const space = font.layout(' ').positions.reduce((sum, pos) => sum + pos.xAdvance, 0) / units;
  type Token = {text: string; start: number; end: number; width: number};
  const lines: Token[][] = [[]]; const widths = [0];
  for(const word of visibleCaptionWords(clip)) for(const text of word.text.split(/[\t\n\r\f ]+/).filter(Boolean)) {
    const missing = [...text].find(char => !font.hasGlyphForCodePoint(char.codePointAt(0)!));
    if(missing) throw new Error(`Native font ${font.familyName} has no glyph for ${JSON.stringify(missing)}.`);
    const advance = font.layout(text).positions.reduce((sum, pos) => sum + pos.xAdvance, 0) / units;
    let line = lines.length - 1;
    if(lines[line].length && widths[line] + space + advance + pad * 2 > width) {lines.push([]); widths.push(0); line++;}
    widths[line] += (lines[line].length ? space : 0) + advance;
    lines[line].push({...word, text, width: advance});
  }
  const height = lines.some(line => line.length) || pad ? lines.length * 1.4 : 0;
  const shapes: GlyphShape[] = []; const boxes: CaptionBox[] = [];
  const fontHeight = (font.ascent - font.descent) / units;
  for(const [index, line] of lines.entries()) {
    const contentWidth = widths[index] + pad * 2;
    const left = clip.align === 'left' ? -width / 2 : clip.align === 'right' ? width / 2 - contentWidth : -contentWidth / 2;
    const top = -height / 2 + index * 1.4;
    if(pad) boxes.push({x: left * fs, y: (top + (1.4 - fontHeight) / 2) * fs - 12, width: contentWidth * fs, height: fontHeight * fs + 24});
    let x = left + pad;
    const baseline = top + (1.4 - fontHeight) / 2 + font.ascent / units;
    for(const [wordIndex, word] of line.entries()) {
      if(wordIndex) x += space;
      const run = font.layout(word.text);
      for(const [i, glyph] of run.glyphs.entries()) {
        const pos = run.positions[i];
        const edges = flattenOutline(glyph.path.commands, units, x + pos.xOffset / units, baseline - pos.yOffset / units);
        if(edges.length) {
          fonts.accountGeometry(edges.length);
          const bounds: GlyphShape['bounds'] = [Infinity, Infinity, -Infinity, -Infinity];
          for(const [x0, y0, x1, y1] of edges) {bounds[0] = Math.min(bounds[0], x0, x1); bounds[1] = Math.min(bounds[1], y0, y1); bounds[2] = Math.max(bounds[2], x0, x1); bounds[3] = Math.max(bounds[3], y0, y1);}
          shapes.push({edges, bounds, start: word.start, end: word.end});
        }
        x += pos.xAdvance / units;
      }
    }
  }
  return {layout: {shapes, width, height}, boxes};
}
