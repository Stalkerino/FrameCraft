import {register} from 'tsx/esm/api';
register();
await import('../server/workers/analysis-worker.ts');
