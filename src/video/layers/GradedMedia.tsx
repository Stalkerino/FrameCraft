import {useCallback, useLayoutEffect, useMemo, useRef, useState, type CSSProperties} from 'react';
import {continueRender, delayRender, Img} from 'remotion';
import type {ColorGradeStage} from '../../../shared/color-grading';
import {ColorWebglRenderer} from '../../services/color-webgl-service';
import {TimelineVideo} from './TimelineVideo';

export function GradedMedia({clipId, src, image, sourceStart, volume, muted, style, stages, onUnsupportedSource}: {clipId:string;src:string;image:boolean;sourceStart:number;volume:number|((frame:number)=>number);muted:boolean;style:CSSProperties;stages:ColorGradeStage[];onUnsupportedSource?:()=>void}) {
  const canvas=useRef<HTMLCanvasElement>(null);const renderer=useRef<ColorWebglRenderer|null>(null);const source=useRef<CanvasImageSource|null>(null);
  const [error,setError]=useState<Error|null>(null);const [handle]=useState(()=>delayRender('Preparing color-managed media'));
  const draw=useCallback((frame:CanvasImageSource)=>{source.current=frame;try{if(renderer.current){renderer.current.draw(frame);continueRender(handle);}}catch(error){setError(error as Error);continueRender(handle);}},[handle]);
  useLayoutEffect(()=>{
    try{renderer.current=new ColorWebglRenderer(canvas.current!,stages);if(source.current)draw(source.current);}catch(error){setError(error as Error);continueRender(handle);}
    return()=>{renderer.current?.dispose();renderer.current=null;continueRender(handle);};
  },[stages,draw,handle]);
  const hidden=useMemo(()=>({...style,position:'absolute' as const,inset:0,opacity:0,pointerEvents:'none' as const}),[style]);
  if(error)throw error;
  return <>{image?<Img crossOrigin="anonymous" src={src} style={hidden} onImageFrame={draw}/>:<TimelineVideo clipId={`${clipId}-color-source`} src={src} sourceStart={sourceStart} volume={volume} muted={muted} style={hidden} onVideoFrame={draw} onUnsupportedSource={onUnsupportedSource}/>}
    <canvas ref={canvas} data-preview-clip={clipId} data-color-grade="gpu" style={{...style,display:'block'}}/></>;
}
