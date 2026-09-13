/** libplacebo can disable a failed hook yet FFmpeg continues with exit 0.
 * Fail the native job instead of publishing a video with missing effects.
 */
export function vulkanDiagnosticGuard() {
  let tail = '';
  let errors = ''; let line = '';
  return (chunk: string) => {
    const lines = (line + chunk).split(/\r?\n/); line = (lines.pop() ?? '').slice(-2000);
    for(const entry of lines) if(/\berror\b|compilation failed|glslang failed/i.test(entry)) errors = (errors + entry + '\n').slice(-4000);
    tail = (tail + chunk).slice(-8000);
    if(/Failed (?:executing hook|dispatching (?:hook|shader|COMPUTE)|compiling|parsing custom shader)|Shader appears to contain no headers|User hook tried resizing non-resizable stage/i.test(tail)) {
      throw new Error(`Vulkan shader failed; export stopped to preserve the requested effects.\n${errors}${tail.slice(-1600)}`);
    }
  };
}
