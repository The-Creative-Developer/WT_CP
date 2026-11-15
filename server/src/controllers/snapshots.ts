import type { CreateSnapshotInput } from '@devverse/shared';
import { ZipArchive } from 'archiver';
import type { RequestHandler } from 'express';
import { currentUser } from '../middleware/auth';
import type { LiveText } from '../services/files';
import * as snapshots from '../services/snapshots';

type ProjectParams = { projectId: string };

export function createSnapshotsController(liveText?: LiveText) {
  const create: RequestHandler<ProjectParams> = async (req, res) => {
    const { projectId } = req.params;
    const { message } = req.body as CreateSnapshotInput;
    const snapshot = await snapshots.createSnapshot(currentUser(req), projectId, message, liveText);
    res
      .location(`/api/v1/projects/${projectId}/snapshots/${snapshot.id}`)
      .status(201)
      .json(snapshot);
  };

  const list: RequestHandler<ProjectParams> = async (req, res) => {
    res.json(await snapshots.listSnapshots(currentUser(req), req.params.projectId));
  };

  // A version never changes once saved, so the browser may keep it as long as it likes.
  const get: RequestHandler<ProjectParams & { snapshotId: string }> = async (req, res) => {
    const { projectId, snapshotId } = req.params;
    const snapshot = await snapshots.getSnapshot(currentUser(req), projectId, snapshotId);
    res.set('Cache-Control', 'private, max-age=31536000, immutable').json(snapshot);
  };

  /**
   * [CONCEPT: Streaming Response] The ZIP is written to the socket as it's compressed, so the server never holds the
   * whole archive in memory. There's no Content-Length (the size isn't known up front): the body is sent chunked.
   */
  const exportZip: RequestHandler<ProjectParams> = async (req, res) => {
    const { name, files } = await snapshots.exportProject(
      currentUser(req),
      req.params.projectId,
      liveText,
    );
    // [CONCEPT: Content-Disposition] "attachment" makes the browser save the file instead of showing it.
    res.attachment(`${name}.zip`).set('Cache-Control', 'no-store');

    const archive = new ZipArchive({ zlib: { level: 6 } });
    archive.on('error', (err) => res.destroy(err));
    archive.on('warning', (err) => res.destroy(err));
    // Stop compressing if the download is cancelled.
    res.on('close', () => {
      if (!res.writableFinished) archive.abort();
    });
    archive.pipe(res);
    // [CONCEPT: Zip Slip] Entry names are project paths, which can't contain "." or ".." segments (filePathSchema),
    // so unzipping can't write outside the folder it creates.
    for (const file of files) archive.append(file.content, { name: `${name}/${file.path}` });
    await archive.finalize();
  };

  return { create, list, get, exportZip };
}
