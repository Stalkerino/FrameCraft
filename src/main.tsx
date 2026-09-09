import {StrictMode, Component, type ReactNode} from 'react';
import {createRoot} from 'react-dom/client';
import {EditorPage} from './pages/EditorPage';
import './styles/main.scss';
class ErrorBoundary extends Component<{children: ReactNode}, {error: Error | null}> {
  state: {error: Error | null} = {error: null};
  static getDerivedStateFromError(error: Error) {return {error};}
  render() {return this.state.error ? <div className="fatal-error"><h1>Framecraft couldn’t open this view.</h1><p>{this.state.error.message}</p><button onClick={() => location.reload()}>Reload editor</button></div> : this.props.children;}
}
createRoot(document.getElementById('root')!).render(<StrictMode><ErrorBoundary><EditorPage/></ErrorBoundary></StrictMode>);
