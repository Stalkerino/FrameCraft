export interface AudioLevels {left: number; right: number}
let context: AudioContext | undefined;
let bus: GainNode | undefined;
const sources = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();
const routed = new Map<HTMLMediaElement, MediaElementAudioSourceNode>();
let cleanupObserver: MutationObserver | undefined;

/** Enabled by a user gesture. Only audio samples cross this boundary. Keep
 * source nodes reusable: browsers allow one source node per media element. */
export async function monitorAudio(root: HTMLElement, report: (levels: AudioLevels) => void) {
  context ??= new AudioContext();
  await context.resume();
  if(context.state !== 'running') throw new Error('Allow audio playback in your browser to enable meters.');
  if(!bus) {bus = context.createGain(); bus.channelCount = 2; bus.channelCountMode = 'explicit'; bus.connect(context.destination);}
  if(!cleanupObserver) {
    cleanupObserver = new MutationObserver(() => {
      for(const [element, source] of routed) if(!element.isConnected) {source.disconnect(); routed.delete(element);}
    });
    cleanupObserver.observe(document.documentElement, {childList: true, subtree: true});
  }
  const split = context.createChannelSplitter(2); bus.connect(split);
  const analysers = [context.createAnalyser(), context.createAnalyser()];
  const silent = context.createGain(); silent.gain.value = 0; silent.connect(context.destination);
  analysers.forEach((analyser, index) => {analyser.fftSize = 2048; split.connect(analyser, index); analyser.connect(silent);});
  const attached = new Map<HTMLMediaElement, MediaElementAudioSourceNode>();
  const refresh = () => {
    for(const element of root.querySelectorAll<HTMLMediaElement>('video,audio')) {
      if(attached.has(element)) continue;
      let source = sources.get(element);
      if(!source) {source = context!.createMediaElementSource(element); sources.set(element, source);}
      source.disconnect(); source.connect(bus!); attached.set(element, source); routed.set(element, source);
    }
    for(const [element, source] of attached) if(!root.contains(element)) {source.disconnect(); attached.delete(element); routed.delete(element);}
  };
  refresh(); const observer = new MutationObserver(refresh); observer.observe(root, {childList: true, subtree: true});
  const samples = new Float32Array(2048);
  const measure = (analyser: AnalyserNode) => {
    analyser.getFloatTimeDomainData(samples); let peak = 0;
    for(const value of samples) peak = Math.max(peak, Math.abs(value));
    return Math.max(-60, 20 * Math.log10(Math.max(peak, 1e-8)));
  };
  const timer = setInterval(() => report({left: measure(analysers[0]), right: measure(analysers[1])}), 50);
  return () => {
    clearInterval(timer); observer.disconnect(); bus!.disconnect(split); split.disconnect(); analysers.forEach(node => node.disconnect()); silent.disconnect();
    // Connected media keeps its normal audible path when metering is disabled.
  };
}
