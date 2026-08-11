import assert from 'node:assert/strict';
import test from 'node:test';
import { decodePlatformWork, encodePlatformWork } from '../src/platform/work-codec.js';

const work = {
  stage: { id: 'stage-root', type: 'stage', children: [{ id: '中文-stage-child' }] },
  server: { id: 'server-root', type: 'server', children: [] },
  case: { id: 'case-root', type: 'ih5-case', uis: { name: 'Codec fixture ✓' } },
};

const editorFixtureBase64 = 'MyIRAHdmVUS7qpmI/+7dzEAwIBBNrd2bo3yqeh5uQjU4CU5+i02M9JU7sI7MsgOxzOvtbrPBNGzvWNY7yZYWznFXFQM31h/OV90JFdER5jb1JRrglWZ4TZZiKmeKlzWuJ9CzNfh6FX0WaJ6OrRc/jKaA2Q1U/sZFIt+EY2X6oGasrd1zeDOv81bMLZ30bp0CtoK4GqbAO8buXTwCLSth5ZnWE+fZiHcZTUJ3YAy+uCRz/qdDSOZnXCTfZLFDrG9ILQ0HO80I3pM=';

test('platform work codec round-trips without mutating roots', () => {
  const original = structuredClone(work);
  const encoded = encodePlatformWork(work, { randomBytes: () => Buffer.from('00112233445566778899aabbccddeeff10203040', 'hex') });
  assert.equal(encoded.length % 4, 0);
  assert.deepEqual(decodePlatformWork(encoded), original);
  assert.deepEqual(work, original);
});

test('platform work codec decodes a fixture produced by VxEditor41 SJCL/pako', () => {
  assert.deepEqual(decodePlatformWork(Buffer.from(editorFixtureBase64, 'base64')), work);
});

test('platform work codec rejects tampering without exposing payload data', () => {
  const encoded = encodePlatformWork(work, { randomBytes: () => Buffer.alloc(20, 7) });
  encoded[encoded.length - 1] ^= 1;
  assert.throws(() => decodePlatformWork(encoded), (error) => {
    assert.equal(error.code, 'WORK_CODEC_AUTH_FAILED');
    assert.equal(error.message.includes('Codec fixture'), false);
    return true;
  });
});
