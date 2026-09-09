import {expect, it} from 'vitest';
import {createDemo} from '../shared/demo';
import {clipSchema} from '../shared/project';
import {buildPremiereXml, interchangeRate, type InterchangeMedia} from '../shared/timeline-interchange';
import {interchangeFileUrl} from '../server/services/timeline-export-service';

it('exports mixed-rate cuts, disabled tracks, linked source channels and review markers without changing the project', () => {
  const project = {...createDemo(), name: 'Cuts <&> "demo"', width: 1280, height: 720, fps: 30, backgroundColor: '#000000', tracks: [{id: 'v', name: 'Video 1', type: 'visual' as const, hidden: false, muted: true}], assets: [{id: 'source', kind: 'video' as const, name: 'Source', src: '/media/source.mp4', duration: 8}], clips: [
    clipSchema.parse({id: 'a', name: 'First <&>', kind: 'video', track: 'visual', trackId: 'v', assetId: 'source', start: 0, duration: 30, sourceStart: 60}),
    clipSchema.parse({id: 'b', name: 'Second', kind: 'video', track: 'visual', trackId: 'v', assetId: 'source', start: 45, duration: 15, sourceStart: 0, crop: {left: 10}}),
    clipSchema.parse({id: 'title', name: 'Title', kind: 'text', track: 'text', start: 10, duration: 20, text: 'An <editable> note & \u0001'}),
  ]};
  const media: InterchangeMedia[] = [{assetId: 'source', name: 'Source', filename: 'source.mp4', src: '/media/source.mp4', pathurl: 'file:///media/source.mp4', fps: 60, duration: 8, width: 1280, height: 720, audioChannels: 2, sampleRate: 48000}];
  const original = JSON.stringify(project); const {xml, report} = buildPremiereXml(project, media);
  expect(JSON.stringify(project)).toBe(original);
  expect(report).toMatchObject({visualClips: 2, audioClips: 2, omittedClips: 1, videoTracks: 1, audioTracks: 2, durationFrames: 60});
  expect(xml).toContain('<start>0</start><end>30</end><in>120</in><out>180</out>');
  expect(xml).toContain('<start>45</start><end>60</end><in>0</in><out>30</out>');
  expect(xml).toContain('First &lt;&amp;&gt;'); expect(xml).not.toContain('\u0001');
  expect(xml.match(/<file id="file-1">/g)).toHaveLength(1);
  expect(xml.match(/<clipitem id=/g)).toHaveLength(6);
  expect(xml.match(/<linkclipref>/g)).toHaveLength(18);
  expect(xml.match(/<enabled>FALSE<\/enabled>/g)?.length).toBe(6);
  expect(report.warnings.some(warning => warning.clipId === 'b' && warning.message.includes('crop'))).toBe(true);
  expect(xml).toContain('Text: An &lt;editable&gt; note &amp;');
});

it('preserves overlap drawing order using additional non-overlapping tracks', () => {
  const project = createDemo(); project.fps = 30; project.tracks = [{id: 'v', name: 'Capture', type: 'visual', hidden: false, muted: false}];
  project.clips = [[0, 20], [5, 5], [10, 20], [21, 4]].map(([start, duration], index) => clipSchema.parse({id: String(index), name: String(index), kind: 'video', track: 'visual', trackId: 'v', assetId: 'source', start, duration}));
  project.assets = [{id: 'source', kind: 'video', name: 'Source', src: '/media/a.mp4', duration: 3}];
  const result = buildPremiereXml(project, [{assetId: 'source', name: 'Source', filename: 'a.mp4', src: '/media/a.mp4', pathurl: 'file:///a.mp4', fps: 30, duration: 3, width: project.width, height: project.height, audioChannels: 0, sampleRate: 48000}]);
  expect(result.report.videoTracks).toBe(3); expect(result.report.audioTracks).toBe(0);
  expect(result.report.warnings.some(warning => warning.message.includes('overlapping'))).toBe(true);
});

it('encodes NTSC rates and cross-platform media paths without reinterpreting frame numbers', () => {
  expect(interchangeRate(29.97)).toMatchObject({timebase: 30, ntsc: true}); expect(interchangeRate(60)).toMatchObject({timebase: 60, ntsc: false});
  expect(() => interchangeRate(27.5)).toThrow('cannot represent');
  const windowsUrl = new URL(interchangeFileUrl('/local/a.mp4', 'shot #1 &.mp4', 'D:\\Framecraft Media'));
  expect(decodeURIComponent(windowsUrl.pathname)).toBe('/D:/Framecraft Media/shot #1 &.mp4'); expect(windowsUrl.hash).toBe('');
  expect(interchangeFileUrl('/local/a.mp4', 'a.mp4', '/home/user/media')).toBe('file:///home/user/media/a.mp4');
  expect(interchangeFileUrl('/local/a.mp4', 'a.mp4', '\\\\server\\share')).toBe('file://server/share/a.mp4');
  expect(() => interchangeFileUrl('/local/a.mp4', 'a.mp4', 'relative/folder')).toThrow('absolute');
});
