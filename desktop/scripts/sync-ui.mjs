import { cp, rm, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(process.cwd(), '..');
const source = path.join(root, 'web', 'dist');
const target = path.join(process.cwd(), 'resources', 'ui');

async function ensureSource() {
  try {
    await access(source);
  } catch (error) {
    console.error(
      '[solstice-desktop] web/dist not found. Run "npm --workspace web run build" first.',
    );
    process.exit(1);
  }
}

async function copyUiBundle() {
  await ensureSource();
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
  await cp(source, target, { recursive: true });
  console.log('[solstice-desktop] Synced web/dist -> desktop/resources/ui');
}

copyUiBundle().catch((error) => {
  console.error(error);
  process.exit(1);
});

