import { parseArgs } from 'node:util';
import { Workspace } from './workspace.mjs';
const { values } = parseArgs({ options: { from: { type: 'string' }, to: { type: 'string' } } });
if (!values.from || !values.to) throw new Error('사용법: ./app-local restore --from 백업폴더 --to 새폴더');
console.log(JSON.stringify(Workspace.restoreBackup(values.from, values.to)));
