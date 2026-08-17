---
status: accepted
---

# Preserve source domains and target-owned routes during Save As

A newly created V5 case must retain the V4 case's Domain Binding—`domain`, `customDomain`, and `previewDomain`—because those fields select the externally visible host identity used by business logic and runtime comparison. It must not copy the V4 case's `path`, `previewPath`, `pubRoot`, or `preRoot`. Those fields form the Target Route Allocation generated for the new case; copying them can make the source and target compete for the same route.

The Workflow therefore freezes the revision-pinned source Domain Binding, reads the newly created target settings, combines the source binding with the target allocation, and sends the platform's complete modify payload. Ordinary, Additional V5, and diagnostic Save As operations share this journaled checkpoint. Success requires exact read-back. A lost or uncertain response may be confirmed only from the observed target settings; a mismatch stops for reconciliation and must never trigger an automatic replay. An old journal that had already entered final content saving before this checkpoint existed continues with its prior behavior instead of inserting a new write during recovery.
