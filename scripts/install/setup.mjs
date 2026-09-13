// Compatibility entry point: normal installation always builds the desktop app.
import {buildDesktop} from '../build-desktop.mjs';
import {mainModule} from './runtime.mjs';
export const setup = ({start = true} = {}) => buildDesktop({launch: start});
if(mainModule(import.meta.url)) setup({start: !process.argv.includes('--no-launch')}).catch(error => {console.error(error.message); process.exitCode = 1;});
