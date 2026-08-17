---
status: accepted
---

# Make the local Agent the direct test executor

New runtime testing uses Agent Direct Test Sessions: Workflow binds authorization, revisions, environment evidence, Job scope, expiry, and evidence submission, but provides no browser driver, action planner, readiness detector, or test-time decision logic. The local Agent chooses its browser/code tools and adaptively owns the complete test process because fixed Workflow exploration prevented business-aware decisions and produced false completion on a platform loading shell. Read-only direct testing is enabled first; side-effect testing is a separate capability that must bind exact systems, objects, actions, budgets, credential policy, and acknowledged non-recoverability before it is enabled.

Legacy Runtime Scenarios and Runtime Explorations remain readable and executable only for backward compatibility with existing Reviews; their driver-verified reports are not reinterpreted as Agent attestations. New Agent adapters use only the direct-test protocol. Workflow validates scope, revisions, immutable manifests, report shape, and evidence references, then records an `AGENT_ATTESTED` outcome without claiming independently verified or strict parity.
