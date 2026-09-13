import {useEffect,useRef} from 'react';
import type {ColorScopes} from '../../../shared/color-scopes';
export function ColorScopePlot({data,mode}:{data:ColorScopes;mode:'waveform'|'parade'|'vectorscope'|'histogram'}){
  const canvas=useRef<HTMLCanvasElement>(null);
  useEffect(()=>{const element=canvas.current!;const context=element.getContext('2d')!;const width=mode==='parade'?384:256;const height=160;element.width=width;element.height=height;context.fillStyle='#0a0f13';context.fillRect(0,0,width,height);
    context.strokeStyle='#26323b';context.lineWidth=1;for(let y=0;y<=4;y++){context.beginPath();context.moveTo(0,y*height/4+.5);context.lineTo(width,y*height/4+.5);context.stroke();}
    const colors=['#ff7676','#71dfa4','#72a8ff','#d2e5e7'];
    if(mode==='histogram'){const peak=Math.max(1,...data.histogram.flat());data.histogram.forEach((bins,c)=>{context.strokeStyle=colors[c];context.beginPath();bins.forEach((count,x)=>{const y=height-3-Math.log1p(count)/Math.log1p(peak)*(height-6);if(x)context.lineTo(x,y);else context.moveTo(x,y);});context.stroke();});return;}
    const plots=mode==='parade'?data.parade:[mode==='vectorscope'?data.vectorscope:data.waveform];
    plots.forEach((grid,c)=>{const peak=Math.max(1,...grid);context.fillStyle=mode==='parade'?colors[c]:mode==='vectorscope'?'#eebf77':'#a5efd3';for(let y=0;y<128;y++)for(let x=0;x<128;x++){const count=grid[y*128+x];if(!count)continue;context.globalAlpha=.2+.8*Math.log1p(count)/Math.log1p(peak);context.fillRect((x+c*128)*width/(plots.length*128),y*height/128,Math.ceil(width/(plots.length*128)),Math.ceil(height/128));}});context.globalAlpha=1;
    if(mode==='vectorscope'){context.strokeStyle='#67747c';context.beginPath();context.moveTo(width/2,0);context.lineTo(width/2,height);context.moveTo(0,height/2);context.lineTo(width,height/2);context.ellipse(width/2,height/2,width*.4,height*.4,0,0,Math.PI*2);context.stroke();}
  },[data,mode]);
  return <figure className="color-scope-plot"><figcaption>{mode==='parade'?'RGB parade':mode==='histogram'?'RGB + luma histogram':mode==='vectorscope'?'Vectorscope · Cb/Cr':'Luma waveform'}</figcaption><canvas ref={canvas} role="img" aria-label={`${mode} of captured composition`}/><span>{mode==='vectorscope'?'Center = neutral · horizontal Cb / vertical Cr':mode==='histogram'?'0 → 255 · logarithmic count':'Top 100% · bottom 0% · horizontal image position'}</span></figure>;
}
