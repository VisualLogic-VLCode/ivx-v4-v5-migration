# Local migration package guardrails

- Use the shared `ivx-migrate` CLI implementation; do not put business logic in Claude/Codex adapter files.
- Do not edit or vendor converter rules into this project.
- Never persist or expose platform tokens.
- A converter defect is report-only in this workflow. Source repairs must be constrained JSON Patch and deterministically revalidated.
- Do not enable platform Save As until permission, idempotency, resume, and post-save integration tests exist.
- Do not commit or publish without explicit user approval.
