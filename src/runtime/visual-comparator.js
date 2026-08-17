import fs from 'node:fs';
import path from 'node:path';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { invariant } from '../errors.js';
import { ensurePrivateDir, sha256File } from '../fs/secure-json.js';

function readPng(file) {
  const stat = fs.lstatSync(file);
  invariant(stat.isFile() && !stat.isSymbolicLink(), 'VISUAL_ARTIFACT_UNSAFE', 'Visual comparison input must be a regular non-symlink PNG file');
  return PNG.sync.read(fs.readFileSync(file));
}
function padded(image, width, height) {
  if (image.width === width && image.height === height) return image;
  const output = new PNG({ width, height, fill: true });
  output.data.fill(255);
  PNG.bitblt(image, output, 0, 0, image.width, image.height, 0, 0);
  return output;
}

export function compareVisualArtifacts({ sourcePath, targetPath, diffPath, threshold = 0.1, maxMismatchRatio = 0.005 } = {}) {
  invariant(typeof threshold === 'number' && threshold >= 0 && threshold <= 1, 'VISUAL_THRESHOLD_INVALID', 'Visual threshold must be between 0 and 1');
  invariant(typeof maxMismatchRatio === 'number' && maxMismatchRatio >= 0 && maxMismatchRatio <= 1, 'VISUAL_THRESHOLD_INVALID', 'Visual mismatch ratio must be between 0 and 1');
  const sourceOriginal = readPng(sourcePath);
  const targetOriginal = readPng(targetPath);
  const width = Math.max(sourceOriginal.width, targetOriginal.width);
  const height = Math.max(sourceOriginal.height, targetOriginal.height);
  const source = padded(sourceOriginal, width, height);
  const target = padded(targetOriginal, width, height);
  const diff = new PNG({ width, height });
  const mismatchPixels = pixelmatch(source.data, target.data, diff.data, width, height, { threshold, includeAA: false });
  ensurePrivateDir(path.dirname(diffPath));
  fs.writeFileSync(diffPath, PNG.sync.write(diff), { mode: 0o600 });
  try { fs.chmodSync(diffPath, 0o600); } catch {}
  const totalPixels = width * height;
  const mismatchRatio = totalPixels ? mismatchPixels / totalPixels : 0;
  const dimensionsEqual = sourceOriginal.width === targetOriginal.width && sourceOriginal.height === targetOriginal.height;
  return {
    status: dimensionsEqual && mismatchRatio <= maxMismatchRatio ? 'MATCHED' : 'DIFFERENT',
    source: { width: sourceOriginal.width, height: sourceOriginal.height, sha256: sha256File(sourcePath) },
    target: { width: targetOriginal.width, height: targetOriginal.height, sha256: sha256File(targetPath) },
    diff: { width, height, sha256: sha256File(diffPath) },
    dimensionsEqual,
    mismatchPixels,
    totalPixels,
    mismatchRatio,
    threshold,
    maxMismatchRatio,
  };
}
