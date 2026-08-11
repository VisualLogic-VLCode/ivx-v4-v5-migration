function parseExtra(extra) {
  if (!extra) return {};
  if (typeof extra === 'string') {
    try { return parseExtra(JSON.parse(extra)); } catch { return {}; }
  }
  if (typeof extra !== 'object' || Array.isArray(extra)) return {};
  if (extra.extra && typeof extra.extra === 'object') return { ...extra, ...extra.extra };
  return extra;
}

function normalizeEditorVersion(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  if (['4', '4.0'].includes(normalized)) return 'V4_0';
  if (normalized === '4.1') return 'V4_1';
  if (['3', '3.0', '3.5'].includes(normalized)) return 'OUT_OF_SCOPE';
  return normalized ? 'UNKNOWN' : null;
}

export function classifyMetadataVersion(metadata = {}) {
  const extra = parseExtra(metadata.extra);
  const ntype = Number(metadata.ntype ?? metadata.type ?? metadata.work?.ntype);
  if (Number(extra.ver) === 2) {
    return {
      kind: [91, 92].includes(ntype) ? 'V5_1' : 'V5_0',
      source: 'metadata.extra.ver',
      ntype: Number.isFinite(ntype) ? ntype : null,
      evidence: { extraVer: extra.ver, ntype: Number.isFinite(ntype) ? ntype : null },
    };
  }

  const candidates = [
    metadata.edt_ver,
    metadata.edtVer,
    metadata.data?.edt_ver,
    metadata.node?.edt_ver,
    metadata.work?.edt_ver,
  ].map(normalizeEditorVersion).filter(Boolean);
  const unique = [...new Set(candidates)];
  if (unique.length > 1) {
    return { kind: 'AMBIGUOUS', source: 'metadata.edt_ver', evidence: { candidates: unique } };
  }
  if (unique[0]) return { kind: unique[0], source: 'metadata.edt_ver', ntype: Number.isFinite(ntype) ? ntype : null, evidence: { candidates: unique } };
  return { kind: 'UNKNOWN', source: 'metadata', ntype: Number.isFinite(ntype) ? ntype : null, evidence: {} };
}

export function scanWorkVersionSignals(work) {
  const signals = {
    v5EventAst: 0,
    v4EventTree: 0,
    legacyEventOn: 0,
    formulaObjects: 0,
  };
  const seen = new Set();
  const stack = [work];
  while (stack.length) {
    const value = stack.pop();
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const child of value) stack.push(child);
      continue;
    }
    if (value.events && Array.isArray(value.events.list)) {
      for (const event of value.events.list) {
        if (event && typeof event === 'object') {
          if (Object.hasOwn(event, 'ast') && event.ast && typeof event.ast === 'object') signals.v5EventAst += 1;
          if (Object.hasOwn(event, 'tree') && event.tree && typeof event.tree === 'object') signals.v4EventTree += 1;
        }
      }
    }
    if (value.event && Array.isArray(value.event.on)) signals.legacyEventOn += value.event.on.length || 1;
    if (value.type === 'Formula' || (Object.hasOwn(value, 'code') && Array.isArray(value.str))) signals.formulaObjects += 1;
    for (const child of Object.values(value)) stack.push(child);
  }

  let kind = 'UNKNOWN';
  let format = null;
  if (signals.v5EventAst > 0 && signals.v4EventTree === 0 && signals.legacyEventOn === 0) {
    kind = 'V5';
  } else if (signals.v5EventAst === 0 && (signals.v4EventTree > 0 || signals.legacyEventOn > 0)) {
    kind = 'V4';
    if (signals.v4EventTree > 0 && signals.legacyEventOn > 0) format = 'mixed';
    else if (signals.legacyEventOn > 0) format = 'legacy';
    else format = 'new';
  } else if (signals.v5EventAst > 0 && (signals.v4EventTree > 0 || signals.legacyEventOn > 0)) {
    kind = 'AMBIGUOUS';
    format = 'mixed-v4-v5';
  }
  return { kind, format, signals };
}

export function classifyCaseVersion({ metadata = {}, work } = {}) {
  const metadataResult = classifyMetadataVersion(metadata);
  const physical = work ? scanWorkVersionSignals(work) : { kind: 'UNKNOWN', format: null, signals: {} };
  const metadataIsV5 = ['V5_0', 'V5_1'].includes(metadataResult.kind);
  const metadataIsV4 = ['V4_0', 'V4_1'].includes(metadataResult.kind);
  const conflict =
    (metadataIsV5 && physical.kind === 'V4') ||
    (metadataIsV4 && physical.kind === 'V5') ||
    physical.kind === 'AMBIGUOUS' ||
    metadataResult.kind === 'AMBIGUOUS';
  if (conflict) {
    return { kind: 'AMBIGUOUS', convertible: false, reason: 'VERSION_SIGNAL_CONFLICT', metadata: metadataResult, physical };
  }
  if (metadataIsV5 || physical.kind === 'V5') {
    return { kind: metadataIsV5 ? metadataResult.kind : 'V5', convertible: false, reason: 'ALREADY_V5', metadata: metadataResult, physical };
  }
  if (metadataResult.kind === 'OUT_OF_SCOPE') {
    return { kind: 'OUT_OF_SCOPE', convertible: false, reason: 'SOURCE_VERSION_OUT_OF_SCOPE', metadata: metadataResult, physical };
  }
  if (physical.kind === 'V4') {
    const supportedFormat = physical.format === 'new';
    return {
      kind: metadataIsV4 ? metadataResult.kind : 'V4',
      convertible: supportedFormat,
      reason: supportedFormat ? 'CONFIRMED_V4' : 'UNSUPPORTED_V4_FORMAT',
      metadata: metadataResult,
      physical,
    };
  }
  if (metadataIsV4 && work && physical.kind === 'UNKNOWN') {
    return {
      kind: metadataResult.kind,
      convertible: true,
      reason: 'CONFIRMED_V4_METADATA_FALLBACK',
      metadata: metadataResult,
      physical: { ...physical, format: 'no-versioned-event-signals' },
    };
  }
  if (metadataIsV4 && !work) {
    return { kind: metadataResult.kind, convertible: false, reason: 'WORK_REQUIRED_FOR_PHYSICAL_CONFIRMATION', metadata: metadataResult, physical };
  }
  return { kind: 'AMBIGUOUS', convertible: false, reason: 'INSUFFICIENT_VERSION_SIGNALS', metadata: metadataResult, physical };
}
