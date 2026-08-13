import assert from 'node:assert/strict';
import test from 'node:test';
import { resolvePlatformPreviewUrl } from '../src/runtime/platform-preview.js';

test('platform preview URL uses server-provided URL or the verified domain/path pair', () => {
  assert.equal(resolvePlatformPreviewUrl({ previewUrl: 'https://preview.example/play/abc#fragment' }), 'https://preview.example/play/abc');
  assert.equal(resolvePlatformPreviewUrl({ previewDomain: 'preview.example', previewPath: '/play/xyz' }), 'https://preview.example/play/xyz');
  assert.throws(() => resolvePlatformPreviewUrl({ previewUrl: 'https://user:secret@preview.example/play/x' }), { code: 'PLATFORM_PREVIEW_URL_UNAVAILABLE' });
  assert.throws(() => resolvePlatformPreviewUrl({ previewDomain: 'preview.example', previewPath: '//attacker.example/play/x' }), { code: 'PLATFORM_PREVIEW_URL_UNAVAILABLE' });
  assert.throws(() => resolvePlatformPreviewUrl({ previewDomain: 'preview.example/base', previewPath: '/play/x' }), { code: 'PLATFORM_PREVIEW_URL_UNAVAILABLE' });
  assert.throws(() => resolvePlatformPreviewUrl({ previewDomain: '', previewPath: '' }), { code: 'PLATFORM_PREVIEW_URL_UNAVAILABLE' });
});
