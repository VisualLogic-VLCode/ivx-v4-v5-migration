---
status: accepted
---

# Keep autonomous exploration separate from fixed Runtime Scenarios

Runtime Scenarios remain small, deterministic assertion programs whose closed semantic vocabulary can support repeatable comparison and Review state transitions. Autonomous exploration is a different evidence shape: after one exact user authorization, the Agent may read the complete selected Job and author a bounded plan, while a trusted Workflow controller discovers and replays only proven read-only controls with semantic or bounded CSS/XPath locators. Credentials remain driver-only, arbitrary Agent browser JavaScript is not executed, every path uses a fresh context and checkpoint, and unsafe requests, external navigation, storage mutation, downloads, popups, dialogs, or revision drift quarantine the branch.

The two models remain additive rather than one replacing the other. Exploration records structural, accessibility, screenshot, pixel-diff, safety, and coverage evidence in its own private artifact chain without touching `activeCycleId` or promoting legacy Runtime Parity. A coverage-satisfied report means only that the declared safe exploration scope matched; it is not exhaustive business correctness, root-cause classification, repair authorization, or platform-write permission. Non-equivalent environments may be explored only in diagnostic mode and can claim neither parity nor Converter attribution.
