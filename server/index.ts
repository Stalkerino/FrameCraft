import {createApp} from './app';
import {host, port} from './config';
import {serverOrigins} from './services/network-service';
const {app, codex, analysis, previews, audioEffects} = await createApp();
const server = app.listen(port, host, () => {
  console.log(`Framecraft listening on ${host}:${port}`);
  for(const origin of serverOrigins(host, port)) if(new URL(origin).port === String(port)) console.log(`  ${origin}`);
});
server.on('error', error => {console.error(error.message); process.exitCode = 1;});
const close = () => {codex.close(); analysis.close(); previews.close(); audioEffects.close(); server.close(); server.closeAllConnections();};
process.on('SIGINT', close); process.on('SIGTERM', close);
