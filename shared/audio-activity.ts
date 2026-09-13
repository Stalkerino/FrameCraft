import type {AudioActivity,AudioCue,AutoAudioSettings} from './auto-audio';

/** Stream 20ms stereo energy bins. No raw recording is retained. Stereo
 * energy avoids phase cancellation when left/right are opposite polarity. */
export class AudioActivityDetector {
  readonly activity:AudioActivity[]=[];readonly cues:AudioCue[]=[];
  private count=0;private square=0;private peak=0;private samples=0;
  private open:number|undefined;private lastActive=0;private activeBins=0;private runPeak=-120;
  private baseline=-120;private previous=-120;private lastCue=-Infinity;
  constructor(private settings:AutoAudioSettings,private fps:number,readonly rate=8000) {}
  push(value:number) {
    const sample=Number.isFinite(value)?value:0;this.square+=sample*sample;this.peak=Math.max(this.peak,Math.abs(sample));this.count++;this.samples++;
    if(this.count===this.rate*2*.02)this.flush();
  }
  get seconds(){return this.samples/(this.rate*2);}
  private flush() {
    if(!this.count)return;
    const end=this.seconds,start=end-this.count/(this.rate*2);const rms=20*Math.log10(Math.max(1e-6,Math.sqrt(this.square/this.count))),peak=20*Math.log10(Math.max(1e-6,this.peak));
    if(rms>=this.settings.thresholdDb){this.open??=start;this.lastActive=end;this.activeBins++;this.runPeak=Math.max(this.runPeak,peak);}
    else if(this.open!==undefined&&end-this.lastActive>=this.settings.holdMs/1000)this.close();
    if(peak>=this.settings.transientMinDb&&rms-this.baseline>=this.settings.transientRiseDb&&rms-this.previous>=this.settings.transientRiseDb/2&&start-this.lastCue>=this.settings.minSpacingMs/1000) {
      this.cues.push({id:`attack-${this.cues.length}`,frame:Math.max(0,Math.round(start*this.fps)),kind:'transient',peakDb:peak,reason:`Measured audio attack (${peak.toFixed(1)} dBFS peak)`});this.lastCue=start;
    }
    this.baseline=this.baseline===-120?rms:this.baseline*.9+rms*.1;this.previous=rms;this.count=0;this.square=0;this.peak=0;
  }
  private close() {
    if(this.open!==undefined&&this.activeBins*.02+1e-8>=this.settings.minActiveMs/1000) {
      const start=Math.max(0,Math.floor(this.open*this.fps+1e-7)),end=Math.ceil(this.lastActive*this.fps-1e-7);
      if(end>start)this.activity.push({id:`activity-${this.activity.length}`,start,end,peakDb:this.runPeak});
    }
    this.open=undefined;this.activeBins=0;this.runPeak=-120;
  }
  finish(){this.flush();this.close();return {activity:this.activity,cues:this.cues};}
}
