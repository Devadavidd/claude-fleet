// Browser File → { name, dataBase64 } for POST /api/uploads, plus the shared
// client-side caps guard used by every attach surface (Launch modal and the
// session composer). Chunked btoa so multi-MB files never blow the
// argument-length limit of String.fromCharCode.

export interface EncodedUploadFile {
  name: string;
  dataBase64: string;
}

// Mirror the server caps CLIENT-side with real messages — the server's JSON
// body limit would otherwise destroy an oversized request mid-flight, which
// surfaces as an opaque network error.
export const MAX_UPLOAD_FILES = 8;
export const MAX_UPLOAD_FILE_BYTES = 8 * 1024 * 1024; // per-file server cap
export const MAX_UPLOAD_BATCH_BYTES = 20 * 1024 * 1024; // keep base64 JSON under the 32MB route body limit

export interface AddFilesResult {
  files: File[];
  /** First cap violation hit, or null when everything was accepted. */
  error: string | null;
}

/** Merge newly picked files into the current attachment list under the caps. */
export function addFilesWithCaps(current: readonly File[], picked: readonly File[]): AddFilesResult {
  let error: string | null = null;
  const next = [...current];
  for (const f of picked) {
    if (next.length >= MAX_UPLOAD_FILES) { error = `At most ${MAX_UPLOAD_FILES} attachments per message.`; break; }
    if (f.size > MAX_UPLOAD_FILE_BYTES) { error = `"${f.name}" is over the 8MB per-file limit.`; continue; }
    if (next.reduce((sum, x) => sum + x.size, 0) + f.size > MAX_UPLOAD_BATCH_BYTES) {
      error = 'Attachments exceed the 20MB total limit.';
      break;
    }
    next.push(f);
  }
  return { files: next, error };
}

/**
 * Upload name for a picked File. Folder picks (webkitdirectory) carry their
 * path inside the folder — keep it, with '/' flattened to '__', so the agent
 * still sees where each file came from (the server stores flat basenames).
 */
export function uploadNameFor(file: File): string {
  const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
  return rel ? rel.replace(/\//g, '__') : file.name;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export async function encodeFilesForUpload(files: Iterable<File>): Promise<EncodedUploadFile[]> {
  const out: EncodedUploadFile[] = [];
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    out.push({ name: uploadNameFor(file), dataBase64: bytesToBase64(bytes) });
  }
  return out;
}
