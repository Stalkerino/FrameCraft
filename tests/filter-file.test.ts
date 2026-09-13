import {expect, it, vi} from 'vitest';
vi.mock('../server/services/process-service', () => ({ffmpegPath: () => 'ffmpeg', runProcess: vi.fn()}));
import {runProcess} from '../server/services/process-service';
import {filterFileArguments} from '../server/services/filter-file-service';

it('uses the file-graph syntax supported by each executable and shares capability lookups', async () => {
  const run = vi.mocked(runProcess);
  run.mockResolvedValueOnce('-filter_complex_script filename  read a complex filtergraph');
  expect(await filterFileArguments('a path/graph.txt', 'older-ffmpeg')).toEqual(['-filter_complex_script', 'a path/graph.txt']);
  expect(await filterFileArguments('another.txt', 'older-ffmpeg')).toEqual(['-filter_complex_script', 'another.txt']);
  expect(run).toHaveBeenCalledTimes(1);
  run.mockResolvedValueOnce('-filter_complex filtergraph');
  expect(await filterFileArguments('C:\\Project Folder\\graph.txt', 'ffmpeg-8')).toEqual(['-/filter_complex', 'C:\\Project Folder\\graph.txt']);
  run.mockRejectedValueOnce(new Error('Executable temporarily unavailable'));
  await expect(filterFileArguments('graph.txt', 'retry-ffmpeg')).rejects.toThrow('temporarily unavailable');
  run.mockResolvedValueOnce('-filter_complex_script filename');
  expect(await filterFileArguments('graph.txt', 'retry-ffmpeg')).toEqual(['-filter_complex_script', 'graph.txt']);
});
