import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PNG } from 'pngjs';
import { compareVisualArtifacts } from '../src/runtime/visual-comparator.js';

function writePng(file, width, height, rgba) {
  const png = new PNG({ width, height });
  for (let offset = 0; offset < png.data.length; offset += 4) {
    png.data[offset] = rgba[0];
    png.data[offset + 1] = rgba[1];
    png.data[offset + 2] = rgba[2];
    png.data[offset + 3] = rgba[3];
  }
  fs.writeFileSync(file, PNG.sync.write(png));
}

test('visual comparator writes a private deterministic diff and detects pixels or dimensions', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ivx-visual-'));
  try {
    const source = path.join(temporary, 'source.png');
    const target = path.join(temporary, 'target.png');
    const different = path.join(temporary, 'different.png');
    writePng(source, 4, 4, [255, 255, 255, 255]);
    writePng(target, 4, 4, [255, 255, 255, 255]);
    writePng(different, 5, 4, [0, 0, 0, 255]);
    const equal = compareVisualArtifacts({ sourcePath: source, targetPath: target, diffPath: path.join(temporary, 'equal-diff.png') });
    assert.equal(equal.status, 'MATCHED');
    assert.equal(equal.mismatchPixels, 0);
    assert.equal(fs.statSync(path.join(temporary, 'equal-diff.png')).mode & 0o777, 0o600);
    const mismatch = compareVisualArtifacts({ sourcePath: source, targetPath: different, diffPath: path.join(temporary, 'different-diff.png') });
    assert.equal(mismatch.status, 'DIFFERENT');
    assert.equal(mismatch.dimensionsEqual, false);
    assert.ok(mismatch.mismatchPixels > 0);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
