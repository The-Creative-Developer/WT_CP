import { describe, expect, it } from 'vitest';
import {
  basename,
  dirname,
  filePathSchema,
  folderMoveConflict,
  languageForPath,
  moveFolderSchema,
  parentFolders,
  pathConflict,
} from './schemas/file';

const parse = (path: string) => filePathSchema.safeParse(path);

describe('filePathSchema', () => {
  it.each(['main.py', 'src/utils.py', 'a/b/c/Main.java', '.gitignore', 'data_1-final.txt'])(
    'accepts %s',
    (path) => expect(parse(path).success).toBe(true),
  );

  it('trims whitespace and stray slashes', () => {
    expect(parse('  /src/main.py/ ').data).toBe('src/main.py');
  });

  it.each([
    ['', 'Enter a name'],
    ['src//main.py', 'empty folder name'],
    ['../secret', '"." and ".."'],
    ['src/./main.py', '"." and ".."'],
    ['my file.py', 'Use letters'],
    ['src\\main.py', 'Use letters'],
    [`${'a'.repeat(65)}.py`, 'at most 64'],
    [`${'d/'.repeat(9)}x.py`, 'nested at most 8'],
    ['a'.repeat(201), 'at most 200'],
  ])('rejects %j', (path, message) => {
    const result = parse(path);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain(message);
  });
});

describe('moveFolderSchema', () => {
  it('refuses to move a folder into itself, its parent, or where it already is', () => {
    expect(moveFolderSchema.safeParse({ from: 'src', to: 'src/lib' }).success).toBe(false);
    expect(moveFolderSchema.safeParse({ from: 'src', to: 'src' }).success).toBe(false);
    expect(moveFolderSchema.safeParse({ from: 'src/lib', to: 'src' }).success).toBe(false);
    // "src2" merely starts with the same letters.
    expect(moveFolderSchema.safeParse({ from: 'src', to: 'src2' }).success).toBe(true);
  });
});

describe('path helpers', () => {
  it('splits paths', () => {
    expect(basename('a/b/c.py')).toBe('c.py');
    expect(basename('c.py')).toBe('c.py');
    expect(dirname('a/b/c.py')).toBe('a/b');
    expect(dirname('c.py')).toBe('');
    expect(parentFolders('a/b/c.py')).toEqual(['a', 'a/b']);
    expect(parentFolders('c.py')).toEqual([]);
  });

  it('finds clashes between files and folders', () => {
    const existing = ['main.py', 'src/util.py'];
    expect(pathConflict(existing, 'other.py')).toBeNull();
    expect(pathConflict(existing, 'src/new.py')).toBeNull();
    expect(pathConflict(existing, 'main.py')).toBe('"main.py" already exists');
    expect(pathConflict(existing, 'src')).toBe('"src" is already a folder');
    expect(pathConflict(existing, 'main.py/inner.py')).toContain('"main.py" is a file');
    // A shared prefix isn't a folder.
    expect(pathConflict(['srcs.py'], 'src/a.py')).toBeNull();
  });

  it('checks every file a folder move would touch', () => {
    const existing = ['src/a.py', 'src/b.py', 'lib/b.py', 'main.py'];
    expect(folderMoveConflict(existing, 'src', 'lib')).toBe('"lib/b.py" already exists');
    expect(folderMoveConflict(existing, 'src', 'main.py')).toContain('"main.py" is a file');
    expect(folderMoveConflict(existing, 'src', 'app')).toBeNull();
  });

  it('tells which language a file runs as', () => {
    expect(languageForPath('src/app.PY')).toBe('python');
    expect(languageForPath('Main.java')).toBe('java');
    expect(languageForPath('notes.txt')).toBeNull();
    expect(languageForPath('Makefile')).toBeNull();
  });
});
