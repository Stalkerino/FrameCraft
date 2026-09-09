import {createRequire} from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
// The ESM export is a separate bundle with private copies of these functions.
// Rendering and the encoder adapter must share the CommonJS module graph for
// routing to affect the real encode process (including pre-stitcher piping).
export const remotionRenderer = require('@remotion/renderer') as typeof import('@remotion/renderer');

/**
 * Remotion 4.0.522 has one binariesDirectory for encoding AND audio processing.
 * Its audio commands use filter_script:a, removed in newer system FFmpeg builds.
 * Isolate the external encoder here, inside the single-job render worker only.
 * Everything else (audio, probing, muxing) keeps Remotion's matching binaries.
 */
export function routeHardwareEncoder(directory: string | undefined, encoderName: string) {
  if(!directory) return;
  type Options = {args: (string | number | null | undefined)[]; binariesDirectory: string | null};
  type Call = (options: Options) => unknown;
  // This adapter is deliberately tied to the exact Remotion version in package.json.
  const calls = require(path.join(path.dirname(require.resolve('@remotion/renderer')), 'call-ffmpeg.js')) as {callFf: Call; callFfNative: Call};
  for(const method of ['callFf', 'callFfNative'] as const) {
    const original = calls[method];
    calls[method] = options => {
      const index = options.args.indexOf('-c:v');
      const encoding = index >= 0 && options.args[index + 1] === encoderName;
      return original({...options, binariesDirectory: encoding ? directory : null});
    };
  }
}
