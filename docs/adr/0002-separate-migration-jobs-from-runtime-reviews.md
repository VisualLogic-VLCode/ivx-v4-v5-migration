---
status: accepted
---

# Keep Migration Jobs immutable and runtime reviews separate

A completed Migration Job remains the immutable audit record of classification, conversion, validation, and initial V5 creation. Runtime testing, human evidence, external editor changes, and later repairs live in independent Runtime Review Sessions that reference the Job and target revision; this preserves the original migration result across Agent sessions and prevents later investigation from rewriting conversion history.

A target revision may have only one non-terminal write-capable review at a time. That Review Write Lease prevents competing repair sessions but is not platform-write authorization; every actual write still requires the existing operation-specific authorization, revision check, journal, and read-back verification.
