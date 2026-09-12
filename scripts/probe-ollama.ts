/** Manual, real-model integration probe. Never connects an agent to the live editor.
 * node --import tsx scripts/probe-ollama.ts --url http://HOST:11434 --model qwen3.5:9b
 * Add --vision for a synthetic RED/GREEN source inspection and saved-cut check.
 */
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {createServer, type Server} from 'node:http';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {parseArgs} from 'node:util';
import type {AgentSession} from '../shared/agent';
import type {Snapshot} from '../shared/project';
import type {VideoCut} from '../shared/visual-rush';

const {values} = parseArgs({options: {
  url: {type: 'string'}, model: {type: 'string'}, context: {type: 'string', default: '16384'},
  timeout: {type: 'string', default: '120'}, vision: {type: 'boolean', default: false}, help: {type: 'boolean', default: false},
}});
if(values.help) {
  console.log('Usage: node --import tsx scripts/probe-ollama.ts --url http://HOST:11434 --model MODEL [--context 16384] [--timeout 120] [--vision]\nURL/model also accept FRAMECRAFT_PROBE_OLLAMA_URL and FRAMECRAFT_PROBE_OLLAMA_MODEL. Each real agent turn is bounded to 60–120 seconds. The optional vision phase needs FFmpeg. All editor data and libraries are temporary; workspace tools are disabled.');
} else {
  await main().catch(error => {console.error(JSON.stringify({probe: 'failed', error: (error as Error).message})); process.exitCode = 1;});
}

async function main() {
  const ollamaUrl = values.url ?? process.env.FRAMECRAFT_PROBE_OLLAMA_URL;
  const model = values.model ?? process.env.FRAMECRAFT_PROBE_OLLAMA_MODEL;
  if(!ollamaUrl || !model) throw new Error('Provide --url and --model, or FRAMECRAFT_PROBE_OLLAMA_URL and FRAMECRAFT_PROBE_OLLAMA_MODEL.');
  const context = Number(values.context); const timeout = Number(values.timeout) * 1000;
  assert(Number.isInteger(context) && context >= 4096 && context <= 262144, 'Context must be 4096–262144 tokens.');
  assert(Number.isInteger(timeout) && timeout >= 60000 && timeout <= 120000, 'Timeout must be 60–120 seconds per turn.');
  const directory = await mkdtemp(path.join(tmpdir(), 'framecraft-ollama-probe-'));
  let server: Server | undefined;
  let services: Awaited<ReturnType<typeof import('../server/app').createApp>> | undefined;
  const failures: {phase: string; error: string}[] = [];
  const phases: Record<string, unknown>[] = [];
  const started = Date.now();
  try {
    // Configuration is captured at import time. Set EVERY writable location before
    // importing the app, and listen on an isolated port selected by the operating system.
    const reservation = createServer();
    await new Promise<void>((resolve, reject) => {reservation.once('error', reject); reservation.listen(0, '127.0.0.1', resolve);});
    const address = reservation.address(); assert(address && typeof address !== 'string');
    const port = address.port;
    await new Promise<void>((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
    process.env.FRAMECRAFT_DATA_DIR = path.join(directory, 'data');
    process.env.FRAMECRAFT_LIBRARY_DIR = path.join(directory, 'library');
    process.env.FRAMECRAFT_MODEL_CACHE = path.join(directory, 'model-cache');
    process.env.FRAMECRAFT_HOST = '127.0.0.1'; process.env.PORT = String(port);
    const {createApp} = await import('../server/app');
    services = await createApp();
    server = createServer(services.app);
    await new Promise<void>((resolve, reject) => {server!.once('error', reject); server!.listen(port, '127.0.0.1', resolve);});
    const editorUrl = `http://127.0.0.1:${port}`;
    console.log(JSON.stringify({probe: 'started', model, context, timeoutSeconds: timeout / 1000, editorUrl, temporaryDirectory: directory, workspaceAccess: 'disabled'}));

    async function api<T>(route: string, body?: unknown): Promise<T> {
      const response = await fetch(editorUrl + route, {method: body === undefined ? 'GET' : 'POST', headers: {'Content-Type': 'application/json'}, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000)});
      const result = await response.json();
      if(!response.ok) throw new Error(`${route}: ${JSON.stringify(result)}`);
      return result as T;
    }
    const initial = await api<Snapshot>('/api/project');
    const blank = await api<Snapshot>('/api/projects', {action: 'new', revision: initial.project.revision, name: 'Isolated Ollama probe', settings: {width: 640, height: 360, fps: 30}});
    assert.equal(blank.project.clips.length, 0); assert.equal(blank.project.assets.length, 0);
    await api('/api/agent/chat/provider', {provider: 'ollama', ollamaUrl, contextLength: context, workspaceAccess: 'disabled', workspacePath: ''});
    await api('/api/agent/chat/models/refresh', {});
    await api('/api/agent/chat/settings', {model, effort: null, serviceTier: null});
    let session = await api<AgentSession>('/api/agent/chat/start', {fresh: true});
    const metadata = session.models.find(entry => entry.model === model);
    const effort = metadata?.supportedReasoningEfforts.some(option => option.reasoningEffort === 'off') ? 'off'
      : metadata?.supportedReasoningEfforts.some(option => option.reasoningEffort === 'low') ? 'low' : null;
    if(effort) session = await api<AgentSession>('/api/agent/chat/settings', {model, effort, serviceTier: null});
    await api('/api/agent/chat/auto-approve', {enabled: true});

    async function turn(phase: string, prompt: string) {
      const turnStarted = Date.now(); const before = services!.codex.snapshot();
      const oldActivity = new Set(before.activity.map(activity => activity.id));
      const printed = new Set<string>();
      const watch = (snapshot: AgentSession) => {
        for(const activity of snapshot.activity) {
          const key = activity.id + ':' + activity.status;
          if(oldActivity.has(activity.id) || printed.has(key) || activity.label === 'Thinking') continue;
          printed.add(key);
          console.log(JSON.stringify({phase, elapsedSeconds: Math.round((Date.now() - turnStarted) / 1000), tool: activity.label, status: activity.status, ...(activity.status === 'failed' ? {error: activity.detail.slice(-900)} : {})}));
        }
      };
      services!.codex.on('change', watch);
      try {
        await api('/api/agent/chat/message', {text: prompt});
        while(services!.codex.snapshot().status === 'working') {
          if(Date.now() - turnStarted >= timeout) {
            await Promise.race([services!.codex.interrupt(), delay(8000, undefined, {ref: false})]);
            throw new Error(`${phase} did not finish within ${timeout / 1000} seconds.`);
          }
          await delay(200);
        }
        const done = services!.codex.snapshot(); watch(done);
        if(done.error) throw new Error(done.error);
        return done;
      } finally {
        services!.codex.off('change', watch);
        const done = services!.codex.snapshot();
        const activity = done.activity.filter(item => !oldActivity.has(item.id));
        phases.push({phase, elapsedSeconds: Math.round((Date.now() - turnStarted) / 100) / 10, model: done.model, effort: done.effort, runtime: done.ollamaRuntime, tools: activity.filter(item => item.label !== 'Thinking').map(item => ({name: item.label, status: item.status, ...(item.status === 'failed' ? {error: item.detail.slice(-1200)} : {})})), answer: done.messages.filter(message => message.role === 'assistant').at(-1)?.text.slice(0,1800), error: done.error});
      }
    }

    try {
      const completed = await turn('editing', 'Read the project first. Perform these exact sequential edits using the small native tools add_text_clip, update_clip, then split_clip. Add one text clip saying LOCAL PROBE on the text track at timeline frame 30 with duration 120 frames. Then UPDATE that same clip to x=25, y=70, opacity=0.6. Then SPLIT that same clip at absolute timeline frame 90. Read the current revision after each edit. Do not create two clips directly, clear the project, render, or change other settings. Finally read the project and report what actually succeeded.');
      const expectedTools = ['add_text_clip', 'update_clip', 'split_clip'];
      assert.deepEqual(completed.activity.filter(item => item.status === 'completed' && expectedTools.includes(item.label)).map(item => item.label), expectedTools, 'Expected the three native editing calls in order.');
      const actual = (await api<Snapshot>('/api/project')).project;
      assert.equal(actual.id, blank.project.id, 'The agent switched projects.');
      assert.equal(actual.clips.length, 2, 'Expected exactly two clips after splitting.');
      const clips = [...actual.clips].sort((a, b) => a.start - b.start);
      for(const clip of clips) {
        assert.equal(clip.kind, 'text'); assert.equal(clip.text, 'LOCAL PROBE'); assert.equal(clip.track, 'text');
        assert.equal(clip.duration, 60); assert.equal(clip.x, 25); assert.equal(clip.y, 70); assert.equal(clip.opacity, 0.6);
      }
      assert.deepEqual(clips.map(clip => clip.start), [30, 90]);
      assert.equal(actual.revision, blank.project.revision + 3, 'Expected three separately committed edits.');
      console.log(JSON.stringify({phase: 'editing', assertions: 'passed', clipIds: clips.map(clip => clip.id), revision: actual.revision}));
    } catch(error) {failures.push({phase: 'editing', error: (error as Error).message});}

    if(values.vision && !failures.length) {
      try {
        assert(session.vision, 'The selected model has no vision capability.');
        const sharp = (await import('sharp')).default;
        const {ffmpegPath, runProcess} = await import('../server/services/process-service');
        for(const [color, hex] of [['RED', '#ff0000'], ['GREEN', '#00ff00']]) {
          const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="${hex}"/><text x="320" y="210" text-anchor="middle" font-family="sans-serif" font-size="84" font-weight="bold" fill="black">${color}</text></svg>`;
          await sharp(Buffer.from(svg)).png().toFile(path.join(directory, color + '.png'));
        }
        const fixture = path.join(directory, 'color-sections.mp4');
        await runProcess(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-y', '-loop', '1', '-framerate', '12', '-t', '2', '-i', path.join(directory, 'RED.png'), '-loop', '1', '-framerate', '12', '-t', '2', '-i', path.join(directory, 'GREEN.png'), '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]', '-map', '[v]', '-an', '-c:v', 'libx264', '-threads', '1', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', fixture], 30000);
        const imported = await api<Snapshot>('/api/import-path', {filePath: fixture});
        const asset = imported.project.assets.find(entry => entry.name === 'color-sections.mp4'); assert(asset);
        await api('/api/agent/chat/start', {fresh: true});
        await turn('vision', `Read get_project. Analyze imported video asset ${asset.id} and wait for the visual report. Inspect the ACTUAL images at source time 0.5 and 2.5 seconds. Record brief visual observations with record_video_observations before inspecting the next image. Save a reviewable cut titled Visual probe containing exactly the two source ranges 0..1 and 2..3 seconds, in order. Each shot reason must describe its inspected background color and displayed word; use those exact inspected timestamps as evidence. Do not infer what the images show from the filename. Do not apply the cut or alter the existing timeline. Finish after the proposal is saved.`);
        const library = await api<{cuts: VideoCut[]}>('/api/visual-rush');
        const cut = library.cuts.find(proposal => proposal.title === 'Visual probe'); assert(cut, 'The model did not save the requested cut.');
        assert.equal(cut.shots.length, 2);
        assert.deepEqual(cut.shots.map(shot => [shot.start, shot.end]), [[0, 1], [2, 3]]);
        assert.match(cut.shots[0].reason, /\b(?:red|rouge)\b/i); assert.match(cut.shots[1].reason, /\b(?:green|vert)\b/i);
        assert(cut.shots[0].evidence.includes(0.5)); assert(cut.shots[1].evidence.includes(2.5));
        assert.equal((await api<Snapshot>('/api/project')).project.clips.length, 2, 'Vision review unexpectedly modified the timeline.');
        console.log(JSON.stringify({phase: 'vision', assertions: 'passed', cutId: cut.id}));
      } catch(error) {failures.push({phase: 'vision', error: (error as Error).message});}
    }
    console.log(JSON.stringify({probe: failures.length ? 'failed' : 'passed', model, context, elapsedSeconds: Math.round((Date.now() - started) / 100) / 10, phases, failures}, null, 2));
    if(failures.length) process.exitCode = 1;
  } finally {
    // Only paths created by this invocation are removed. No production data,
    // model installation, editor process or shared asset library is touched.
    if(services) {
      await Promise.race([services.codex.interrupt().catch(() => undefined), delay(8000, undefined, {ref: false})]);
      services.codex.close(); services.analysis.close(); services.previews.close(); services.audioEffects.close(); services.speedRamps.close();
    }
    if(server) {server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve()));}
    await rm(directory, {recursive: true, force: true, maxRetries: 5, retryDelay: 200});
  }
}
