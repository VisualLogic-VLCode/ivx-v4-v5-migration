export const AGENT_PROTOCOL_VERSION = 4;

export const PUBLIC_RELEASE_PROFILE = Object.freeze({
  channel: 'stable',
  platformBaseUrl: 'https://dev.ivx.cn',
  manifests: Object.freeze({
    workflow: 'https://raw.githubusercontent.com/VisualLogic-VLCode/ivx-v4-v5-migration/release-channel/workflow-stable.json',
    converter: 'https://raw.githubusercontent.com/VisualLogic-VLCode/tov5parser/release-channel/converter-stable.json',
    knowledge: 'https://raw.githubusercontent.com/VisualLogic-VLCode/ivx-v4-v5-knowledge/release-channel/knowledge-stable.json',
  }),
  publicKeyPem: `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA6t8vbBbJaD2ZXVvTRZLu/fmgdsMULwFKgypilnLQ2z8=
-----END PUBLIC KEY-----
`,
  publicKeyFingerprintSha256: 'f567525b290d2a6cf1be05875f4933920fe4808b5833b67ef88018dbb50e9fa4',
  publicKeys: Object.freeze({
    knowledge: `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAaw3tEzdNVm1MEbZLfc4JwAu3o4+8JFlK1I4gcjUGCks=
-----END PUBLIC KEY-----
`,
  }),
});
