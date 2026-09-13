export interface ColorScopes {width:number;height:number;samples:number;histogram:number[][];waveform:number[];parade:number[][];vectorscope:number[];meanLuma:number;nearBlackPercent:number;nearWhitePercent:number}
/** Statistics of a sampled, composited sRGB image; not sensor data or HDR nits. */
export function analyzeColorPixels(pixels:Uint8Array,width:number,height:number):ColorScopes {
  if(pixels.length!==width*height*4||width<1||height<1)throw new Error('Expected RGBA scope pixels.');
  const histogram=Array.from({length:4},()=>Array(256).fill(0) as number[]);const waveform=Array(128*128).fill(0) as number[];
  const parade=Array.from({length:3},()=>Array(128*128).fill(0) as number[]);const vectorscope=Array(128*128).fill(0) as number[];
  let mean=0;let black=0;let white=0;
  for(let i=0;i<width*height;i++){
    const r=pixels[i*4]/255,g=pixels[i*4+1]/255,b=pixels[i*4+2]/255;const luma=.2126*r+.7152*g+.0722*b;
    mean+=luma;if(luma<=1/255)black++;if(luma>=254/255)white++;
    const x=Math.min(127,Math.floor((i%width)/width*128));waveform[(127-Math.round(luma*127))*128+x]++;
    [r,g,b,luma].forEach((v,c)=>{histogram[c][Math.round(v*255)]++;if(c<3)parade[c][(127-Math.round(v*127))*128+x]++;});
    const vx=Math.max(0,Math.min(127,Math.round(((b-luma)/1.8556+.5)*127)));const vy=Math.max(0,Math.min(127,Math.round((.5-(r-luma)/1.5748)*127)));vectorscope[vy*128+vx]++;
  }
  const samples=width*height;return {width,height,samples,histogram,waveform,parade,vectorscope,meanLuma:mean/samples*100,nearBlackPercent:black/samples*100,nearWhitePercent:white/samples*100};
}
