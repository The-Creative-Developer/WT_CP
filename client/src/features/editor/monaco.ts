import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import TsWorker from 'monaco-editor/language/typescript/ts.worker?worker';

// [CONCEPT: Web Workers] Monaco runs tokenising, diffing and the JavaScript language service in background
// threads, so typing stays smooth on the main thread. Vite's ?worker suffix bundles each one as a separate file.
self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    return label === 'typescript' || label === 'javascript' ? new TsWorker() : new EditorWorker();
  },
};

export { monaco };
