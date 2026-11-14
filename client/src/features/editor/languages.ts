import { basename } from '@devverse/shared';

// Monaco language ids by file extension. Anything else opens as plain text.
const BY_EXTENSION: Record<string, string> = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  py: 'python',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  h: 'cpp',
  c: 'c',
  java: 'java',
  json: 'json',
  md: 'markdown',
  html: 'html',
  css: 'css',
  yml: 'yaml',
  yaml: 'yaml',
  sh: 'shell',
};

/** The editor's syntax highlighting for a file, chosen by its extension. */
export function monacoLanguageFor(path: string): string {
  const name = basename(path);
  const dot = name.lastIndexOf('.');
  return (dot > 0 && BY_EXTENSION[name.slice(dot + 1).toLowerCase()]) || 'plaintext';
}
