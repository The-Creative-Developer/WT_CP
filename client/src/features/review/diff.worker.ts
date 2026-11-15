import { compareSnapshots } from './line-diff';
import type { DiffRequest, DiffResponse } from './useSnapshotDiff';

// [CONCEPT: Web Workers] Comparing every file of two versions can take a while for big projects. Done here, in a
// background thread, the page keeps scrolling and responding meanwhile. Messages are copied between threads with the
// structured clone algorithm, so the worker shares no state with the page.
self.onmessage = ({ data }: MessageEvent<DiffRequest>) => {
  const response: DiffResponse = { id: data.id, changes: compareSnapshots(data.base, data.head) };
  self.postMessage(response);
};
