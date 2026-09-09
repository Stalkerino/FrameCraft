import {runProcess, ffmpegPath, ffprobePath} from '../server/services/process-service';
import {browserExecutable} from '../server/services/browser-service';
console.log(`Framecraft · ${process.platform} · Node ${process.version}`);
for(const binary of [ffmpegPath(), ffprobePath()]) {
  try {console.log((await runProcess(binary, ['-version'], 10_000)).split('\n')[0]);}
  catch(error) {console.error(String(error)); process.exitCode = 1;}
}
console.log(`Render browser: ${browserExecutable() || 'Remotion-managed Chrome (downloaded on first render)'}`);
