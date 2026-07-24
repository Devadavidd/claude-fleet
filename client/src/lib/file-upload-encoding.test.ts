import { test, expect } from 'vitest';
import { addFilesWithCaps, uploadNameFor, MAX_UPLOAD_FILES, MAX_UPLOAD_FILE_BYTES } from './file-upload-encoding.js';

// Pins the shared attach-caps guard and the folder-pick naming used by both
// the Launch modal and the session composer.

const mk = (name: string, size = 4, rel?: string): File => {
  const f = new File([new Uint8Array(size)], name);
  if (rel) Object.defineProperty(f, 'webkitRelativePath', { value: rel });
  return f;
};

test('accepts files under the caps and appends to the current list', () => {
  const { files, error } = addFilesWithCaps([mk('a.txt')], [mk('b.txt'), mk('c.txt')]);
  expect(files.map((f) => f.name)).toEqual(['a.txt', 'b.txt', 'c.txt']);
  expect(error).toBeNull();
});

test('caps: max count, oversize file skipped with message', () => {
  const eight = Array.from({ length: MAX_UPLOAD_FILES }, (_, i) => mk(`f${i}`));
  const over = addFilesWithCaps(eight, [mk('extra')]);
  expect(over.files).toHaveLength(MAX_UPLOAD_FILES);
  expect(over.error).toMatch(/At most/);

  const big = addFilesWithCaps([], [mk('big.bin', MAX_UPLOAD_FILE_BYTES + 1), mk('ok.txt')]);
  expect(big.files.map((f) => f.name)).toEqual(['ok.txt']); // oversize skipped, rest accepted
  expect(big.error).toMatch(/8MB/);
});

test('uploadNameFor keeps folder-relative paths, flattened with __', () => {
  expect(uploadNameFor(mk('x.ts'))).toBe('x.ts');
  expect(uploadNameFor(mk('x.ts', 4, 'src/lib/x.ts'))).toBe('src__lib__x.ts');
});
