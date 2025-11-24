import { rm } from 'node:fs/promises';
import path from 'node:path';

const releaseDir = path.join(process.cwd(), 'release');

try {
  await rm(releaseDir, { recursive: true, force: true });
  console.log('[solstice-desktop] Cleared desktop/release');
} catch (error) {
  console.warn(
    `[solstice-desktop] Warning: unable to clear ${releaseDir}. Close any running installers and retry if packaging fails.`,
  );
}

