import type {VisualReport} from '../../shared/visual-rush';
import {useAgent} from '../stores/agent-store';
import {useEditor} from '../stores/editor-store';
import {projectTracks} from '../../shared/tracks';
export type GameplayResult = 'review' | 'apply';
function gameplayPrompt(projectId: string, assetId: string, goal: string, seconds: number, report?: VisualReport) {
  return `Create a visually informed cut of my gameplay video, with no narration. Project ${projectId}; asset ${assetId}. Goal: ${goal.trim() || 'Keep the clearest interesting gameplay, preserve setup and payoff, and remove visually confirmed waiting or repetition.'} Target about ${seconds} seconds. Analyze the full source recording. Read get_project first and stop if its active project ID differs. ${report ? `Use visual report ${report.id}.` : 'Use analyze_video and poll get_analysis for the visual report.'} Inspect the overview pages with inspect_video, then inspect promising or ambiguous source ranges more closely, including cut boundaries. Do not treat low motion or dark frames alone as proof of unwanted footage. Save a proposal with save_video_cut, concrete reasons, confidence and inspected evidence timestamps.`;
}
export function reviewGameplayInCodex(assetId: string, goal: string, seconds: number, report?: VisualReport) {
  const project = useEditor.getState().snapshot?.project; if(!project) return;
  const prompt = `${gameplayPrompt(project.id, assetId, goal, seconds, report)} Show it in Assist → Gameplay for me to review before applying.`;
  const draft = useAgent.getState().draft.trim(); useAgent.setState({draft: draft ? `${draft}\n\n${prompt}` : prompt}); useEditor.setState({inspectorTab: 'codex'});
}
export async function generateGameplayInCodex(assetId: string, goal: string, seconds: number, mode: GameplayResult, trackId: string, report?: VisualReport) {
  const project = useEditor.getState().snapshot?.project;
  if(!project?.assets.some(a => a.id === assetId && a.kind === 'video')) throw new Error('Choose a gameplay video first.');
  if(!Number.isFinite(seconds) || seconds < 5) throw new Error('Choose a target length of at least 5 seconds.');
  const track = projectTracks(project).find(t => t.id === trackId && t.type === 'visual');
  if(mode === 'apply' && !track) throw new Error('Choose a destination video track.');
  const result = mode === 'apply'
    ? `The user selected Generate and apply cuts. After saving the proposal, apply it with apply_video_cut using mode="replace-track" and trackId=${JSON.stringify(trackId)}, replacing the clips on ${JSON.stringify(track!.name)} in one undoable edit. This is authorization to apply the cut; do not stop after only scanning or saving a proposal. Other tracks retain their current timing. Keep original media intact. Starting project revision is ${project.revision}; if the user edits the target track while you work, present the proposal for review instead of overwriting those edits. Read the current revision before applying, inspect a rendered frame of the resulting cut, and report actual tool results and any uncertainty.`
    : 'Show the saved proposal in Assist → Gameplay for review. Do not change the timeline until I click Apply gameplay cut or explicitly ask you to apply it.';
  const prompt = `${gameplayPrompt(project.id, assetId, goal, seconds, report)} ${result}`;
  useEditor.setState({inspectorTab: 'codex'});
  return useAgent.getState().sendPrompt(prompt, () => {
    const current = useEditor.getState().snapshot?.project;
    if(current?.id !== project.id || current.revision !== project.revision) throw new Error('The project changed while Codex was starting. Review the source and start the cut again.');
  });
}
