import {expect, it} from 'vitest';
import {OllamaToolExecution} from '../server/services/ollama-tool-execution';

it('allows successive defects to be corrected but bounds unchanged errors and repeated drift', () => {
  const guard = new OllamaToolExecution(new Map());
  expect(guard.failed('save_video_cut', 'missing start')).toBeNull();
  expect(guard.failed('save_video_cut', 'end before start')).toBeNull();
  expect(guard.failed('save_video_cut', 'uninspected evidence')).toBeNull();
  guard.succeeded('get_project');
  expect(guard.failed('save_video_cut', 'uninspected evidence')).toBeNull();
  expect(guard.failed('save_video_cut', 'uninspected evidence')).toContain('same error three times');
  guard.succeeded('save_video_cut'); expect(guard.unresolved()).toEqual([]);
  for(let i = 0; i < 7; i++) expect(guard.failed('save_video_cut', `new error ${i}`)).toBeNull();
  expect(guard.failed('save_video_cut', 'eighth different error')).toContain('eight');
});
