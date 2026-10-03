/**
 * Trusted folders (NSM 2.5, control the data flow): code only runs from files
 * the user wrote or chose to trust. Running a file or code block from anywhere
 * else (the web, e-mail, a classmate) asks first, once per folder – like the
 * workspace trust in VS Code. Unsaved documents and the autosave folder are
 * the user's own. In the browser, code runs sandboxed and isn't asked about.
 */
import { platform } from '../platform';
import { getSettings, updateSettings } from '../settings';
import { storage } from '../storage';
import { folderOf, isInFolders, withFolder } from './trustRules';

/** Whether code from the file `path` may run; asks if its folder isn't trusted. */
export async function allowRunning(path: string | undefined): Promise<boolean> {
  if (!path || !platform.isDesktop) return true;
  const own = getSettings().autosave.folder || (await storage.defaultFolder?.());
  const trusted = getSettings().security.trustedFolders;
  if (isInFolders(path, own ? [...trusted, own] : trusted)) return true;

  const folder = folderOf(path);
  const ok = await platform.confirm(
    `Du har ikke kjørt kode fra denne mappa før:\n${folder}\n\n` +
      'Et program kan gjøre alt du selv kan på maskinen: lese, endre og slette filer. ' +
      'Kjør bare kode du vet hvor kommer fra.\n\nStole på mappa og kjøre koden?',
  );
  if (ok) updateSettings({ security: { trustedFolders: withFolder(getSettings().security.trustedFolders, folder) } });
  return ok;
}
