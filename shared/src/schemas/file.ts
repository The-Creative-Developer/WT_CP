import { z } from 'zod';
import { LANGUAGE_IDS, LANGUAGES, type Language } from '../languages';

export const MAX_FILES_PER_PROJECT = 100;
export const MAX_PATH_LENGTH = 200;
export const MAX_FOLDER_DEPTH = 8;
const MAX_NAME_LENGTH = 64;

// Letters, digits, ".", "-" and "_". No spaces: they would need quoting in every compile command.
const NAME = /^[\w.-]+$/;

/** One file in a project's tree. Folders aren't stored: they exist while a file's path runs through them. */
export interface FileSummary {
  id: string;
  path: string;
}

/**
 * A project-relative POSIX path such as "src/utils.py". Leading and trailing slashes are dropped.
 *
 * [CONCEPT: Path Traversal Prevention] "." and ".." segments are rejected outright rather than resolved, so a path
 * can never point outside the project once files are written to disk (runs, zip downloads).
 */
export const filePathSchema = z
  .string()
  .trim()
  .transform((path) => path.replace(/^\/+|\/+$/g, ''))
  .pipe(
    z
      .string()
      .min(1, 'Enter a name')
      .max(MAX_PATH_LENGTH, `Paths can be at most ${MAX_PATH_LENGTH} characters`)
      .superRefine((path, ctx) => {
        const segments = path.split('/');
        const problem = segments.some((s) => s === '')
          ? "A path can't contain an empty folder name (//)"
          : segments.some((s) => s === '.' || s === '..')
            ? '"." and ".." can\'t be used as names'
            : segments.some((s) => !NAME.test(s))
              ? 'Use letters, numbers, ".", "-" and "_", with "/" between folders'
              : segments.some((s) => s.length > MAX_NAME_LENGTH)
                ? `Each name can be at most ${MAX_NAME_LENGTH} characters`
                : segments.length > MAX_FOLDER_DEPTH + 1
                  ? `Folders can be nested at most ${MAX_FOLDER_DEPTH} deep`
                  : null;
        if (problem) ctx.addIssue({ code: 'custom', message: problem });
      }),
  );

export const createFileSchema = z.object({ path: filePathSchema });
export const renameFileSchema = z.object({ path: filePathSchema });
export const moveFolderSchema = z
  .object({ from: filePathSchema, to: filePathSchema })
  .refine((v) => v.from !== v.to, { message: 'Choose a different name', path: ['to'] })
  .refine((v) => !v.to.startsWith(`${v.from}/`), {
    message: "A folder can't be moved inside itself",
    path: ['to'],
  })
  // Renaming "a/b" to "a" would merge it into its own parent, and halfway through the move a file could briefly
  // need a name another one still has.
  .refine((v) => !v.from.startsWith(`${v.to}/`), {
    message: "A folder can't be renamed to one of the folders it's in",
    path: ['to'],
  });
export const folderQuerySchema = z.object({ path: filePathSchema });

export type CreateFileInput = z.infer<typeof createFileSchema>;
export type RenameFileInput = z.infer<typeof renameFileSchema>;
export type MoveFolderInput = z.infer<typeof moveFolderSchema>;

export const basename = (path: string) => path.slice(path.lastIndexOf('/') + 1);
export const dirname = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf('/')));

/** "a/b/c.py" → ["a", "a/b"]: the folders a path runs through. */
export function parentFolders(path: string): string[] {
  const segments = path.split('/').slice(0, -1);
  return segments.map((_, i) => segments.slice(0, i + 1).join('/'));
}

/**
 * Why `path` can't be added to a project that already has `existing` paths, or null if it can.
 * A name is either a file or a folder, never both: "src" can't be a file while "src/main.py" exists.
 * Shared so the client can explain a clash before asking the server, which checks again.
 */
export function pathConflict(existing: Iterable<string>, path: string): string | null {
  const parents = new Set(parentFolders(path));
  for (const other of existing) {
    if (other === path) return `"${path}" already exists`;
    if (other.startsWith(`${path}/`)) return `"${path}" is already a folder`;
    if (parents.has(other)) return `"${other}" is a file, so it can't contain other files`;
  }
  return null;
}

/** Why the folder `from` can't be renamed to `to`, or null if every file in it can move. */
export function folderMoveConflict(existing: string[], from: string, to: string): string | null {
  const inside = (path: string) => path.startsWith(`${from}/`);
  const staying = existing.filter((path) => !inside(path));
  for (const path of existing.filter(inside)) {
    const clash = pathConflict(staying, `${to}${path.slice(from.length)}`);
    if (clash) return clash;
  }
  return null;
}

/** The language a file runs as, judged by its extension, or null for files that don't run (notes, data...). */
export function languageForPath(path: string): Language | null {
  const name = basename(path);
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';
  return LANGUAGE_IDS.find((id) => LANGUAGES[id].extension === ext) ?? null;
}
