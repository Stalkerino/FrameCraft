import {Clapperboard, Focus, MessageSquareText, Search, Gamepad2} from 'lucide-react';
import {useAnalysis} from '../../stores/analysis-store';
import {TranscriptPanel} from './TranscriptPanel';
import {FootageSearch} from './FootageSearch';
import {RoughCutPanel} from './RoughCutPanel';
import {OverlayPanel} from './OverlayPanel';
import {GameplayPanel} from './GameplayPanel';
export function AssistWorkspace() {
  const tab = useAnalysis(s => s.tab);
  const tabs = [{id: 'gameplay', label: 'Gameplay cuts', icon: Gamepad2}, {id: 'speech', label: 'Transcript & captions', icon: MessageSquareText}, {id: 'search', label: 'Search footage', icon: Search}, {id: 'cut', label: 'Rough cut', icon: Clapperboard}, {id: 'overlays', label: 'Zooms & callouts', icon: Focus}] as const;
  return <section className="assist-workspace"><div className="panel-heading"><h2>Editing tools</h2></div><p className="panel-description">Analyze footage, assemble cuts and add overlays.</p><nav className="assist-tabs" aria-label="Assist tools">{tabs.map(({id, label, icon: Icon}) => <button key={id} aria-pressed={tab === id} aria-controls="assist-tool-panel" onClick={() => useAnalysis.setState({tab: id})}><Icon size={15}/>{label}</button>)}</nav><section id="assist-tool-panel" aria-label={tabs.find(item => item.id === tab)?.label}>{tab === 'gameplay' ? <GameplayPanel/> : tab === 'speech' ? <TranscriptPanel/> : tab === 'search' ? <FootageSearch/> : tab === 'cut' ? <RoughCutPanel/> : <OverlayPanel/>}</section></section>;
}
