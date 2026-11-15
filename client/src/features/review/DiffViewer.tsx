import { useEffect, useRef } from 'react';
import { useEffectiveTheme } from '../../hooks/useEffectiveTheme';
import { monacoLanguageFor } from '../editor/languages';
import { monaco } from '../editor/monaco';

export interface DiffViewerProps {
  path: string;
  /** The older version; null if the file is new. */
  original: string | null;
  /** The reviewed version; null if the file was deleted. */
  modified: string | null;
  /** Lines of the reviewed version that have comment threads. */
  threads: { line: number; resolved: boolean; count: number }[];
  /** Scrolled into view and highlighted, e.g. when a thread is picked in the list. */
  focusLine: number | null;
  /** Called when someone clicks a line number or a comment marker, or uses "Comment on this line". */
  onLineSelect?: (line: number) => void;
}

/**
 * Two versions of a file, side by side (or inline on narrow screens), with a marker in the gutter beside every line
 * that has comments.
 *
 * [CONCEPT: Diff Editor] Monaco's diff editor works out which lines changed in its own Web Worker and colours them;
 * this component only gives it the two texts.
 */
export default function DiffViewer({
  path,
  original,
  modified,
  threads,
  focusLine,
  onLineSelect,
}: DiffViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const markersRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
  const focusRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
  // Read through a ref so a new callback doesn't rebuild the editor.
  const onSelectRef = useRef(onLineSelect);
  const theme = useEffectiveTheme();

  useEffect(() => {
    onSelectRef.current = onLineSelect;
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const editor = monaco.editor.createDiffEditor(container, {
      readOnly: true,
      originalEditable: false,
      automaticLayout: true,
      glyphMargin: true,
      renderSideBySide: true,
      // Inline (one column) when there isn't room for two, e.g. on phones.
      useInlineViewWhenSpaceIsLimited: true,
      scrollBeyondLastLine: false,
      minimap: { enabled: false },
      fontSize: 14,
      ariaLabel: 'Changes',
      originalAriaLabel: 'Earlier version',
      modifiedAriaLabel: 'Reviewed version',
    });
    editorRef.current = editor;
    const reviewed = editor.getModifiedEditor();
    markersRef.current = reviewed.createDecorationsCollection();
    focusRef.current = reviewed.createDecorationsCollection();

    // [CONCEPT: Event Delegation] One listener for the whole gutter, which works out the line from the click target.
    const mouse = reviewed.onMouseDown((e) => {
      const { type, position } = e.target;
      const T = monaco.editor.MouseTargetType;
      if (position && (type === T.GUTTER_GLYPH_MARGIN || type === T.GUTTER_LINE_NUMBERS)) {
        onSelectRef.current?.(position.lineNumber);
      }
    });
    // The same from the keyboard, the right-click menu and the F1 command list.
    const action = reviewed.addAction({
      id: 'devverse.review.comment',
      label: 'Comment on this line',
      contextMenuGroupId: 'navigation',
      run: (ed) => {
        const line = ed.getPosition()?.lineNumber;
        if (line) onSelectRef.current?.(line);
      },
    });

    return () => {
      mouse.dispose();
      action.dispose();
      const models = editor.getModel();
      editor.dispose();
      models?.original.dispose();
      models?.modified.dispose();
      editorRef.current = null;
    };
  }, []);

  // New models for each file. The old ones are disposed so a long review doesn't leak memory.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const language = monacoLanguageFor(path);
    const previous = editor.getModel();
    editor.setModel({
      original: monaco.editor.createModel(original ?? '', language),
      modified: monaco.editor.createModel(modified ?? '', language),
    });
    previous?.original.dispose();
    previous?.modified.dispose();
    editor.updateOptions({ ariaLabel: `Changes to ${path}` });
  }, [path, original, modified]);

  useEffect(() => {
    markersRef.current?.set(
      threads.map(({ line, resolved, count }) => ({
        range: new monaco.Range(line, 1, line, 1),
        options: {
          glyphMarginClassName: `review-thread-glyph${resolved ? ' is-resolved' : ''}`,
          glyphMarginHoverMessage: {
            value: `${count} comment${count === 1 ? '' : 's'}${resolved ? ' (resolved)' : ''}`,
          },
          stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
        },
      })),
    );
  }, [threads, path, modified]);

  useEffect(() => {
    const reviewed = editorRef.current?.getModifiedEditor();
    if (!reviewed || !focusLine) {
      focusRef.current?.clear();
      return;
    }
    reviewed.revealLineInCenterIfOutsideViewport(focusLine);
    reviewed.setPosition({ lineNumber: focusLine, column: 1 });
    focusRef.current?.set([
      {
        range: new monaco.Range(focusLine, 1, focusLine, 1),
        options: { isWholeLine: true, className: 'review-focus-line' },
      },
    ]);
  }, [focusLine, path, modified]);

  useEffect(() => {
    monaco.editor.setTheme(theme === 'dark' ? 'vs-dark' : 'vs');
  }, [theme]);

  return <div ref={containerRef} className="h-[65vh] min-h-80" />;
}
