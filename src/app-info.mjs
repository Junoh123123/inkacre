// Display and command names are separate from the legacy storage and protocol identifiers.
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const APP = { id: 'pageyard', name: 'Inkacre', command: 'inkacre', defaultPort: 4141 };
const dataFolderName = 'Pageyard';

// Where a new install keeps its data when no folder is given: the platform's per-user application data folder.
export function defaultDataDirectory(platform = process.platform, env = process.env, home = os.homedir()) {
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', dataFolderName);
  if (platform === 'win32') return path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), dataFolderName);
  return path.join(env.XDG_DATA_HOME || path.join(home, '.local', 'share'), APP.id);
}

// A short id for a data folder (its real path, hashed): /api/health reports it so the downloadable app's launcher
// can tell its own running copy from another workspace on the same port.
export function instanceId(directory) {
  let where = path.resolve(directory);
  try { where = realpathSync(where); } catch { /* not made yet */ }
  return createHash('sha256').update(where).digest('hex').slice(0, 16);
}
