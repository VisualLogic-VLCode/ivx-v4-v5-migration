import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { invariant } from '../errors.js';
import { ensurePrivateDir, sha256File } from '../fs/secure-json.js';
import { createAppPaths } from '../paths.js';
import {
  privateStorageState,
  resolveScenarioUrl,
  runtimeLocatorFor,
  validateRuntimeBaseUrl,
} from './playwright-driver.js';
import { redactedUrl, redactRuntimeText, runtimeValueDigest } from './trace-redaction.js';

const require = createRequire(import.meta.url);
const playwrightPackage = require(require.resolve('playwright/package.json'));
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const SECRET_TARGET = /(?:password|passwd|token|cookie|authorization|secret|api[-_ ]?key|验证码|密码|密钥)/iu;
const RISKY_ROUTE = /(?:^|[\/_-])(?:delete|remove|destroy|logout|signout|submit|confirm|pay|purchase|send|publish|deploy|删除|移除|退出|提交|确认|支付|发送|发布)(?:[\/_-]|$)/iu;

function artifactId(value) {
  invariant(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value), 'EXPLORATION_ID_INVALID', 'Exploration artifact id is invalid');
  return value;
}

function safeRelative(root, file) {
  return path.relative(root, file).split(path.sep).join('/');
}

function actionTargetText(target = {}) {
  return `${target.strategy || ''} ${target.role || ''} ${target.value || ''}`;
}

export function classifyExplorationControl(control) {
  const label = String(control.label || '').trim();
  const identity = `${label} ${control.name || ''} ${control.placeholder || ''} ${control.type || ''}`;
  if (control.disabled) return { eligibility: 'SKIPPED', reason: 'DISABLED', action: null };
  if (SECRET_TARGET.test(identity)) return { eligibility: 'SKIPPED', reason: 'SECRET_OR_AUTHENTICATION_FIELD', action: null };
  if (control.kind === 'LINK') {
    if (!control.sameOrigin) return { eligibility: 'SKIPPED', reason: 'CROSS_ORIGIN_NAVIGATION', action: null };
    if (!control.route || control.hasQuery) return { eligibility: 'SKIPPED', reason: control.hasQuery ? 'QUERY_NAVIGATION_REQUIRES_REVIEW' : 'INVALID_NAVIGATION', action: null };
    if (!control.inNavigation) return { eligibility: 'SKIPPED', reason: 'UNPROVEN_NAVIGATION_LINK', action: null };
    if (RISKY_ROUTE.test(control.route)) return { eligibility: 'SKIPPED', reason: 'RISKY_ROUTE', action: null };
    return { eligibility: 'ELIGIBLE', reason: 'SAME_ORIGIN_NAVIGATION', action: { type: 'OPEN_PAGE', input: control.route } };
  }
  if (control.role === 'tab' || control.kind === 'DISCLOSURE') {
    return { eligibility: 'ELIGIBLE', reason: control.role === 'tab' ? 'TAB_SWITCH' : 'DISCLOSURE_TOGGLE', action: { type: 'CLICK', target: control.target } };
  }
  if (control.kind === 'FILTER_INPUT') {
    return { eligibility: 'ELIGIBLE', reason: 'NON_SECRET_FILTER_INPUT', action: { type: 'FILL', target: control.target, input: 'migration-probe' } };
  }
  return { eligibility: 'SKIPPED', reason: 'UNPROVEN_READ_ONLY_CONTROL', action: null };
}

function normalizeControl(raw, index) {
  const target = raw.target;
  const classified = classifyExplorationControl(raw);
  const signature = {
    kind: raw.kind,
    role: raw.role,
    label: redactRuntimeText(raw.label || '', { max: 256 }),
    target,
    route: raw.route || null,
    inNavigation: raw.inNavigation === true,
  };
  return {
    controlId: `control-${runtimeValueDigest(signature).slice(0, 20)}`,
    index,
    ...signature,
    eligibility: classified.eligibility,
    reason: classified.reason,
    action: classified.action ? { actionId: `auto-${runtimeValueDigest({ signature, index }).slice(0, 20)}`, ...classified.action } : null,
  };
}

async function discoverControls(page, baseUrl) {
  const raw = await page.locator('a[href], button, [role="tab"], [aria-expanded], summary, input, textarea').evaluateAll((nodes, origin) => {
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    };
    const text = (element) => {
      const labelledBy = element.getAttribute('aria-labelledby');
      const referenced = labelledBy ? document.getElementById(labelledBy)?.textContent : '';
      const associated = element.labels?.length ? [...element.labels].map((label) => label.textContent || '').join(' ') : '';
      return String(element.getAttribute('aria-label') || referenced || associated || element.getAttribute('placeholder') || element.getAttribute('title') || element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 256);
    };
    const cssString = (value) => `"${String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
    const selector = (element) => {
      const testId = element.getAttribute('data-testid');
      if (testId) return { strategy: 'TEST_ID', value: testId };
      const id = element.id;
      if (id) return { strategy: 'CSS', value: `#${CSS.escape(id)}` };
      const placeholder = element.getAttribute('placeholder');
      if (placeholder) return { strategy: 'PLACEHOLDER', value: placeholder, exact: true };
      const name = element.getAttribute('name');
      if (name) return { strategy: 'CSS', value: `${element.localName}[name=${cssString(name)}]` };
      const parts = [];
      let current = element;
      while (current && current !== document.documentElement && parts.length < 6) {
        const siblings = current.parentElement ? [...current.parentElement.children].filter((candidate) => candidate.localName === current.localName) : [];
        parts.unshift(`${current.localName}:nth-of-type(${Math.max(1, siblings.indexOf(current) + 1)})`);
        current = current.parentElement;
      }
      return { strategy: 'CSS', value: parts.join(' > ') };
    };
    return nodes.filter(visible).slice(0, 1000).map((element) => {
      const label = text(element);
      const role = element.getAttribute('role') || (element.localName === 'a' ? 'link' : element.localName === 'button' ? 'button' : null);
      const inputType = element.getAttribute('type') || '';
      const searchLike = ['search'].includes(inputType.toLowerCase()) || /(?:search|filter|query|find|搜索|筛选|查询|查找)/iu.test(`${label} ${element.getAttribute('name') || ''}`);
      let kind = 'OTHER';
      let route = null;
      let sameOrigin = false;
      let hasQuery = false;
      if (element.localName === 'a') {
        kind = 'LINK';
        try {
          const url = new URL(element.href, origin);
          sameOrigin = url.origin === origin;
          hasQuery = Boolean(url.search);
          route = sameOrigin ? `${url.pathname}${url.search}` : null;
        } catch {}
      } else if (role === 'tab') kind = 'TAB';
      else if (element.localName === 'summary' || element.hasAttribute('aria-expanded')) kind = 'DISCLOSURE';
      else if (['input', 'textarea'].includes(element.localName) && searchLike) kind = 'FILTER_INPUT';
      const target = role === 'tab' && label
        ? { strategy: 'ROLE', role: 'tab', value: label, exact: true }
        : selector(element);
      return {
        kind,
        role,
        label,
        name: element.getAttribute('name') || '',
        placeholder: element.getAttribute('placeholder') || '',
        type: inputType,
        disabled: element.matches(':disabled,[aria-disabled="true"]'),
        route,
        sameOrigin,
        hasQuery,
        inNavigation: Boolean(element.closest('nav,[role="navigation"]')),
        target,
      };
    });
  }, baseUrl.origin);
  return raw.map(normalizeControl);
}

function normalizeSubjectIdentity(value, subject) {
  let output = String(value || '');
  for (const identity of [subject?.workId, subject?.nid]) {
    const text = String(identity || '');
    if (text) output = output.replaceAll(text, '<subject-identity>');
  }
  return output;
}

async function captureState(page, subject) {
  const raw = await page.evaluate(() => {
    const all = [...document.querySelectorAll('*')];
    const visible = all.filter((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    });
    const text = String(document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 200000);
    const structure = visible.slice(0, 5000).map((element) => [
      element.localName,
      element.getAttribute('role') || '',
      element.getAttribute('aria-expanded') || '',
      element.getAttribute('aria-selected') || '',
      element.getAttribute('type') || '',
    ]);
    return {
      title: document.title,
      text,
      structure,
      counts: {
        visibleElements: visible.length,
        links: document.querySelectorAll('a[href]').length,
        buttons: document.querySelectorAll('button,[role="button"]').length,
        inputs: document.querySelectorAll('input,textarea,select').length,
        dialogs: document.querySelectorAll('[role="dialog"],dialog[open]').length,
      },
    };
  });
  const normalizedText = normalizeSubjectIdentity(redactRuntimeText(raw.text, { max: 200000 }), subject)
    .replace(/\b[0-9a-f]{24,}\b/giu, '<dynamic-id>')
    .replace(/\b\d{4}-\d{2}-\d{2}[T ][0-9:.+-Z]*\b/gu, '<datetime>');
  const url = new URL(page.url());
  let ariaDigest = null;
  try { ariaDigest = runtimeValueDigest(normalizeSubjectIdentity(await page.locator('body').ariaSnapshot(), subject)); } catch {}
  const routeShape = { depth: url.pathname.split('/').filter(Boolean).length, queryKeys: [...url.searchParams.keys()].sort() };
  const comparable = {
    title: normalizeSubjectIdentity(redactRuntimeText(raw.title, { max: 512 }), subject),
    routeShape,
    counts: raw.counts,
    textDigest: runtimeValueDigest(normalizedText),
    structureDigest: runtimeValueDigest(raw.structure),
    ariaDigest,
  };
  const state = {
    url: redactedUrl(page.url()),
    ...comparable,
  };
  return { ...state, fingerprint: runtimeValueDigest(comparable) };
}

async function storageDigest(context) {
  return runtimeValueDigest(await context.storageState());
}

export class PlaywrightExplorationDriver {
  constructor({
    playwright = null,
    appPaths = createAppPaths(),
    now = () => new Date(),
    allowInsecureLocalhost = false,
    launchOptions = {},
  } = {}) {
    this.playwright = playwright;
    this.appPaths = appPaths;
    this.now = now;
    this.allowInsecureLocalhost = allowInsecureLocalhost;
    this.launchOptions = launchOptions;
  }

  async status() {
    const playwright = await this.#playwright();
    return { driver: 'playwright-autonomous-read-only', driverVersion: playwrightPackage.version, browserInstalled: fs.existsSync(playwright.chromium.executablePath()) };
  }

  async runPairPath({ reviewId, explorationId, pathId, startPath, actions = [], sourceActions = actions, targetActions = actions, source, target, artifactRoot } = {}) {
    artifactId(reviewId);
    artifactId(explorationId);
    artifactId(pathId);
    invariant(source?.generation === 'V4' && target?.generation === 'V5', 'EXPLORATION_SUBJECT_INVALID', 'Exploration pair must contain V4 source and V5 target subjects');
    const sourceBaseUrl = validateRuntimeBaseUrl(source.baseUrl, this.allowInsecureLocalhost);
    const targetBaseUrl = validateRuntimeBaseUrl(target.baseUrl, this.allowInsecureLocalhost);
    const playwright = await this.#playwright();
    const browser = await playwright.chromium.launch({ headless: true, ...this.launchOptions });
    try {
      const browserVersion = browser.version();
      const sourceResult = await this.#runSubject(browser, { reviewId, explorationId, pathId, startPath, actions: sourceActions, subject: source, baseUrl: sourceBaseUrl, artifactRoot, browserVersion });
      const targetResult = await this.#runSubject(browser, { reviewId, explorationId, pathId, startPath, actions: targetActions, subject: target, baseUrl: targetBaseUrl, artifactRoot, browserVersion });
      return { source: sourceResult, target: targetResult };
    } finally {
      await browser.close();
    }
  }

  async #playwright() {
    if (!this.playwright) this.playwright = await import('playwright');
    return this.playwright;
  }

  async #runSubject(browser, { pathId, startPath, actions, subject, baseUrl, artifactRoot, browserVersion }) {
    const startedAt = this.now().toISOString();
    const events = [];
    const blocked = [];
    const errors = [];
    let context;
    let page;
    let beforeStorage = null;
    let baselineStorage = null;
    let afterStorage = null;
    const event = (type, details = {}) => events.push({ type, at: this.now().toISOString(), ...details });
    try {
      const authState = privateStorageState(this.appPaths, baseUrl.origin);
      context = await browser.newContext({ ...(authState ? { storageState: authState } : {}), serviceWorkers: 'block' });
      beforeStorage = await storageDigest(context);
      await context.route('**/*', async (route) => {
        const request = route.request();
        const method = request.method().toUpperCase();
        let crossOriginNavigation = false;
        try { crossOriginNavigation = request.isNavigationRequest() && new URL(request.url()).origin !== baseUrl.origin; } catch { crossOriginNavigation = true; }
        if (!SAFE_METHODS.has(method) || crossOriginNavigation) {
          const code = !SAFE_METHODS.has(method) ? 'UNSAFE_NETWORK_REQUEST_BLOCKED' : 'CROSS_ORIGIN_NAVIGATION_BLOCKED';
          blocked.push({ code, method, url: redactedUrl(request.url()) });
          await route.abort('blockedbyclient');
          return;
        }
        await route.continue();
      });
      page = await context.newPage();
      page.on('popup', (popup) => {
        blocked.push({ code: 'POPUP_BLOCKED', url: redactedUrl(popup.url()) });
        void popup.close();
      });
      page.on('download', (download) => {
        blocked.push({ code: 'DOWNLOAD_BLOCKED', suggestedFilename: redactRuntimeText(download.suggestedFilename(), { max: 256 }) });
        void download.cancel();
      });
      page.on('dialog', (dialog) => {
        blocked.push({ code: 'DIALOG_BLOCKED', type: dialog.type(), message: redactRuntimeText(dialog.message(), { max: 512 }) });
        void dialog.dismiss();
      });
      page.on('pageerror', (error) => errors.push({ code: 'PAGE_UNCAUGHT_EXCEPTION', message: redactRuntimeText(error.message, { max: 2048 }) }));
      page.on('console', (message) => {
        if (['warning', 'error'].includes(message.type())) errors.push({ code: `CONSOLE_${message.type().toUpperCase()}`, message: redactRuntimeText(message.text(), { max: 2048 }) });
      });
      if (typeof page.routeWebSocket === 'function') {
        await page.routeWebSocket(/.*/, (socket) => {
          blocked.push({ code: 'WEBSOCKET_BLOCKED' });
          socket.close();
        });
      }
      await page.goto(resolveScenarioUrl(baseUrl, startPath), { waitUntil: 'domcontentloaded', timeout: 60_000 });
      baselineStorage = await storageDigest(context);
      for (const action of actions) {
        await this.#executeAction(page, action, baseUrl);
        event('ACTION_COMPLETED', { actionId: action.actionId, actionType: action.type });
      }
      await page.waitForTimeout(250);
      const state = await captureState(page, subject);
      const controls = await discoverControls(page, baseUrl);
      const screenshotPath = path.join(artifactRoot, 'screenshots', `${pathId}-${subject.generation.toLowerCase()}.png`);
      ensurePrivateDir(path.dirname(screenshotPath));
      const mask = page.locator('input[type="password"], input[name*="token" i], input[name*="secret" i], [data-sensitive="true"], [autocomplete="one-time-code"]');
      await page.screenshot({ path: screenshotPath, fullPage: true, animations: 'disabled', caret: 'hide', mask: [mask] });
      try { fs.chmodSync(screenshotPath, 0o600); } catch {}
      afterStorage = await storageDigest(context);
      if (baselineStorage !== afterStorage) blocked.push({ code: 'ISOLATED_STORAGE_MUTATION_OBSERVED' });
      return {
        generation: subject.generation,
        status: blocked.length ? 'BLOCKED' : errors.length ? 'COMPLETED_WITH_ERRORS' : 'COMPLETED',
        subject: { generation: subject.generation, nid: Number(subject.nid), workId: subject.workId },
        runtime: { driver: 'playwright-autonomous-read-only', driverVersion: playwrightPackage.version, browserVersion },
        state,
        controls,
        events,
        blocked,
        errors,
        safety: {
          unsafeRequestAttempted: blocked.some((entry) => entry.code === 'UNSAFE_NETWORK_REQUEST_BLOCKED'),
          initializationStorageChanged: beforeStorage !== baselineStorage,
          actionStorageChanged: baselineStorage !== afterStorage,
          credentials: 'DRIVER_USE_ONLY',
        },
        screenshot: { path: safeRelative(artifactRoot, screenshotPath), sha256: sha256File(screenshotPath) },
        startedAt,
        completedAt: this.now().toISOString(),
        sensitivity: 'REDACTED',
      };
    } catch (error) {
      afterStorage = context ? await storageDigest(context).catch(() => null) : null;
      return {
        generation: subject.generation,
        status: 'FAILED',
        subject: { generation: subject.generation, nid: Number(subject.nid), workId: subject.workId },
        runtime: { driver: 'playwright-autonomous-read-only', driverVersion: playwrightPackage.version, browserVersion },
        state: null,
        controls: [],
        events,
        blocked,
        errors: [...errors, { code: error?.code || 'EXPLORATION_DRIVER_FAILED', message: redactRuntimeText(error?.message || error, { max: 2048 }) }],
        safety: {
          unsafeRequestAttempted: blocked.some((entry) => entry.code === 'UNSAFE_NETWORK_REQUEST_BLOCKED'),
          initializationStorageChanged: beforeStorage !== null && baselineStorage !== null && beforeStorage !== baselineStorage,
          actionStorageChanged: baselineStorage !== null && afterStorage !== null && baselineStorage !== afterStorage,
          credentials: 'DRIVER_USE_ONLY',
        },
        screenshot: null,
        startedAt,
        completedAt: this.now().toISOString(),
        sensitivity: 'REDACTED',
      };
    } finally {
      if (context) await context.close();
    }
  }

  async #executeAction(page, action, baseUrl) {
    const timeout = action.timeoutMs || 30_000;
    if (SECRET_TARGET.test(actionTargetText(action.target))) throw Object.assign(new Error('Exploration action targets a secret or authentication field'), { code: 'EXPLORATION_SECRET_TARGET_FORBIDDEN' });
    if (action.type === 'OPEN_PAGE') await page.goto(resolveScenarioUrl(baseUrl, action.input), { waitUntil: 'domcontentloaded', timeout });
    else if (action.type === 'SCROLL') await page.mouse.wheel(0, Number(action.input));
    else {
      const locator = runtimeLocatorFor(page, action.target);
      if (action.type === 'CLICK') await locator.click({ timeout });
      else if (action.type === 'FILL') await locator.fill(String(action.input), { timeout });
      else if (action.type === 'HOVER') await locator.hover({ timeout });
      else await locator.focus({ timeout });
    }
    const current = page.url();
    if (/^https?:/i.test(current)) invariant(new URL(current).origin === baseUrl.origin, 'RUNTIME_CROSS_ORIGIN_NAVIGATION_FORBIDDEN', 'Autonomous exploration navigated outside the configured application origin');
  }
}
