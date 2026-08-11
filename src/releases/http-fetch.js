import { WorkflowError } from '../errors.js';

const DEFAULT_RETRY_DELAYS_MS = [250, 1000];

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

export async function fetchBytes(location, {
  headers,
  attempts = 3,
  timeoutMs = 60_000,
  retryDelaysMs = DEFAULT_RETRY_DELAYS_MS,
  fetchImpl = globalThis.fetch,
  errorCode = 'REMOTE_DOWNLOAD_FAILED',
  label = 'Remote content',
} = {}) {
  const redactedLocation = safeLocation(location);
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
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
      if (attempt < attempts) {
        await delay(retryDelaysMs[attempt - 1] ?? 0);
        continue;
      }
      throw new WorkflowError(errorCode, `${label} could not be downloaded after ${attempts} attempts`, {
        location: redactedLocation,
        attempts,
        causeCode: error?.cause?.code || error?.code || error?.name || 'UNKNOWN_NETWORK_ERROR',
      });
    }
  }
  throw new WorkflowError(errorCode, `${label} could not be downloaded`, { location: redactedLocation });
}
