import {needsAudioMix} from './audio-mixer';
import {activeSequenceId, findSequence, projectForSequence, sequenceDuration} from './project-sequences';
import {z} from 'zod';
import {durationOf, type Clip, type Project} from './project';
import {projectTracks, trackClips} from './tracks';
import {isNeutralColorGrade} from './color-grading';
import {visualProperties} from './visual-editing';

export const timelineExportSchema = z.object({
  revision: z.number().int().nonnegative(), format: z.literal('premiere-xml').default('premiere-xml'),
  mediaRoot: z.string().trim().max(4096).optional(),
}).strict();
export type TimelineExportRequest = z.infer<typeof timelineExportSchema>;
export interface InterchangeMedia {assetId: string; name: string; filename: string; src: string; pathurl: string; fps: number; duration: number; width?: number; height?: number; audioChannels: number; sampleRate: number}
export interface InterchangeWarning {clipId?: string; name: string; message: string}
export interface TimelineExportReport {
  format: 'premiere-xml'; projectId: string; revision: number; name: string; fps: number; exportedFps: number; durationFrames: number;
  visualClips: number; audioClips: number; omittedClips: number; videoTracks: number; audioTracks: number;
  warnings: InterchangeWarning[]; media: InterchangeMedia[]; tracks: {type: 'video' | 'audio'; index: number; name: string}[];
}
export interface TimelineExportResult {report: TimelineExportReport; xmlUrl: string; reportUrl: string; projectUrl: string; filename: string}

/** XMEML has integer timebases plus the 1000/1001 NTSC variant. */
export function interchangeRate(fps: number) {
  if(!Number.isFinite(fps) || fps <= 0) throw new Error('Invalid timeline frame rate');
  const timebase = Math.round(fps); const ntsc = Math.abs(fps - timebase * 1000 / 1001) < .001;
  if(!ntsc && Math.abs(fps - timebase) > 1e-7) throw new Error(`Final Cut Pro 7 XML cannot represent ${fps} fps exactly. Use an integer or standard NTSC project frame rate for XML export.`);
  return {timebase, ntsc, fps: ntsc ? timebase * 1000 / 1001 : timebase};
}
const escapeXml = (value: unknown) => String(value).replace(/[^\u0009\u000a\u000d\u0020-\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]/gu, '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
const tag = (name: string, value: unknown) => `<${name}>${escapeXml(value)}</${name}>`;
const bool = (value: boolean) => value ? 'TRUE' : 'FALSE';
const rateXml = (fps: number) => {const rate = interchangeRate(fps); return `<rate>${tag('timebase', rate.timebase)}${tag('ntsc', bool(rate.ntsc))}</rate>`;};
const marker = (name: string, message: string, start: number, end: number) => `<marker>${tag('name', name)}${tag('comment', message)}${tag('in', start)}${tag('out', end)}</marker>`;

/** Separate overlaps into valid tracks while preserving the original drawing order. */
function lanes(clips: Clip[]): Clip[][] {
  const result: Clip[][] = [];
  for(const clip of clips) {
    let lane = 0;
    result.forEach((items, index) => {if(items.at(-1)!.start + items.at(-1)!.duration > clip.start) lane = index + 1;});
    (result[lane] ??= []).push(clip);
  }
  return result.length ? result : [[]];
}

/** Metadata-only interchange. Rendering-specific effects are reported, never silently flattened. */
interface XmlSequenceContext {prefix: string; sequences: Map<string, string>; emitted: Set<string>; next: {value: number}; durations: Map<string, number>}
/** Keep fixed-length instances valid when a child was shortened. Padding is an
 * empty XML tail, never a new media file or a change to the saved project. */
function nestedXmlDurations(project: Project) {
  const durations = new Map<string, number>(); const visited = new Set<string>();
  const visit = (id: string) => {
    const sequence = findSequence(project, id);
    durations.set(id, Math.max(durations.get(id) ?? 0, sequenceDuration(sequence)));
    if(visited.has(id)) return; visited.add(id);
    for(const clip of sequence.clips) if(clip.kind === 'sequence') {
      const child = findSequence(project, clip.sequenceId!);
      const end = Math.round((clip.sourceStart + clip.duration) / sequence.fps * child.fps);
      durations.set(child.id, Math.max(durations.get(child.id) ?? 0, end)); visit(child.id);
    }
  };
  visit(activeSequenceId(project)); return durations;
}
// XMEML clipitem accepts a nested sequence in place of a media file:
// https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/FinalCutPro_XML/Elements/Elements.html
export function buildPremiereXml(project: Project, media: InterchangeMedia[], context?: XmlSequenceContext): {xml: string; report: TimelineExportReport} {
  const currentId = activeSequenceId(project);
  const ctx = context ?? {prefix: '', sequences: new Map([[currentId, 'sequence-1']]), emitted: new Set(['sequence-1']), next: {value: 1}, durations: nestedXmlDurations(project)};
  const nestedMedia = new Map<string, InterchangeMedia>();
  for(const clip of project.clips) if(clip.kind === 'sequence' && !nestedMedia.has(clip.sequenceId!)) {
    const child = findSequence(project, clip.sequenceId!);
    nestedMedia.set(child.id, {assetId: child.id, name: child.name, filename: '', src: '', pathurl: '', fps: child.fps, duration: ctx.durations.get(child.id)! / child.fps, width: child.width, height: child.height, audioChannels: 2, sampleRate: 48000});
  }
  const rate = interchangeRate(project.fps); const warnings: InterchangeWarning[] = []; const markers: string[] = [];
  const mediaById = new Map(media.map(item => [item.assetId, item]));
  const report: TimelineExportReport = {format: 'premiere-xml', projectId: project.id, revision: project.revision, name: project.sequenceName ?? project.name, fps: project.fps, exportedFps: rate.fps, durationFrames: ctx.durations.get(currentId) ?? durationOf(project), visualClips: 0, audioClips: 0, omittedClips: 0, videoTracks: 0, audioTracks: 0, warnings, media, tracks: []};
  const warn = (message: string, clip?: Clip) => {
    warnings.push({name: clip?.name ?? project.name, ...(clip ? {clipId: clip.id} : {}), message});
    markers.push(marker(clip ? `Review: ${clip.name}` : 'Framecraft export notes', message, clip?.start ?? 0, clip ? clip.start + clip.duration : -1));
  };
  if(Math.abs(rate.fps - project.fps) > 1e-7) warn(`The ${project.fps} fps display rate is represented as ${rate.timebase} × 1000/1001. Timeline frame numbers are preserved.`);
  if(!isNeutralColorGrade(project.colorGrade)) warn('Project color grading is not transferred; rebuild the grade in the destination editor.');
  if(project.backgroundColor && project.backgroundColor.toLowerCase() !== '#000000') warn(`The project background (${project.backgroundColor}) is not transferred; gaps use the destination editor’s background.`);
  const mediaFor = (clip: Clip) => clip.kind === 'sequence' ? nestedMedia.get(clip.sequenceId!) : mediaById.get(clip.assetId!);
  if(needsAudioMix(project)) warn('Track mixer gain/pan/solo and master normalization/limiting are not transferred by this XML format. Use the rendered video for the mastered audio, or rebuild these buses in the destination editor.');
  const eligible = (clip: Clip) => (clip.kind === 'video' || clip.kind === 'audio' || clip.kind === 'image' || clip.kind === 'sequence') && !!mediaFor(clip);
  for(const clip of project.clips) {
    if(!eligible(clip)) {report.omittedClips++; warn(`${clip.kind} artwork is represented by this timeline marker, not a rendered or editable title. ${clip.text ? `Text: ${clip.text}` : 'Rebuild or render this element in the destination editor.'}`, clip); continue;}
    const omissions: string[] = [];
    if(clip.crop) omissions.push('crop'); if(clip.mask) omissions.push('mask');
    if(clip.x !== 50 || clip.y !== 50 || clip.scale !== 1 || clip.rotation || clip.zoom || visualProperties.some(property => clip.keyframes?.[property]?.length)) omissions.push('transform/opacity animation');
    if(!isNeutralColorGrade(clip.colorGrade)) omissions.push('color grade');
    if(clip.transition !== 'none' || clip.presetTransition) omissions.push('entrance transition');
    if(clip.audioEnvelope || clip.audioDucking) omissions.push('audio fades/automation/ducking');
    if(omissions.length) warn(`Rebuild these effects after import: ${omissions.join(', ')}. The cuts and source timing are retained.`, clip);
    const asset = project.assets.find(asset => asset.id === clip.assetId)!;
    if(asset?.speedProcessing) warn('Uses the saved retimed media copy: speed and freezes keep their appearance, but the speed curve is not native XML automation.', clip);
    if(asset?.audioProcessing) warn('Uses the saved processed audio file; EQ/compression/reverb are baked into that media.', clip);
    const source = mediaFor(clip)!;
    if(clip.kind !== 'audio' && (source.width !== project.width || source.height !== project.height)) warn('Source dimensions differ from the sequence. Use Set to Frame Size / fit in the destination editor to reproduce Framecraft’s contain fit.', clip);
  }
  interface Item {clip: Clip; media: InterchangeMedia; id: string; type: 'video' | 'audio'; channel: number; trackIndex: number; clipIndex: number; enabled: boolean}
  interface Track {name: string; enabled: boolean; items: Item[]; channel: number; channels: number}
  const videos: Track[] = []; const audios: Track[] = []; let id = 0;
  const addTrack = (target: Track[], name: string, clips: Clip[], type: Item['type'], enabled: boolean, channel = 1, channels = 1) => {
    const trackIndex = target.length + 1;
    const items = clips.filter(clip => eligible(clip) && (type === 'video' ? clip.kind !== 'audio' : mediaFor(clip)!.audioChannels >= channel)).map((clip, index): Item => ({clip, media: mediaFor(clip)!, id: `${ctx.prefix}clipitem-${++id}`, type, channel, trackIndex, clipIndex: index + 1, enabled: enabled && (type === 'video' || clip.volume > 0)}));
    target.push({name, enabled, items, channel, channels}); report.tracks.push({type, index: trackIndex, name});
  };
  for(const track of [...projectTracks(project)].reverse()) {
    const clips = trackClips(project, track.id).filter(eligible); const groups = lanes(clips);
    if(groups.length > 1) warn(`${track.name}: overlapping clips occupy separate XML tracks so their timing and stacking are retained.`);
    groups.forEach((group, lane) => {
      const name = `${track.name}${lane ? ` · overlap ${lane + 1}` : ''}`;
      if(track.type !== 'audio') addTrack(videos, name, group, 'video', !track.hidden);
      const channels = group.reduce((count, clip) => Math.max(count, mediaFor(clip)!.audioChannels), 0);
      for(let channel = 1; channel <= channels; channel++) addTrack(audios, `${name} · audio ${channel}`, group, 'audio', !track.hidden && !track.muted, channel, channels);
    });
  }
  const all = [...videos, ...audios].flatMap(track => track.items);
  const links = new Map<string, Item[]>(); for(const item of all) {const group = links.get(item.clip.id) ?? []; group.push(item); links.set(item.clip.id, group);}
  const fileIds = new Map(media.map((item, index) => [item.assetId, `${ctx.prefix}file-${index + 1}`])); const emitted = new Set<string>();
  const fileXml = (item: Item): string => {
    if(item.clip.kind === 'sequence') {
      const id = item.clip.sequenceId!;
      let nodeId = ctx.sequences.get(id);
      if(!nodeId) {nodeId = `sequence-${++ctx.next.value}`; ctx.sequences.set(id, nodeId);}
      if(ctx.emitted.has(nodeId)) return `<sequence id="${nodeId}"/>`;
      ctx.emitted.add(nodeId);
      const child = projectForSequence(project, id);
      const nested = buildPremiereXml(child, media, {...ctx, prefix: `${nodeId}_`});
      report.warnings.push(...nested.report.warnings.map(warning => ({...warning, name: `${item.clip.name} / ${warning.name}`})));
      report.omittedClips += nested.report.omittedClips;
      if(child.backgroundColor && child.backgroundColor !== '#000000') warn('Recreate the nested sequence canvas background in the destination editor; XML retains its edit structure, not a rendered background.', item.clip);
      return nested.xml.slice(nested.xml.indexOf('<sequence '), nested.xml.lastIndexOf('</xmeml>')).trim();
    }
    const source = item.media; const fileId = fileIds.get(source.assetId)!;
    if(emitted.has(fileId)) return `<file id="${fileId}"/>`; emitted.add(fileId);
    const video = item.clip.kind !== 'audio' ? `<video><samplecharacteristics>${rateXml(source.fps)}${tag('width', source.width ?? project.width)}${tag('height', source.height ?? project.height)}<anamorphic>FALSE</anamorphic><pixelaspectratio>square</pixelaspectratio><fielddominance>none</fielddominance></samplecharacteristics></video>` : '';
    const audio = source.audioChannels ? `<audio><samplecharacteristics><depth>16</depth>${tag('samplerate', source.sampleRate)}</samplecharacteristics>${tag('channelcount', source.audioChannels)}</audio>` : '';
    return `<file id="${fileId}">${tag('name', source.filename)}${tag('pathurl', source.pathurl)}${rateXml(source.fps)}${tag('duration', Math.ceil(source.duration * source.fps))}<media>${video}${audio}</media></file>`;
  };
  const level = (effect: 'opacity' | 'audiolevels', value: number) => `<filter><effect>${tag('name', effect === 'opacity' ? 'Opacity' : 'Audio Levels')}${tag('effectid', effect)}${tag('effectcategory', effect)}${tag('effecttype', effect === 'opacity' ? 'motion' : 'audio')}${tag('mediatype', effect === 'opacity' ? 'video' : 'audio')}<parameter>${tag('parameterid', effect === 'opacity' ? 'opacity' : 'level')}${tag('name', effect === 'opacity' ? 'Opacity' : 'Level')}${tag('value', value)}</parameter></effect></filter>`;
  const itemXml = (item: Item) => {
    const {clip, media: source} = item; const sourceRate = interchangeRate(source.fps).fps;
    const start = clip.kind === 'image' ? 0 : Math.round(clip.sourceStart / project.fps * sourceRate);
    const end = Math.max(start + 1, Math.round((clip.kind === 'image' ? clip.duration : clip.sourceStart + clip.duration) / project.fps * sourceRate));
    const fullDuration = Math.max(end, Math.ceil(source.duration * sourceRate));
    const references = links.get(clip.id)!.length > 1 ? links.get(clip.id)!.map(link => `<link>${tag('linkclipref', link.id)}${tag('mediatype', link.type)}${tag('trackindex', link.trackIndex)}${tag('clipindex', link.clipIndex)}${link.type === 'audio' ? '<groupindex>1</groupindex>' : ''}</link>`).join('') : '';
    const gain = clip.volume * (project.masterVolume ?? 1);
    const effect = item.type === 'audio' ? gain !== 1 ? level('audiolevels', gain) : '' : (clip.opacity ?? 1) !== 1 ? level('opacity', (clip.opacity ?? 1) * 100) : '';
    return `<clipitem id="${item.id}"${item.type === 'audio' ? ` premiereChannelType="${source.audioChannels === 2 ? 'stereo' : 'mono'}"` : ''}>${tag('name', clip.name)}${rateXml(source.fps)}${tag('duration', fullDuration)}${tag('start', clip.start)}${tag('end', clip.start + clip.duration)}${tag('in', start)}${tag('out', end)}${tag('enabled', bool(item.enabled))}${clip.kind === 'image' ? '<stillframe>TRUE</stillframe>' : ''}${fileXml(item)}<sourcetrack>${tag('mediatype', item.type)}${item.type === 'audio' ? tag('trackindex', item.channel) : ''}</sourcetrack>${effect}${references}</clipitem>`;
  };
  const trackXml = (track: Track, audio: boolean) => `<track${audio ? ` currentExplodedTrackIndex="${track.channel - 1}" totalExplodedTrackCount="${track.channels}" premiereTrackType="${track.channels === 2 ? 'Stereo' : 'Mono'}"` : ''}>${track.items.map(itemXml).join('')}${tag('enabled', bool(track.enabled))}<locked>FALSE</locked></track>`;
  report.visualClips = new Set(all.filter(item => item.type === 'video').map(item => item.clip.id)).size;
  report.audioClips = new Set(all.filter(item => item.type === 'audio').map(item => item.clip.id)).size;
  report.videoTracks = videos.length; report.audioTracks = audios.length;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE xmeml>\n<xmeml version="5"><sequence id="${ctx.sequences.get(currentId)}">${tag('name', project.sequenceName ?? project.name)}${tag('duration', report.durationFrames)}${rateXml(project.fps)}<timecode>${rateXml(project.fps)}<frame>0</frame><displayformat>NDF</displayformat></timecode><media><video><format><samplecharacteristics>${rateXml(project.fps)}${tag('width', project.width)}${tag('height', project.height)}<anamorphic>FALSE</anamorphic><pixelaspectratio>square</pixelaspectratio><fielddominance>none</fielddominance></samplecharacteristics></format>${videos.map(track => trackXml(track, false)).join('')}</video><audio><numOutputChannels>2</numOutputChannels><format><samplecharacteristics><depth>16</depth><samplerate>48000</samplerate></samplecharacteristics></format>${audios.map(track => trackXml(track, true)).join('')}</audio></media>${markers.join('')}</sequence></xmeml>\n`;
  return {xml, report};
}
