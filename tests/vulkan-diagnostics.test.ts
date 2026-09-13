import {expect, it} from 'vitest';
import {vulkanDiagnosticGuard} from '../server/services/rendering/vulkan-diagnostics';
import {runEncodingProcess} from '../server/services/ffmpeg-progress-service';

it('rejects a disabled shader even when the encoder exits successfully, including split diagnostic messages', async () => {
  const guard = vulkanDiagnosticGuard();
  guard('frame 1 complete\n'); guard('Failed executing ho');
  expect(() => guard('ok, disabling\n')).toThrow('Vulkan shader failed');
  await expect(runEncodingProcess(process.execPath, ['-e', "process.stderr.write('Failed executing hook, disabling\\n');process.stdout.write('frame=30\\nprogress=end\\n');"], {onDiagnostic: vulkanDiagnosticGuard()})).rejects.toThrow('Vulkan shader failed');
});
