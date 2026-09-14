import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Le fichier est versionné à la racine du repo (profil-curation-newsletters.md),
// copié dans l'image Docker au build (voir Dockerfile).
const PROFILE_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../profil-curation-newsletters.md'
);

let cached = null;

export async function loadProfile() {
  if (cached) return cached;
  cached = await readFile(PROFILE_PATH, 'utf-8');
  return cached;
}
