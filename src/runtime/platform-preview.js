import { invariant } from '../errors.js';

export function resolvePlatformPreviewUrl(workInfo) {
  const direct = workInfo?.previewUrl;
  let url;
  if (typeof direct === 'string' && direct.trim()) {
    try { url = new URL(direct); } catch { /* validated below */ }
  } else {
    const domain = workInfo?.previewDomain || workInfo?.domainForPreview;
    const previewPath = workInfo?.previewPath;
    if (typeof domain === 'string' && domain.trim() && typeof previewPath === 'string' && previewPath.trim()) {
      const originValue = /^https?:\/\//i.test(domain) ? domain : `https://${domain}`;
      try {
        const origin = new URL(originValue);
        if (
          ['https:', 'http:'].includes(origin.protocol)
          && !origin.username
          && !origin.password
          && origin.pathname === '/'
          && !origin.search
          && !origin.hash
        ) {
          const resolved = new URL(previewPath, origin);
          if (resolved.origin === origin.origin) url = resolved;
        }
      } catch { /* validated below */ }
    }
  }
  invariant(url && ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password, 'PLATFORM_PREVIEW_URL_UNAVAILABLE', 'Platform metadata has no safe preview URL for runtime testing');
  url.hash = '';
  return url.toString();
}
