interface RecognitionResult {isFinal: boolean; 0: {transcript: string}}
interface Recognition {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((event: {results: ArrayLike<RecognitionResult>}) => void) | null;
  onerror: ((event: {error: string}) => void) | null;
  onend: (() => void) | null;
  start(): void; stop(): void; abort(): void;
}
type SpeechWindow = Window & {SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition};
const constructor = () => (window as SpeechWindow).SpeechRecognition || (window as SpeechWindow).webkitSpeechRecognition;
export const speechAvailable = () => Boolean(constructor());
const errors: Record<string, string> = {
  'not-allowed': 'Microphone access was denied. Allow it in your browser’s site settings and try again.',
  'service-not-allowed': 'Your browser’s speech service is unavailable. Try Chrome or Edge, or type your request.',
  'audio-capture': 'No microphone was found. Connect a microphone and try again.',
  network: 'The browser’s speech service could not connect. Check your connection or type your request.',
  'no-speech': 'No speech was detected. Try speaking closer to your microphone.',
  'language-not-supported': 'This speech service does not support the selected language.',
};

export function createDictation(language: string, callbacks: {transcript: (text: string) => void; error: (text: string) => void; end: () => void}) {
  const Constructor = constructor();
  if(!Constructor) throw new Error('Voice dictation is unavailable in this browser. Try Chrome or Edge, or type your request.');
  const recognition = new Constructor();
  recognition.lang = language; recognition.continuous = true; recognition.interimResults = true;
  recognition.onresult = event => callbacks.transcript(Array.from(event.results).map(result => result[0].transcript).join(' '));
  recognition.onerror = event => {if(event.error !== 'aborted') callbacks.error(errors[event.error] || `Dictation stopped (${event.error}). You can still type your request.`);};
  recognition.onend = callbacks.end;
  return {
    start: () => recognition.start(), stop: () => recognition.stop(),
    dispose: () => {recognition.onresult = null; recognition.onerror = null; recognition.onend = null; recognition.abort();},
  };
}
