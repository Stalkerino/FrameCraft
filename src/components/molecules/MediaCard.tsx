import {MediaFolderSelect} from './MediaFolderSelect';
import {moveMediaToFolder} from '../../services/organization-actions';
import {Film, Image, Music2, Play, Plus} from 'lucide-react';
import type {Asset} from '../../../shared/project';
import {formatTime} from '../../../shared/project';
import {useEditor} from '../../stores/editor-store';
import {openInspectorPanel} from '../../services/workspace-navigation';
import {MediaPreviewStatus} from './MediaPreviewStatus';
export function MediaCard({asset, uses = 0, onPreview}: {asset: Asset; uses?: number; onPreview: () => void}) {
  const folders = useEditor(s => s.snapshot?.project.folders);
  const addAsset = useEditor(s => s.addAsset);
  const busy = useEditor(s => s.busy);
  const metadata = [asset.kind === 'audio' ? 'Audio' : asset.width && asset.height ? `${asset.width} × ${asset.height}` : asset.kind === 'image' ? 'Image' : 'Video', asset.videoCodec?.toUpperCase()].filter(Boolean).join(' · ');
  return <div className="media-item"><button className="media-card" aria-label={`Preview ${asset.name}`} draggable onDragStart={e => {e.dataTransfer.setData('application/framecraft-asset', asset.id); e.dataTransfer.effectAllowed = 'copy';}} onClick={onPreview} title={`Preview ${asset.name}. Drag to place on the timeline.`}>
    <div className={`media-card__image ${asset.kind === 'audio' ? 'media-card__image--audio' : ''}`}>
      {asset.thumbnail ? <img src={asset.thumbnail} alt="" loading="lazy"/> : asset.kind === 'audio' ? <Music2 size={28}/> : asset.kind === 'image' ? <Image size={28}/> : <Film size={28}/>}
      <span className="media-card__kind">{asset.kind === 'video' ? <Film size={12}/> : asset.kind === 'audio' ? <Music2 size={12}/> : <Image size={12}/>}</span>
      {asset.kind !== 'image' && <span className="media-card__duration">{formatTime(Math.floor(asset.duration), 1)}</span>}
      <span className="media-card__preview"><Play size={18}/></span>
    </div>
    <span className="media-card__name">{asset.name}</span>
    <span className="media-card__meta">{asset.demo ? 'Demo artwork' : metadata}</span>
  </button><div className="media-item__actions"><span title={uses ? `Used by ${uses} timeline ${uses === 1 ? 'clip' : 'clips'}` : 'Not placed on the timeline'}>{uses ? `Used ${uses}×` : 'Not used'}</span><button aria-label={`Add ${asset.name} to timeline`} title="Append to the selected compatible track" disabled={busy} onClick={() => {addAsset(asset); openInspectorPanel('properties');}}><Plus size={13}/><span>Add</span></button></div><MediaPreviewStatus asset={asset} background/>{!!folders?.length && <div className="media-item__folder"><MediaFolderSelect folders={folders} value={asset.folderId || ''} disabled={busy} label={`Folder for ${asset.name}`} onChange={id => void moveMediaToFolder([asset.id], id || null)}/></div>}</div>;
}
