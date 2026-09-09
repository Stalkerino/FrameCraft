import {useEffect} from 'react';
import {connectEditor, useEditor} from '../stores/editor-store';
import {connectAgent} from '../stores/agent-store';
import {connectAnalysis} from '../stores/analysis-store';
import {connectPresets} from '../stores/preset-store';
import {connectMedia} from '../stores/media-store';
import {useEditorKeyboard} from '../hooks/useEditorKeyboard';
import {EditorLayout} from '../components/templates/EditorLayout';
import {Header} from '../components/organisms/Header';
import {MediaLibrary} from '../components/organisms/MediaLibrary';
import {Preview} from '../components/organisms/Preview';
import {Inspector} from '../components/organisms/Inspector';
import {Timeline} from '../components/organisms/Timeline';
import {Notifications} from '../components/organisms/Notifications';
export function EditorPage() {
  const projectId = useEditor(s => s.snapshot?.project.id);
  useEffect(connectEditor, []); useEffect(connectAgent, []); useEffect(connectAnalysis, []); useEffect(connectPresets, []); useEffect(connectMedia, []); useEditorKeyboard();
  return <EditorLayout header={<Header/>} library={<MediaLibrary key={`library-${projectId}`}/>} preview={<Preview key={`preview-${projectId}`}/>} inspector={<Inspector/>} timeline={<Timeline key={`timeline-${projectId}`}/>} overlays={<Notifications/>}/>;
}
