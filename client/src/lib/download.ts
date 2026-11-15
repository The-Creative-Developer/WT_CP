/**
 * Saves a Blob as a file. [CONCEPT: Object URLs] URL.createObjectURL gives the in-memory Blob a temporary blob: URL
 * that a link can point at; it's revoked straight after, so the memory is freed.
 */
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  // Revoked on the next tick: some browsers start the download asynchronously after the click.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
