import { EventEmitter } from 'node:events';
import type { FileSummary } from '@devverse/shared';

export interface FilesChanged {
  roomSlug: string;
  /** Every file in the project after the change. */
  files: FileSummary[];
  /** Files that no longer exist: anyone editing them must be disconnected. */
  deletedIds: string[];
  by: string;
}

interface RoomEventMap {
  'files:changed': [FilesChanged];
}

// [CONCEPT: Publish–Subscribe] REST handlers announce what changed without knowing who listens: the Socket.IO layer
// tells the room, and the Yjs server closes documents that were deleted. In-process, like the run queue (ADR 006).
const emitter = new EventEmitter<RoomEventMap>();

export const roomEvents = {
  publishFilesChanged(event: FilesChanged) {
    emitter.emit('files:changed', event);
  },
  /** Returns a function that unsubscribes. */
  onFilesChanged(listener: (event: FilesChanged) => void): () => void {
    emitter.on('files:changed', listener);
    return () => emitter.off('files:changed', listener);
  },
};
