import {expect,it} from 'vitest';
import {AudioActivityDetector} from '../shared/audio-activity';
import {autoAudioAnalyzeSchema,autoDuckCommands,timelineAudioCues,spaceAudioCues,type AutoAudioReport} from '../shared/auto-audio';
import {applyCommand,projectSchema} from '../shared/project';
import {audioEnvelopeGain} from '../shared/audio-envelope';
import {reframeProject} from '../shared/project-settings';
import {needsAudioMix,audioMixIdentity} from '../shared/audio-mixer';

const settings=autoAudioAnalyzeSchema.parse({revision:0,sourceTrackIds:['foreground'],thresholdDb:-30,minSpacingMs:300});
it('detects sound inside long clips, joins short pauses and retains stereo energy without phase cancellation',()=>{
  const detector=new AudioActivityDetector(settings,30);
  for(let n=0;n<8000*6;n++) {
    const t=n/8000;const active=(t>=1&&t<1.5)||(t>=1.6&&t<2)||(t>=4&&t<5)||(t>=5.5&&t<5.52);
    const v=active?.4*Math.sin(2*Math.PI*400*t):0;detector.push(v);detector.push(-v);
  }
  const {activity,cues}=detector.finish();expect(activity.map(({start,end})=>({start,end}))).toEqual([{start:30,end:60},{start:120,end:150}]);
  expect(cues.some(c=>c.frame===30)).toBe(true);expect(cues.some(c=>c.frame===120)).toBe(true);
  const silence=new AudioActivityDetector(settings,30);for(let n=0;n<16000;n++)silence.push(0);expect(silence.finish()).toEqual({activity:[],cues:[]});
});
const project=()=>projectSchema.parse({version:1,id:'p',name:'Audio',revision:0,width:320,height:180,fps:30,
  tracks:[{id:'audio',type:'audio',name:'Music'},{id:'foreground',type:'audio',name:'Foreground'},{id:'visual',type:'visual',name:'Video'}],
  assets:[{id:'a',name:'Music',kind:'audio',src:'/media/a.wav',duration:8}],
  clips:[{id:'music',kind:'audio',name:'Music',track:'audio',assetId:'a',start:0,duration:180,volume:.6,audioEnvelope:{duration:180,fadeIn:15,fadeOut:15,keyframes:[{frame:0,value:.8},{frame:180,value:.6}]}}]});
it('adds an independent editable ducking layer and preserves its timing through edits and FPS changes',()=>{
  let p=project();const report:AutoAudioReport={id:'00000000-0000-4000-8000-000000000000',projectId:p.id,sequenceId:'main',revision:0,fps:30,durationFrames:180,status:'ready',progress:1,settings,activity:[{id:'a',start:30,end:60,peakDb:-10}],cues:[]};
  const commands=autoDuckCommands(p,report,{targetClipIds:['music'],gain:.2,attackFrames:6,releaseFrames:12});const original=p.clips[0].audioEnvelope;
  p=applyCommand(p,commands[0]);expect(p.clips[0].audioEnvelope).toEqual(original);expect(audioEnvelopeGain(p.clips[0].audioDucking,40)).toBe(.2);expect(audioEnvelopeGain(p.clips[0].audioDucking,90)).toBe(1);expect(needsAudioMix(p)).toBe(true);
  expect(audioMixIdentity(p)).not.toBe(audioMixIdentity(project()));
  p=applyCommand(p,{type:'clip.split',id:'music',frame:40,newId:'tail'});expect(p.clips.find(c=>c.id==='tail')?.audioDucking?.offset).toBe(40);
  p=applyCommand(p,{type:'clip.update',id:'tail',patch:{sourceStart:45}});expect(p.clips.find(c=>c.id==='tail')?.audioDucking?.offset).toBe(45);
  const doubled=reframeProject(p,60);expect(doubled.clips.find(c=>c.id==='tail')?.audioDucking?.offset).toBe(90);
  p=applyCommand(p,{type:'timeline.edit-ranges',operation:'assemble',ranges:[{start:50,end:70}]});expect(p.clips[0].audioDucking?.offset).toBe(55);
  expect(()=>autoDuckCommands(project(),{...report,settings:{...settings,sourceTrackIds:['audio']}},{targetClipIds:['music'],gain:.2,attackFrames:6,releaseFrames:12})).toThrow('contributed');
  expect(()=>autoDuckCommands(project(),report,{targetClipIds:['music'],gain:.2,attackFrames:6,releaseFrames:12,activityIds:['missing']})).toThrow('missing');
});
it('maps nested cut/marker cues to the parent clock and prioritizes known edits over nearby transients',()=>{
  let p=project();p=applyCommand(p,{type:'marker.set',marker:{id:'mark',name:'Reveal',frame:60,color:'#ffffff',note:''}});
  p=applyCommand(p,{type:'sequence.create',id:'parent',name:'Parent',settings:{width:320,height:180,fps:60,backgroundColor:'#000000',masterVolume:1}});
  p=applyCommand(p,{type:'sequence.insert',id:'nested',sequenceId:'main',start:20,sourceStart:60,duration:180});
  const cues=timelineAudioCues(p,settings);expect(cues.find(c=>c.kind==='marker')?.frame).toBe(80);
  const spaced=spaceAudioCues([...cues,{id:'hit',kind:'transient',frame:82,reason:'Measured attack',peakDb:-1}],30,200);expect(spaced).toHaveLength(1);expect(spaced[0].kind).toBe('marker');
});
