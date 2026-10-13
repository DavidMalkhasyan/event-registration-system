import { randomBytes } from 'node:crypto';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Media storage (K-712, PD-92): where the re-encoded image files live. The local adapter keeps them in
// a directory outside the repository (MEDIA_DIR, `var/media` by default, which Git ignores); an object
// storage adapter can implement the same interface later. Keys are random 32-hex names generated here,
// so no client input ever becomes a path.

export type Variant = 'full' | 'thumb';

export interface MediaStorage {
  /** Stores both variants of a new image; resolves when both are durable under their final names. */
  put(key: string, files: Record<Variant, Buffer>): Promise<void>;
  /** Removes both variants; missing files are fine (removal is idempotent). */
  remove(key: string): Promise<void>;
  /** The local file of a variant, for serving, or null when it does not exist. */
  locate(key: string, variant: Variant): Promise<string | null>;
}

const KEY = /^[0-9a-f]{32}$/;

export function newMediaKey(): string {
  return randomBytes(16).toString('hex');
}

function assertKey(key: string): void {
  if (!KEY.test(key)) throw new Error('invalid media key');
}

export class LocalMediaStorage implements MediaStorage {
  constructor(private readonly dir: string) {}

  private path(key: string, variant: Variant): string {
    assertKey(key);
    // Two levels of fan-out keep directories small.
    return join(this.dir, 'images', key.slice(0, 2), `${key}${variant === 'thumb' ? '-thumb' : ''}.webp`);
  }

  async put(key: string, files: Record<Variant, Buffer>): Promise<void> {
    const written: string[] = [];
    try {
      for (const variant of ['full', 'thumb'] as const) {
        const target = this.path(key, variant);
        await mkdir(join(target, '..'), { recursive: true });
        // Written under a temporary name and renamed, so a reader never sees half a file.
        const temp = `${target}.${randomBytes(6).toString('hex')}.tmp`;
        await writeFile(temp, files[variant], { flag: 'wx' });
        await rename(temp, target);
        written.push(target);
      }
    } catch (error) {
      await Promise.all(written.map((p) => rm(p, { force: true })));
      throw error;
    }
  }

  async remove(key: string): Promise<void> {
    await Promise.all((['full', 'thumb'] as const).map((v) => rm(this.path(key, v), { force: true })));
  }

  async locate(key: string, variant: Variant): Promise<string | null> {
    if (!KEY.test(key)) return null;
    const path = this.path(key, variant);
    try {
      return (await stat(path)).isFile() ? path : null;
    } catch {
      return null;
    }
  }
}
