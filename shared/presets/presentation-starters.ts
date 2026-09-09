import {presetDefinitionSchema, type PresetDefinition} from '../asset-presets';

// Recipes are portable data. Artwork is shared by the editor, thumbnails and export.
const palette = {panel: '#141b20', subtle: '#253139', text: '#f1f5f6', muted: '#a8bbc3', teal: '#64dcc5', amber: '#ffc978'};
const text = (key: string, label: string, value: string) => ({key, label, type: 'text', default: value});
const color = (key: string, label: string, value: string) => ({key, label, type: 'color', default: value});
const number = (key: string, label: string, value: number, min: number, max: number, step = 1) => ({key, label, type: 'number', default: value, min, max, step});
const accent = color('accent', 'Accent color', palette.teal);
const panel = color('panel', 'Panel color', palette.panel);
const foreground = color('foreground', 'Text color', palette.text);
const ref = (param: string) => ({param});
const linear = (start: number, end: number) => ({easing: 'linear', keyframes: [{at: 0, value: start}, {at: 1, value: end}]});
const fade = {keyframes: [{at: 0, value: 0}, {at: .08, value: 1}, {at: .9, value: 1}, {at: 1, value: 0}]};
const base = (id: string, name: string, description: string, category: PresetDefinition['category'], duration: number, parameters: unknown[], layers: unknown[], extra: object = {}) => ({
  id, definition: presetDefinitionSchema.parse({schemaVersion: 1, name, description, category, duration, parameters, layers, ...extra}),
});
const heading = (id: string, x: number, y: number, width: number, parameter: string, fontSize: number, extra: object = {}) => ({
  id, type: 'text', x, y, width, text: ref(parameter), fontSize, fill: ref('foreground'), ...extra,
});
const comparisonParameters = [text('before', 'First label', 'BEFORE'), text('after', 'Second label', 'AFTER'), accent, foreground, panel];
const label = (id: string, x: number, y: number, parameter: string) => [
  {id: `${id}-panel`, type: 'rect', x, y, width: 22, height: 8, radius: .8, fill: ref('panel'), opacity: .92},
  heading(id, x, y, 20, parameter, 2.8),
];

export const presentationStarters: {id: string; definition: PresetDefinition}[] = [
  base('comparison-wipe-horizontal', 'Comparison · Left to right',
    'Reveal the incoming full-frame video from left to right with a synchronized divider. Stack aligned videos on separate video tracks for a moving comparison; this recipe does not align or crop media.',
    'transition', 4, [color('divider', 'Divider color', palette.text), number('thickness', 'Divider width (%)', .25, .05, 2, .05)], [
      {id: 'divider', type: 'rect', x: linear(0, 100), width: ref('thickness'), height: 100, fill: ref('divider')},
    ], {reveal: {type: 'wipe', direction: 'right'}, tags: ['comparison', 'before-after', 'wipe']}),
  base('comparison-wipe-vertical', 'Comparison · Top to bottom',
    'Reveal the incoming full-frame video downward with a synchronized horizontal divider. Align the two videos on separate video tracks first; this recipe only supplies the reveal and divider.',
    'transition', 4, [color('divider', 'Divider color', palette.text), number('thickness', 'Divider height (%)', .4, .05, 3, .05)], [
      {id: 'divider', type: 'rect', y: linear(0, 100), width: 100, height: ref('thickness'), fill: ref('divider')},
    ], {reveal: {type: 'wipe', direction: 'down'}, tags: ['comparison', 'before-after', 'wipe']}),
  base('comparison-side-by-side', 'Comparison · Side by side',
    'Static labels and a center divider on a transparent overlay. Place videos beside one another first (centers 25/75%, Y 50%, scale 0.5 for matching aspect ratios). Does not mask or arrange video.',
    'overlay', 8, comparisonParameters, [
      {id: 'divider', type: 'rect', width: .18, height: 84, fill: ref('accent')},
      ...label('before-label', 25, 12, 'before'), ...label('after-label', 75, 12, 'after'),
    ], {tags: ['comparison', 'labels', 'split-screen']}),
  base('comparison-stacked', 'Comparison · Stacked',
    'Static top/bottom labels and a horizontal divider on a transparent overlay. Place videos at X 50%, Y 25/75%, scale 0.5 for matching aspect ratios. This artwork does not crop or arrange video.',
    'overlay', 8, comparisonParameters, [
      {id: 'divider', type: 'rect', width: 84, height: .3, fill: ref('accent')},
      ...label('before-label', 15, 8, 'before'), ...label('after-label', 15, 58, 'after'),
    ], {tags: ['comparison', 'labels', 'split-screen']}),
  base('presentation-pip-frame', 'Picture in picture · Frame',
    'An open frame and label for a separately placed inset video: X 80%, Y 22%, scale 0.3 when its aspect ratio matches the project. Interior stays clear. Move/scale the graphic and inset together.',
    'overlay', 8, [text('label', 'Inset label', 'DETAIL VIEW'), accent, foreground, panel], [
      {id: 'top', type: 'rect', x: 80, y: 6.7, width: 31, height: .5, fill: ref('accent')},
      {id: 'bottom', type: 'rect', x: 80, y: 37.3, width: 31, height: .5, fill: ref('accent')},
      {id: 'left', type: 'rect', x: 64.7, y: 22, width: .28, height: 30.6, fill: ref('accent')},
      {id: 'right', type: 'rect', x: 95.3, y: 22, width: .28, height: 30.6, fill: ref('accent')},
      {id: 'label-panel', type: 'rect', x: 80, y: 42, width: 31, height: 7, fill: ref('panel')},
      heading('label', 80, 42, 28, 'label', 2.6),
    ], {tags: ['picture-in-picture', 'frame', 'presentation']}),
  ...([
    {id: 'feature-callout', name: 'Feature · Callout', tag: 'NEW FEATURE', title: 'Movement, refined', detail: 'More control. Better feedback.', accent: palette.teal},
    {id: 'fix-callout', name: 'Fix · Callout', tag: 'FIXED', title: 'No more clipping', detail: 'Cleaner collisions at every angle.', accent: palette.amber},
  ]).map(card => base(card.id, card.name, 'An animated lower-left callout with editable label, headline and detail. Keep text concise; it is an overlay, not a change to the footage.',
    'lower-third', 5, [text('tag', 'Category label', card.tag), text('title', 'Headline', card.title), text('detail', 'Detail', card.detail), color('accent', 'Accent color', card.accent), foreground, panel], [
      {id: 'panel', type: 'rect', x: 29, y: 79, width: 46, height: 27, radius: 1.2, fill: ref('panel'), opacity: fade},
      {id: 'rule', type: 'rect', x: 6.6, y: 79, width: .3, height: 23, fill: ref('accent'), opacity: fade},
      heading('tag', 29, 70, 40, 'tag', 2.3, {fill: ref('accent'), align: 'left', opacity: fade}),
      heading('title', 29, 79, 40, 'title', 4.1, {align: 'left', opacity: fade}),
      heading('detail', 29, 87, 40, 'detail', 2.5, {weight: '400', align: 'left', opacity: fade}),
    ], {tags: ['devlog', 'callout']})),
  base('result-card', 'Result · Metric card',
    'An editable result card for performance, milestones or benchmark comparisons. Metric values are text you provide; this does not measure gameplay or calculate statistics.',
    'overlay', 5, [text('label', 'Metric label', 'FRAME TIME'), text('value', 'Result', '8.3 ms'), text('detail', 'Context', '1440p · Optimized build'), accent, foreground, panel], [
      {id: 'panel', type: 'rect', width: 48, height: 43, radius: 1.5, fill: ref('panel'), opacity: fade},
      {id: 'accent-rule', type: 'rect', y: 30, width: 42, height: .4, fill: ref('accent'), opacity: fade},
      heading('label', 50, 38, 42, 'label', 2.7, {fill: ref('accent'), opacity: fade}),
      heading('value', 50, 51, 42, 'value', 10, {opacity: fade}),
      heading('detail', 50, 65, 42, 'detail', 2.6, {weight: '400', opacity: fade}),
    ], {tags: ['metric', 'benchmark', 'presentation']}),
  base('shortcut-card', 'Keyboard · Shortcut card',
    'A compact key combination and action label for controls or tutorials. Keys and action are editable text; this graphic does not listen for keyboard input.',
    'overlay', 4, [text('keys', 'Keys', 'SHIFT + SPACE'), text('action', 'Action', 'DASH'), accent, foreground, panel], [
      {id: 'panel', type: 'rect', x: 50, y: 83, width: 54, height: 18, radius: 1.1, fill: ref('panel'), opacity: fade},
      {id: 'keycap', type: 'rect', x: 40, y: 83, width: 30, height: 12, radius: .8, fill: palette.subtle, stroke: ref('accent'), strokeWidth: .13, opacity: fade},
      heading('keys', 40, 83, 28, 'keys', 3.2, {opacity: fade}),
      heading('action', 66, 83, 19, 'action', 2.7, {fill: ref('accent'), opacity: fade}),
    ], {tags: ['tutorial', 'controls', 'keyboard']}),
  base('code-panel', 'Code · Explanation panel',
    'A plain-text code or pseudocode panel with a file label and note. Newlines are supported; syntax highlighting and executable code are not. Use short lines and adjust text size for the project.',
    'overlay', 7, [text('file', 'File label', 'movement.ts'), text('code', 'Code / pseudocode', 'velocity += input * acceleration\nvelocity *= friction\nposition += velocity * delta'), text('note', 'Explanation', 'Small changes. A better feel.'), number('size', 'Code text size (%)', 3.3, 1, 7, .1), accent, foreground, panel], [
      {id: 'panel', type: 'rect', width: 78, height: 60, radius: 1.4, fill: ref('panel'), opacity: fade},
      {id: 'header-rule', type: 'rect', y: 33, width: 72, height: .18, fill: palette.subtle, opacity: fade},
      heading('file', 50, 27, 68, 'file', 2.7, {align: 'left', fill: ref('accent'), opacity: fade}),
      heading('code', 50, 49, 68, 'code', 3.3, {fontSize: ref('size'), align: 'left', weight: '400', opacity: fade}),
      heading('note', 50, 72, 68, 'note', 2.6, {align: 'left', fill: ref('accent'), weight: '400', opacity: fade}),
    ], {tags: ['code', 'tutorial', 'presentation']}),
  base('step-badge', 'Tutorial · Step badge',
    'A small numbered step label in the upper-left corner. Edit the number and instruction, then reuse on each tutorial segment.',
    'overlay', 5, [text('step', 'Step number', '01'), text('label', 'Instruction', 'BUILD THE FOUNDATION'), accent, foreground, panel], [
      {id: 'panel', type: 'rect', x: 29, y: 13, width: 46, height: 12, radius: .8, fill: ref('panel'), opacity: fade},
      {id: 'badge', type: 'rect', x: 10, y: 13, width: 6, height: 9, radius: .5, fill: ref('accent'), opacity: fade},
      heading('step', 10, 13, 5, 'step', 3.7, {fill: ref('panel'), opacity: fade}),
      heading('label', 32, 13, 35, 'label', 2.7, {align: 'left', opacity: fade}),
    ], {tags: ['tutorial', 'step', 'label']}),
  base('progress-line', 'Progress · Timeline line',
    'A thin lower-screen progress line that fills linearly over the graphic clip duration. Set its duration to match a chapter or demonstration; it does not inspect the rest of the timeline.',
    'overlay', 10, [accent, color('track', 'Track color', palette.subtle), number('thickness', 'Line height (%)', .45, .1, 2, .05)], [
      {id: 'track', type: 'rect', x: 50, y: 96, width: 88, height: ref('thickness'), fill: ref('track')},
      {id: 'fill', type: 'rect', x: linear(6, 50), y: 96, width: linear(0, 88), height: ref('thickness'), fill: ref('accent')},
    ], {tags: ['progress', 'chapter', 'tutorial']}),
  base('section-card', 'Chapter · Section card',
    'A clean full-frame chapter break with an index, headline and summary. Use a short headline or insert a newline; adjust type size for longer text.',
    'title', 4, [text('index', 'Chapter index', '02 / THE ITERATION'), text('title', 'Headline', 'Making it feel right'), text('subtitle', 'Summary', 'Movement · Feedback · Polish'), number('size', 'Headline size (%)', 7, 3, 12, .5), accent, foreground, panel], [
      {id: 'background', type: 'rect', width: 100, height: 100, fill: ref('panel')},
      {id: 'rule', type: 'rect', x: 8, y: 50, width: .4, height: 44, fill: ref('accent'), opacity: fade},
      heading('index', 53, 33, 80, 'index', 2.6, {align: 'left', fill: ref('accent'), opacity: fade}),
      heading('title', 53, 50, 80, 'title', 7, {fontSize: ref('size'), align: 'left', opacity: fade}),
      heading('subtitle', 53, 67, 80, 'subtitle', 2.9, {align: 'left', weight: '400', opacity: fade}),
    ], {tags: ['chapter', 'devlog', 'presentation']}),
  base('clean-fade', 'Transition · Clean dissolve',
    'A restrained linear reveal of the incoming clip. Change the transition duration to control the dissolve; there are no decorative graphics.',
    'transition', .6, [], [], {reveal: {type: 'fade'}, tags: ['clean', 'dissolve']}),
  base('accent-edge-wipe', 'Transition · Accent edge',
    'A quick left-to-right reveal led by a colored edge. Duration, edge color and width are editable; the edge follows the same linear progress as the reveal.',
    'transition', .65, [accent, number('width', 'Edge width (%)', 1.2, .1, 8, .1)], [
      {id: 'edge', type: 'rect', x: linear(0, 100), width: ref('width'), height: 100, fill: ref('accent')},
    ], {reveal: {type: 'wipe', direction: 'right'}, tags: ['clean', 'wipe', 'devlog']}),
  base('focus-marker', 'Annotation · Focus marker',
    'A small animated target marker with a leader line and short label. Move the graphic clip to point at a detail. This is a fixed annotation, not automatic object tracking.',
    'overlay', 4, [text('label', 'Annotation', 'NOTICE THE DETAIL'), accent, foreground, panel], [
      {id: 'point', type: 'ellipse', x: 35, y: 50, width: 1.2, height: 2.1, fill: ref('accent'), opacity: fade, scale: {keyframes: [{at: 0, value: .3}, {at: .12, value: 1.3}, {at: .22, value: 1}]}},
      {id: 'leader', type: 'rect', x: 43, y: 50, width: 15, height: .2, fill: ref('accent'), opacity: fade},
      {id: 'panel', type: 'rect', x: 65, y: 50, width: 29, height: 9, radius: .7, fill: ref('panel'), opacity: fade},
      heading('label', 65, 50, 27, 'label', 2.5, {opacity: fade}),
    ], {tags: ['annotation', 'detail', 'presentation']}),
  base('caption-strip', 'Caption · Explanation strip',
    'A readable lower-screen explanation with editable text and size. For manually written commentary over silent gameplay; this recipe does not transcribe or generate captions.',
    'lower-third', 5, [text('caption', 'Caption', 'The new system reacts to the surface beneath you.'), number('size', 'Text size (%)', 3, 1.5, 6, .1), foreground, panel], [
      {id: 'panel', type: 'rect', x: 50, y: 87, width: 84, height: 15, radius: .8, fill: ref('panel'), opacity: fade},
      heading('caption', 50, 87, 78, 'caption', 3, {fontSize: ref('size'), weight: '600', opacity: fade}),
    ], {tags: ['caption', 'gameplay', 'explanation']}),
];
