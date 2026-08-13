import { spawn } from 'node:child_process';
import { WorkflowError } from '../errors.js';

const DEFAULT_RETRY_DELAYS_MS = [250, 1000];
const MAX_REMOTE_BYTES = 512 * 1024 * 1024;

function safeLocation(location) {
  try {
    const url = new URL(location);
    return `${url.origin}${url.pathname}`;
  } catch {
    return '(invalid URL)';
  }
}

function retryableStatus(status) {
  return status === 408 || status === 429 || status >= 500;
}

function delay(milliseconds) {
  if (!milliseconds) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function normalizedHeaders(headers) {
  if (!headers) return {};
  return Object.fromEntries(new Headers(headers).entries());
}

function curlConfigValue(value) {
  return String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\r', '').replaceAll('\n', '');
}

export function systemCurlBytes(location, {
  headers,
  timeoutMs,
  spawnImpl = spawn,
} = {}) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(location);
    } catch {
      const error = new Error('System downloader received an invalid URL');
      error.code = 'CURL_URL_INVALID';
      reject(error);
      return;
    }
    if (url.protocol !== 'https:' || url.username || url.password) {
      const error = new Error('System downloader requires a credential-free HTTPS URL');
      error.code = 'CURL_URL_FORBIDDEN';
      reject(error);
      return;
    }
    const child = spawnImpl('curl', [
      '--config', '-', '--fail', '--location', '--silent', '--show-error',
      '--max-redirs', '8', '--max-time', String(Math.max(1, Math.ceil(timeoutMs / 1000))),
    ], { stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks = [];
    const errors = [];
    let size = 0;
    let settled = false;
    const fail = (code, message) => {
      if (settled) return;
      settled = true;
      const error = new Error(message);
      error.code = code;
      reject(error);
    };
    child.on('error', (error) => fail(error.code === 'ENOENT' ? 'CURL_UNAVAILABLE' : (error.code || 'CURL_FAILED'), 'System downloader could not start'));
    child.stdout.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_REMOTE_BYTES) {
        child.kill('SIGTERM');
        fail('CURL_RESPONSE_TOO_LARGE', 'System downloader response exceeded the size limit');
        return;
      }
      chunks.push(chunk);
    });
    child.stderr.on('data', (chunk) => {
      if (errors.reduce((total, item) => total + item.length, 0) < 4096) errors.push(chunk);
    });
    child.on('close', (code) => {
      if (settled) return;
      if (code !== 0) {
        fail(`CURL_EXIT_${code ?? 'UNKNOWN'}`, `System downloader failed${errors.length ? ': ' : ''}${Buffer.concat(errors).toString('utf8').slice(-4096).trim()}`);
        return;
      }
      settled = true;
      resolve(Buffer.concat(chunks));
    });
    const config = [
      `url = "${curlConfigValue(url.toString())}"`,
      ...Object.entries(normalizedHeaders(headers)).map(([name, value]) => `header = "${curlConfigValue(`${name}: ${value}`)}"`),
      '',
    ].join('\n');
    child.stdin.end(config);
  });
}

export async function fetchBytes(location, {
  headers,
  attempts = 3,
  timeoutMs = 60_000,
  retryDelaysMs = DEFAULT_RETRY_DELAYS_MS,
  fetchImpl = globalThis.fetch,
  fallbackImpl,
  errorCode = 'REMOTE_DOWNLOAD_FAILED',
  label = 'Remote content',
} = {}) {
  const redactedLocation = safeLocation(location);
  const useSystemDownloader = fetchImpl === globalThis.fetch && fallbackImpl === undefined;
  const networkFallback = fallbackImpl || null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      if (useSystemDownloader) {
        try {
          return Buffer.from(await systemCurlBytes(location, { headers, timeoutMs }));
        } catch {
          // Keep the standard Fetch path as the portable fallback when curl is unavailable or fails.
        }
      }
      const response = await fetchImpl(location, {
        headers,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        if (retryableStatus(response.status) && attempt < attempts) {
          await response.body?.cancel();
          await delay(retryDelaysMs[attempt - 1] ?? 0);
          continue;
        }
        throw new WorkflowError(errorCode, `${label} returned HTTP ${response.status}`, {
          location: redactedLocation,
          status: response.status,
          attempts: attempt,
        });
      }
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      if (error instanceof WorkflowError) throw error;
      let failure = error;
      if (networkFallback) {
        try {
          return Buffer.from(await networkFallback(location, { headers, timeoutMs }));
        } catch (fallbackError) {
          failure = fallbackError;
        }
      }
      if (attempt < attempts) {
        await delay(retryDelaysMs[attempt - 1] ?? 0);
        continue;
      }
      throw new WorkflowError(errorCode, `${label} could not be downloaded after ${attempts} attempts`, {
        location: redactedLocation,
        attempts,
        causeCode: failure?.cause?.code || failure?.code || failure?.name || 'UNKNOWN_NETWORK_ERROR',
      });
    }
  }
  throw new WorkflowError(errorCode, `${label} could not be downloaded`, { location: redactedLocation });
}
