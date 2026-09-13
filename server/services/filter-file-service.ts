import {ffmpegPath, runProcess} from './process-service';

export type FilterFileOption = '-filter_complex_script' | '-/filter_complex';
const options = new Map<string, Promise<FilterFileOption>>();

/** Older FFmpeg uses a dedicated switch; FFmpeg 8 uses file-valued options.
 * Cache capability discovery per executable. This does not initialize hardware. */
export function filterFileOption(binary = ffmpegPath()): Promise<FilterFileOption> {
  let option = options.get(binary);
  if(!option) {
    option = runProcess(binary, ['-hide_banner', '-h', 'full'], 30_000)
      .then(help => help.includes('-filter_complex_script') ? '-filter_complex_script' : '-/filter_complex');
    options.set(binary, option);
    void option.catch(() => {if(options.get(binary) === option) options.delete(binary);});
  }
  return option;
}
export async function filterFileArguments(file: string, binary = ffmpegPath()) {
  return [await filterFileOption(binary), file];
}
