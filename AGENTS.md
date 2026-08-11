# Local migration package guardrails

- This repository orchestrates released converter packages; it must not duplicate or modify converter transformation rules.
- Never persist, log, print, or pass a user token to a converter, validator, Job artifact, or AI analysis file.
- Converter-owned issues stop the Job and produce evidence. They are fixed only in the separately maintained converter repository.
- Platform write operations must remain disabled until their permission checks, idempotency, recovery, and post-save verification have integration tests.
- Do not commit or publish without explicit user approval.
