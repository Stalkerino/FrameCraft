import {createApp} from './app';
import {host, port} from './config';
import {serverOrigins} from './services/network-service';
const {app, codex, analysis, previews, audioEffects, audioMix, autoAudio, speedRamps, renders, nativePreview, waveforms, transfers} = await createApp();
const server = app.listen(port, host, () => {
  console.log(`Framecraft listening on ${host}:${port}`);
  for(const origin of serverOrigins(host, port)) if(new URL(origin).port === String(port)) console.log(`  ${origin}`);
});
server.on('error', error => {console.error(error.message); process.exitCode = 1;});
let closing = false;
const close = () => {
  if(closing) return; closing = true;
  transfers.close(); waveforms.close(); nativePreview.close(); renders.close(); codex.close(); analysis.close(); previews.close(); audioEffects.close(); audioMix.close(); autoAudio.close(); speedRamps.close(); server.close(); server.closeAllConnections();
  if(process.connected) process.disconnect();
};
process.on('SIGINT', close); process.on('SIGTERM', close);
// The desktop supervisor uses IPC for graceful shutdown on Windows too.
if(process.send) {
  process.on('message', message => {if(message && typeof message === 'object' && 'type' in message && message.type === 'desktop-shutdown') close();});
  process.on('disconnect', close);
}
