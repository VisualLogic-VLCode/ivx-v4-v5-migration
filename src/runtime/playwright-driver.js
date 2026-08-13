import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { validateBehaviorTrace, validateRuntimeScenario } from '../contracts/schema-v2.js';
import { WorkflowError, invariant } from '../errors.js';
import { ensurePrivateDir, sha256File, writePrivateFile } from '../fs/secure-json.js';
import { createAppPaths } from '../paths.js';
import { redactedUrl, redactRuntimeText, runtimeValueDigest, runtimeValueSummary, runtimeValueType } from './trace-redaction.js';

const require = createRequire(import.meta.url);
const playwrightPackagePath = require.resolve('playwright/package.json');
const playwrightPackage = require(playwrightPackagePath);
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function isLoopback(hostname) {
  return ['localhost', '127.0.0.1', '::1'].includes(hostname);
}

function validateBaseUrl(value, allowInsecureLocalhost) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new WorkflowError('RUNTIME_URL_INVALID', 'Runtime base URL must be an absolute URL');
  }
  invariant(!url.username && !url.password, 'RUNTIME_URL_INVALID', 'Runtime base URL must not contain credentials');
  invariant(url.protocol === 'https:' || (allowInsecureLocalhost && url.protocol === 'http:' && isLoopback(url.hostname)), 'RUNTIME_URL_INVALID', 'Runtime base URL must use HTTPS, except explicitly allowed loopback tests');
  url.hash = '';
  return url;
}

function resolveScenarioUrl(baseUrl, route) {
  const resolved = new URL(route, baseUrl);
  invariant(resolved.origin === baseUrl.origin, 'RUNTIME_CROSS_ORIGIN_NAVIGATION_FORBIDDEN', 'Runtime Scenario cannot navigate to another origin');
  return resolved.toString();
}

function locatorFor(page, target) {
  const exact = target.exact === true;
  if (target.strategy === 'ROLE') return page.getByRole(target.role, { name: target.value, exact });
  if (target.strategy === 'LABEL') return page.getByLabel(target.value, { exact });
  if (target.strategy === 'PLACEHOLDER') return page.getByPlaceholder(target.value, { exact });
  if (target.strategy === 'TEXT') return page.getByText(target.value, { exact });
  return page.getByTestId(target.value);
}

function storageStatePath(appPaths, origin) {
  const digest = crypto.createHash('sha256').update(origin).digest('hex').slice(0, 24);
  return path.join(appPaths.browserAuth, `storage-state-${digest}.json`);
}

function assertPrivateStorageState(target) {
  const stat = fs.lstatSync(target);
  invariant(stat.isFile() && !stat.isSymbolicLink(), 'BROWSER_AUTH_STATE_UNSAFE', 'Browser authentication state must be a regular non-symlink file');
  if (process.platform !== 'win32') invariant((stat.mode & 0o077) === 0, 'BROWSER_AUTH_STATE_UNSAFE', 'Browser authentication state permissions must be 0600');
  return target;
}

function legacyStateMatchesOrigin(target, origin) {
  try {
    const state = JSON.parse(fs.readFileSync(target, 'utf8'));
    const expected = new URL(origin);
    const origins = Array.isArray(state.origins) ? state.origins : [];
    const cookies = Array.isArray(state.cookies) ? state.cookies : [];
    const originMatches = origins.every((entry) => entry?.origin === expected.origin);
    const cookieMatches = cookies.every((cookie) => {
      const domain = String(cookie?.domain || '').replace(/^\./, '').toLowerCase();
      return domain && (expected.hostname.toLowerCase() === domain || expected.hostname.toLowerCase().endsWith(`.${domain}`));
    });
    return originMatches && cookieMatches && (origins.length > 0 || cookies.length > 0);
  } catch {
    return false;
  }
}

function privateStorageState(appPaths, origin = null) {
  if (origin) {
    const scoped = storageStatePath(appPaths, origin);
    if (fs.existsSync(scoped)) return assertPrivateStorageState(scoped);
    const legacy = path.join(appPaths.browserAuth, 'storage-state.json');
    if (fs.existsSync(legacy) && legacyStateMatchesOrigin(legacy, origin)) return assertPrivateStorageState(legacy);
    return null;
  }
  if (!fs.existsSync(appPaths.browserAuth)) return null;
  const target = fs.readdirSync(appPaths.browserAuth)
    .filter((file) => /^storage-state(?:-[a-f0-9]{24})?\.json$/.test(file))
    .map((file) => path.join(appPaths.browserAuth, file))
    .find((file) => fs.existsSync(file));
  return target ? assertPrivateStorageState(target) : null;
}

function runtimeError(code, message, source, at) {
  return { code, message: redactRuntimeText(message, { max: 4096 }), at, source };
}

export class PlaywrightRuntimeDriver {
  constructor({
    playwright = null,
    appPaths = createAppPaths(),
    now = () => new Date(),
    randomBytes = crypto.randomBytes,
    allowInsecureLocalhost = false,
    launchOptions = {},
    onTakeover = null,
    runProcess = spawnSync,
  } = {}) {
    this.playwright = playwright;
    this.appPaths = appPaths;
    this.now = now;
    this.randomBytes = randomBytes;
    this.allowInsecureLocalhost = allowInsecureLocalhost;
    this.launchOptions = launchOptions;
    this.onTakeover = onTakeover;
    this.runProcess = runProcess;
  }

  async status() {
    const playwright = await this.#playwright();
    const executablePath = playwright.chromium.executablePath();
    return {
      driver: 'playwright',
      driverVersion: playwrightPackage.version,
      browserEngine: 'chromium',
      executablePath,
      browserInstalled: fs.existsSync(executablePath),
      authState: privateStorageState(this.appPaths) ? 'AVAILABLE' : 'NOT_CONFIGURED',
    };
  }

  installBrowser() {
    const cli = path.join(path.dirname(playwrightPackagePath), 'cli.js');
    invariant(fs.existsSync(cli), 'PLAYWRIGHT_CLI_MISSING', 'The locked Playwright CLI is missing from the Workflow installation');
    const result = this.runProcess(process.execPath, [cli, 'install', 'chromium'], { encoding: 'utf8' });
    if (result.status !== 0) throw new WorkflowError('PLAYWRIGHT_BROWSER_INSTALL_FAILED', 'Failed to install the locked Playwright Chromium browser', {
      stdout: redactRuntimeText(result.stdout?.slice(-4000) || ''),
      stderr: redactRuntimeText(result.stderr?.slice(-4000) || ''),
    });
    return { driverVersion: playwrightPackage.version, browserEngine: 'chromium', installed: true };
  }

  async captureAuthentication({ url } = {}) {
    const baseUrl = validateBaseUrl(url, this.allowInsecureLocalhost);
    invariant(typeof this.onTakeover === 'function', 'RUNTIME_USER_TAKEOVER_REQUIRED', 'Authentication capture requires a visible user takeover callback');
    const playwright = await this.#playwright();
    ensurePrivateDir(this.appPaths.browserProfile);
    ensurePrivateDir(this.appPaths.browserAuth);
    const context = await playwright.chromium.launchPersistentContext(this.appPaths.browserProfile, { headless: false, ...this.launchOptions });
    try {
      const pages = context.pages();
      const page = pages[0] || await context.newPage();
      await page.goto(baseUrl.toString(), { waitUntil: 'domcontentloaded', timeout: 60000 });
      await this.onTakeover({ page, scenario: null, subject: { generation: 'AUTH', nid: null, workId: null } });
      const state = await context.storageState();
      const hostname = baseUrl.hostname.toLowerCase();
      const scopedState = {
        cookies: (state.cookies || []).filter((cookie) => {
          const domain = String(cookie.domain || '').replace(/^\./, '').toLowerCase();
          return hostname === domain || hostname.endsWith(`.${domain}`);
        }),
        origins: (state.origins || []).filter((entry) => entry.origin === baseUrl.origin),
      };
      const target = storageStatePath(this.appPaths, baseUrl.origin);
      writePrivateFile(target, `${JSON.stringify(scopedState)}\n`);
      return { authState: 'AVAILABLE', origin: baseUrl.origin };
    } finally {
      await context.close();
    }
  }

  async runPair({ reviewId, cycleId, scenario, source, target, artifactRoot } = {}) {
    validateRuntimeScenario(scenario);
    invariant(source?.generation === 'V4' && target?.generation === 'V5', 'RUNTIME_SUBJECT_INVALID', 'Runtime pair must contain V4 source and V5 target subjects');
    const sourceBaseUrl = validateBaseUrl(source.baseUrl, this.allowInsecureLocalhost);
    const targetBaseUrl = validateBaseUrl(target.baseUrl, this.allowInsecureLocalhost);
    const playwright = await this.#playwright();
    const headless = scenario.executionPolicy.mode === 'UNATTENDED';
    const browser = await playwright.chromium.launch({ headless, ...this.launchOptions });
    try {
      const browserVersion = browser.version();
      const sourceRun = await this.#runSubject(browser, { reviewId, cycleId, scenario, subject: source, baseUrl: sourceBaseUrl, artifactRoot, browserVersion });
      const targetRun = await this.#runSubject(browser, { reviewId, cycleId, scenario, subject: target, baseUrl: targetBaseUrl, artifactRoot, browserVersion });
      return { source: sourceRun, target: targetRun };
    } finally {
      await browser.close();
    }
  }

  async #playwright() {
    if (!this.playwright) this.playwright = await import('playwright');
    return this.playwright;
  }

  async #runSubject(browser, { reviewId, cycleId, scenario, subject, baseUrl, artifactRoot, browserVersion }) {
    const startedAt = this.now().toISOString();
    const traceId = `trace_${subject.generation.toLowerCase()}_${this.randomBytes(6).toString('hex')}`;
    const observations = [];
    const errors = [];
    const artifacts = [];
    const captures = new Map();
    let sequence = 0;
    let context;
    let page;
    let failure = null;
    let unsafeRequestBlocked = false;
    const observe = (category, name, value, summary = runtimeValueSummary(value)) => {
      const observationId = `obs_${this.randomBytes(6).toString('hex')}`;
      observations.push({ observationId, category, name, sequence: sequence++, valueType: runtimeValueType(value), valueDigest: runtimeValueDigest(value), summary });
      captures.set(observationId, value);
      return observationId;
    };
    try {
      const storageState = privateStorageState(this.appPaths, baseUrl.origin);
      context = await browser.newContext({ ...(storageState ? { storageState } : {}) });
      if (scenario.networkPolicy.unsafeRequests === 'BLOCK') {
        await context.route('**/*', async (route) => {
          const method = route.request().method().toUpperCase();
          if (!SAFE_METHODS.has(method)) {
            unsafeRequestBlocked = true;
            errors.push(runtimeError('UNSAFE_NETWORK_REQUEST_BLOCKED', `Blocked ${method} request to ${redactedUrl(route.request().url())}`, 'DRIVER', this.now().toISOString()));
            await route.abort('blockedbyclient');
            return;
          }
          await route.continue();
        });
      }
      page = await context.newPage();
      page.on('console', (message) => {
        if (!['warning', 'error'].includes(message.type())) return;
        const value = { level: message.type(), message: redactRuntimeText(message.text()) };
        observe('CONSOLE', `console.${message.type()}`, value, `Captured console ${message.type()} message (${value.message.length} characters after redaction).`);
      });
      page.on('pageerror', (error) => errors.push(runtimeError('PAGE_UNCAUGHT_EXCEPTION', error.message, 'PAGE', this.now().toISOString())));
      page.on('requestfailed', (request) => {
        if (unsafeRequestBlocked && !SAFE_METHODS.has(request.method().toUpperCase())) return;
        errors.push(runtimeError('NETWORK_REQUEST_FAILED', `${request.method()} ${redactedUrl(request.url())}: ${request.failure()?.errorText || 'unknown failure'}`, 'NETWORK', this.now().toISOString()));
      });
      page.on('response', (response) => {
        const value = { method: response.request().method(), url: redactedUrl(response.url()), status: response.status() };
        observe('NETWORK', 'network.response', value, `Captured ${value.method} network response with status ${value.status}; headers and body omitted.`);
      });

      if (scenario.executionPolicy.mode === 'USER_VISIBLE') {
        invariant(typeof this.onTakeover === 'function', 'RUNTIME_USER_TAKEOVER_REQUIRED', 'This scenario requires a visible user takeover callback');
        for (const step of scenario.actions.filter((entry) => entry.type === 'OPEN_PAGE')) await this.#executeStep(page, step, baseUrl);
        await this.onTakeover({ page, scenario, subject: { generation: subject.generation, nid: subject.nid, workId: subject.workId } });
      } else {
        for (const step of scenario.actions) await this.#executeStep(page, step, baseUrl);
      }
      invariant(!unsafeRequestBlocked, 'RUNTIME_UNSAFE_REQUEST_BLOCKED', 'The READ_ONLY scenario attempted a non-idempotent network request');
      for (const assertion of scenario.assertions) {
        if (assertion.comparator === 'NO_ERROR') continue;
        const value = await this.#capture(page, assertion.observation);
        observe(assertion.observation.category, assertion.observation.name, value);
      }
    } catch (error) {
      failure = error;
      errors.push(runtimeError(error.code || 'RUNTIME_DRIVER_FAILED', error.message || String(error), error.code?.startsWith('RUNTIME_') ? 'DRIVER' : 'PAGE', this.now().toISOString()));
      if (page && scenario.artifactPolicy.screenshots === 'FAILURES_ONLY') {
        try {
          const relative = path.join('screenshots', `${scenario.scenarioId}-${subject.generation.toLowerCase()}.png`);
          const absolute = path.join(artifactRoot, relative);
          ensurePrivateDir(path.dirname(absolute));
          const mask = page.locator('input[type="password"], input[name*="token" i], input[name*="secret" i], [data-sensitive="true"]');
          await page.screenshot({ path: absolute, fullPage: true, mask });
          fs.chmodSync(absolute, 0o600);
          artifacts.push({ artifactId: `shot_${this.randomBytes(6).toString('hex')}`, type: 'SCREENSHOT', path: relative.split(path.sep).join('/'), sha256: sha256File(absolute) });
        } catch (screenshotError) {
          errors.push(runtimeError('SCREENSHOT_CAPTURE_FAILED', screenshotError.message || String(screenshotError), 'DRIVER', this.now().toISOString()));
        }
      }
    } finally {
      if (page && scenario.sideEffect === 'REVERSIBLE') {
        for (const step of scenario.cleanup) {
          try {
            await this.#executeStep(page, step, baseUrl);
          } catch (cleanupError) {
            failure ||= cleanupError;
            errors.push(runtimeError('RUNTIME_CLEANUP_FAILED', cleanupError.message || String(cleanupError), 'DRIVER', this.now().toISOString()));
          }
        }
      }
      if (context) await context.close();
    }
    const endedAt = this.now().toISOString();
    const trace = {
      schemaVersion: 2,
      kind: 'behavior-trace',
      traceId,
      reviewId,
      scenarioId: scenario.scenarioId,
      cycleId,
      subject: { generation: subject.generation, nid: Number(subject.nid), workId: subject.workId },
      runtime: { driver: 'playwright', driverVersion: playwrightPackage.version, browserVersion, mode: scenario.executionPolicy.mode },
      startedAt,
      endedAt,
      status: failure ? 'FAILED' : 'COMPLETED',
      observations,
      errors,
      artifacts,
      redaction: { applied: true, policyVersion: '1', omittedCategories: ['request-headers', 'response-headers', 'request-body', 'response-body', 'cookies', 'authorization', 'native-playwright-trace'] },
      createdAt: endedAt,
      createdBy: 'CLI',
      sensitivity: 'REDACTED',
    };
    return { trace: validateBehaviorTrace(trace), captures };
  }

  async #executeStep(page, step, baseUrl) {
    const timeout = step.timeoutMs || 30000;
    let result;
    if (step.type === 'OPEN_PAGE') result = await page.goto(resolveScenarioUrl(baseUrl, step.input), { waitUntil: 'domcontentloaded', timeout });
    else if (step.type === 'RELOAD') result = await page.reload({ waitUntil: 'domcontentloaded', timeout });
    else if (step.type === 'GO_BACK') result = await page.goBack({ waitUntil: 'domcontentloaded', timeout });
    else {
      const locator = locatorFor(page, step.target);
      if (step.type === 'CLICK') result = await locator.click({ timeout });
      else if (step.type === 'FILL') result = await locator.fill(String(step.input), { timeout });
      else if (step.type === 'SELECT_OPTION') result = await locator.selectOption(String(step.input), { timeout });
      else if (step.type === 'CHECK') result = await locator.check({ timeout });
      else if (step.type === 'UNCHECK') result = await locator.uncheck({ timeout });
      else if (step.type === 'PRESS') result = await locator.press(step.input, { timeout });
      else result = await locator.waitFor({ state: 'visible', timeout });
    }
    const current = page.url();
    if (/^https?:/i.test(current)) invariant(new URL(current).origin === baseUrl.origin, 'RUNTIME_CROSS_ORIGIN_NAVIGATION_FORBIDDEN', 'Runtime Scenario navigated outside the configured application origin');
    return result;
  }

  async #capture(page, observation) {
    if (observation.capture === 'URL') return redactedUrl(page.url());
    if (observation.category === 'CONSOLE') return [];
    if (observation.category === 'NETWORK') return [];
    const locator = locatorFor(page, observation.target);
    if (observation.capture === 'TEXT') return redactRuntimeText((await locator.textContent()) || '', { max: 8192 });
    if (observation.capture === 'VALUE') return redactRuntimeText(await locator.inputValue(), { max: 8192 });
    if (observation.capture === 'VISIBLE') return locator.isVisible();
    return locator.count();
  }
}
