import {describe,expect,it} from 'vitest';
import {parseColorCube} from '../server/services/cube-parser';
import {applyColorGradeStages,colorGradeStages} from '../shared/color-grading';
import {sampleColorLut} from '../shared/color-lut';
import {colorGradeProgram,nativeColorTextures} from '../shared/color-grade-shader';
import {analyzeColorPixels} from '../shared/color-scopes';
import {applyCommand,clipSchema,validateProject} from '../shared/project';
import {createDemo} from '../shared/demo';
import {projectForSequence} from '../shared/project-sequences';
import {nativeScenePlan} from '../shared/native-scene-plan';
import {exportSettingsSchema} from '../shared/media-settings';
import {vulkanSceneGraph} from '../server/services/rendering/vulkan-scene-commands';
import {validateNativeGpuSource} from '../server/services/rendering/native-gpu-source';

const cube=(swap=false)=>'TITLE "Test LUT"\nLUT_3D_SIZE 2\n'+[0,1].flatMap(b=>[0,1].flatMap(g=>[0,1].map(r=>`${swap?b:r} ${g} ${swap?r:b}`))).join('\n');
describe('advanced SDR color',()=>{
  it('parses standard cube ordering, preserves float precision and interpolates domains',()=>{
    const lut=parseColorCube(cube(true),'test.cube');sampleColorLut(lut,[.2,.3,.8]).forEach((value,i)=>expect(value).toBeCloseTo([.8,.3,.2][i],6));
    const domain=parseColorCube(cube().replace('LUT_3D_SIZE 2','LUT_3D_SIZE 2\nDOMAIN_MIN -1 -1 -1\nDOMAIN_MAX 1 1 1'),'domain.cube');expect(sampleColorLut(domain,[0,0,0])).toEqual([.5,.5,.5]);
    expect(parseColorCube(cube(true),'other.cube').id).toBe(lut.id);
    expect(()=>parseColorCube(cube()+'\n0 0 0','extra.cube')).toThrow('exactly');
    expect(()=>parseColorCube('LUT_1D_SIZE 2\n0 0 0\n1 1 1','shaper.cube')).toThrow('shaper');
  });
  it('applies linear correction then creative LUT strength in the same shared shader contract',()=>{
    const lut=parseColorCube(cube(true),'swap.cube');const stages=colorGradeStages({space:'linear-srgb',exposure:1,lut:{id:lut.id,strength:.5}},null,[lut]);
    const corrected=applyColorGradeStages([.2,.3,.8],colorGradeStages({space:'linear-srgb',exposure:1},null));const result=applyColorGradeStages([.2,.3,.8],stages);
    expect(result[0]).toBeCloseTo((corrected[0]+corrected[2])/2,6);expect(result[0]).toBeCloseTo(result[2],6);
    const shader=colorGradeProgram(stages);expect(shader.operations.join('')).toContain('fc_linear');expect(shader.operations.join('')).toContain('fc_lut0_apply');
    expect(nativeColorTextures(stages)[0]).toContain('//!SIZE 4 2');expect(nativeColorTextures(stages)[0]).toContain('//!FORMAT rgba32f');
  });
  it('retains LUTs across sequence projections and rejects dangling references',()=>{
    const lut=parseColorCube(cube(),'identity.cube');let project=createDemo();project.clips=[];
    project=applyCommand(project,{type:'color-lut.add',lut});project=applyCommand(project,{type:'project.color-grade',grade:{exposure:0,contrast:1,gamma:1,saturation:1,temperature:0,tint:0,hue:0,lut:{id:lut.id,strength:1}}});
    project=applyCommand(project,{type:'sequence.create',id:'copy',name:'Copy',sourceId:'main'});expect(projectForSequence(project).colorLuts).toEqual([lut]);
    expect(()=>validateProject({...project,colorLuts:[]})).toThrow('missing');
  });
  it('places LUT textures in native nested group shaders without a pixel download',()=>{
    const lut=parseColorCube(cube(),'identity.cube');let project={...createDemo(),clips:[clipSchema.parse({id:'title',kind:'text',track:'text',name:'Title',text:'Hi',duration:30,start:0,animation:'none'})],colorLuts:[lut]};
    project=applyCommand(project,{type:'sequence.create',id:'parent',name:'Parent'}) as typeof project;
    project=applyCommand(project,{type:'sequence.insert',id:'nested',sequenceId:'main',start:0,sourceStart:0}) as typeof project;
    project=applyCommand(project,{type:'clip.update',id:'nested',patch:{colorGrade:{exposure:0,contrast:1,gamma:1,saturation:1,temperature:0,tint:0,hue:0,lut:{id:lut.id,strength:1}}}}) as typeof project;
    const settings=exportSettingsSchema.parse({width:320,height:180,fps:30,encoder:'amd',renderer:'native-vulkan'});const plan=nativeScenePlan(project,settings);expect(plan.blockers).toEqual([]);expect(plan.spans[0].layers[0].gradeStages[0].lut?.id).toBe(lut.id);
    // Empty child spans don't need font preparation to compile the group pipeline.
    const group=plan.spans[0].layers[0];group.scene!.span.layers=[];const graph=vulkanSceneGraph(plan.spans[0],settings,plan.background);expect(graph).not.toContain('hwdownload');
    expect(graph).toContain(Buffer.from('//!TEXTURE fc_lut0').toString('hex'));
  });
  it('measures actual sample statistics with labeled display ranges',()=>{
    const data=analyzeColorPixels(new Uint8Array([0,0,0,255,255,255,255,255,255,0,0,255]),3,1);
    expect(data.samples).toBe(3);expect(data.meanLuma).toBeCloseTo((1+.2126)/3*100);expect(data.nearWhitePercent).toBeCloseTo(100/3);expect(data.nearBlackPercent).toBeCloseTo(100/3);
    expect(data.waveform.reduce((a,b)=>a+b,0)).toBe(3);expect(data.vectorscope.reduce((a,b)=>a+b,0)).toBe(3);
  });
  it('accepts explicit wide-gamut 10-bit SDR only on the managed Vulkan path and rejects HDR/untagged sources',()=>{
    const asset={id:'v',name:'Source',src:'/source',kind:'video' as const,width:320,height:180,duration:1};const video={codec_type:'video',codec_name:'hevc',width:320,height:180,pix_fmt:'yuv420p10le',color_space:'bt2020nc',color_transfer:'bt2020-10',color_primaries:'bt2020',color_range:'pc',duration:'1'};
    expect(validateNativeGpuSource({streams:[video]},asset,true).duration).toBe(1);expect(()=>validateNativeGpuSource({streams:[video]},asset)).toThrow('8-bit');
    expect(()=>validateNativeGpuSource({streams:[{...video,color_transfer:'smpte2084'}]},asset,true)).toThrow('HDR');
    expect(()=>validateNativeGpuSource({streams:[{...video,color_transfer:undefined}]},asset,true)).toThrow('tag');
  });
});
