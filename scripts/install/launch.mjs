// Keep old shortcuts working, but never open an external browser implicitly.
import {launchDesktop} from '../start-desktop.mjs';
import {mainModule} from './runtime.mjs';
export {framecraftAt} from './editor-presence.mjs';
export const launch = launchDesktop;
if(mainModule(import.meta.url)) launch().catch(error => {console.error(error.message); process.exitCode = 1;});
