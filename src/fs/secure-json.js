import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export function ensurePrivateDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dir, 0o700);
  } catch {}
  return dir;
}

export function writePrivateFile(file, content) {
  ensurePrivateDir(path.dirname(file));
  const temporary = `${file}.${process.pid}.${crypto.randomBytes(5).toString('hex')}.tmp`;
  fs.writeFileSync(temporary, content, { mode: 0o600, flag: 'wx' });
  try {
    fs.chmodSync(temporary, 0o600);
  } catch {}
  fs.renameSync(temporary, file);
  try {
    fs.chmodSync(file, 0o600);
  } catch {}
}

export function writePrivateJson(file, value, { pretty = true } = {}) {
  const json = pretty ? `${JSON.stringify(value, null, 2)}\n` : JSON.stringify(value);
  writePrivateFile(file, json);
}

export function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT' && arguments.length >= 2) return fallback;
    throw error;
  }
}

export function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export function sha256File(file) {
  return sha256Buffer(fs.readFileSync(file));
}
