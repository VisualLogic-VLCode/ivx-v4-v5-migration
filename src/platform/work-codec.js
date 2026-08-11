import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { WorkflowError, invariant } from '../errors.js';

const CODEC_PASSWORD = 'Iyoh3ci0Keuchei6';
const PBKDF2_ITERATIONS = 1000;
const TAG_BYTES = 16;

function wordsToBigEndianBytes(words) {
  const output = Buffer.alloc(words.length * 4);
  words.forEach((word, index) => output.writeUInt32BE(Number(word) >>> 0, index * 4));
  return output;
}

function bigEndianBytesToWords(bytes) {
  invariant(bytes.length % 4 === 0, 'WORK_CODEC_INVALID', 'Word-aligned encrypted data is required');
  const words = [];
  for (let offset = 0; offset < bytes.length; offset += 4) words.push(bytes.readUInt32BE(offset));
  return words;
}

function wordsToNativeBuffer(words) {
  const output = Buffer.alloc(words.length * 4);
  words.forEach((word, index) => output.writeUInt32LE(Number(word) >>> 0, index * 4));
  return output;
}

function nativeBufferToWords(buffer) {
  invariant(buffer.length % 4 === 0, 'WORK_CODEC_INVALID', 'Encoded work length must be a multiple of four bytes');
  const words = [];
  for (let offset = 0; offset < buffer.length; offset += 4) words.push(buffer.readUInt32LE(offset));
  return words;
}

function packCompressedParts(parts) {
  const compressed = parts.map((part) => zlib.deflateRawSync(Buffer.from(part, 'utf8'), { level: 1 }));
  const partCount = compressed.length;
  const totalBytes = compressed.reduce((total, part) => total + part.length, 0);
  const wordCount = partCount + Math.ceil(totalBytes / 4);
  const words = Array.from({ length: wordCount }, () => 0);
  let payloadOffset = 0;
  compressed.forEach((part, partIndex) => {
    words[partIndex] = part.length << 1;
    for (let index = 0; index < part.length; index += 1) {
      const absolute = payloadOffset + index;
      const wordIndex = partCount + (absolute >>> 2);
      words[wordIndex] = (words[wordIndex] | (part[index] << ((absolute % 4) * 8))) >>> 0;
    }
    payloadOffset += part.length;
  });
  words[partCount - 1] = (words[partCount - 1] | 1) >>> 0;
  return words;
}

function unpackCompressedParts(words) {
  let partCount = 0;
  const lengths = [];
  for (let index = 0; index < Math.min(words.length, 10); index += 1) {
    const word = words[index] >>> 0;
    lengths.push(word >>> 1);
    partCount += 1;
    if ((word & 1) === 1) break;
  }
  invariant(partCount > 0 && (words[partCount - 1] & 1) === 1, 'WORK_CODEC_INVALID', 'Encoded work has no part terminator');
  const native = wordsToNativeBuffer(words);
  let offset = partCount * 4;
  return lengths.map((length) => {
    invariant(length >= 0 && offset + length <= native.length, 'WORK_CODEC_INVALID', 'Encoded work part exceeds payload bounds');
    const compressed = native.subarray(offset, offset + length);
    offset += length;
    try {
      return zlib.inflateRawSync(compressed).toString('utf8');
    } catch (error) {
      throw new WorkflowError('WORK_CODEC_INVALID', 'Encoded work contains invalid compressed data', { cause: error.message });
    }
  });
}

function deriveKey(saltWords) {
  return crypto.pbkdf2Sync(CODEC_PASSWORD, wordsToBigEndianBytes(saltWords), PBKDF2_ITERATIONS, 32, 'sha256');
}

export function encodePlatformWork(work, { randomBytes = crypto.randomBytes } = {}) {
  invariant(work?.stage && work?.server && work?.case, 'WORK_CODEC_INPUT_INVALID', 'Work must contain stage, server, and case roots');
  const parts = [
    JSON.stringify(work.stage),
    JSON.stringify({ ...work.server, case: work.case }),
  ];
  const plainWords = packCompressedParts(parts);
  const entropy = Buffer.from(randomBytes(20));
  invariant(entropy.length === 20, 'WORK_CODEC_RANDOM_INVALID', 'Work codec requires exactly 20 random bytes');
  const saltWords = bigEndianBytesToWords(entropy.subarray(0, 8));
  const ivWords = bigEndianBytesToWords(entropy.subarray(8, 20));
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(saltWords), wordsToBigEndianBytes(ivWords));
  const ciphertext = Buffer.concat([cipher.update(wordsToBigEndianBytes(plainWords)), cipher.final()]);
  const encryptedWords = bigEndianBytesToWords(Buffer.concat([ciphertext, cipher.getAuthTag()]));
  return wordsToNativeBuffer([...saltWords, ...ivWords, ...encryptedWords]);
}

export function decodePlatformWork(value) {
  const encoded = Buffer.isBuffer(value) ? value : Buffer.from(value);
  invariant(encoded.length >= 20 + TAG_BYTES && encoded.length % 4 === 0, 'WORK_CODEC_INVALID', 'Encoded work is too short or misaligned');
  const words = nativeBufferToWords(encoded);
  const saltWords = words.slice(0, 2);
  const ivWords = words.slice(2, 5);
  const encrypted = wordsToBigEndianBytes(words.slice(5));
  invariant(encrypted.length > TAG_BYTES, 'WORK_CODEC_INVALID', 'Encoded work has no ciphertext');
  const ciphertext = encrypted.subarray(0, encrypted.length - TAG_BYTES);
  const tag = encrypted.subarray(encrypted.length - TAG_BYTES);
  let plaintext;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(saltWords), wordsToBigEndianBytes(ivWords));
    decipher.setAuthTag(tag);
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new WorkflowError('WORK_CODEC_AUTH_FAILED', 'Encoded work authentication failed');
  }
  const parts = unpackCompressedParts(bigEndianBytesToWords(plaintext));
  invariant(parts.length >= 2, 'WORK_CODEC_INVALID', 'Encoded work must contain stage and server parts');
  try {
    const stage = JSON.parse(parts[0]);
    const server = JSON.parse(parts[1]);
    const caseRoot = server.case;
    invariant(caseRoot && typeof caseRoot === 'object', 'WORK_CODEC_INVALID', 'Encoded server part has no case root');
    delete server.case;
    return { stage, server, case: caseRoot };
  } catch (error) {
    if (error instanceof WorkflowError) throw error;
    throw new WorkflowError('WORK_CODEC_INVALID', 'Encoded work contains invalid JSON', { cause: error.message });
  }
}
