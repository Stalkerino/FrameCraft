import {Composition, registerRoot} from 'remotion';
import {createDemo} from '../../shared/demo';
import {durationOf} from '../../shared/project';
import {ProjectComposition, type CompositionProps} from './ProjectComposition';
const Root = () => <Composition id="Project" component={ProjectComposition} width={1920} height={1080} fps={30} durationInFrames={540} defaultProps={{project: createDemo(), mediaBase: ''} as CompositionProps} calculateMetadata={({props}) => ({durationInFrames: durationOf(props.project), width: props.output?.width ?? props.project.width, height: props.output?.height ?? props.project.height, fps: props.project.fps})}/>;
registerRoot(Root);
