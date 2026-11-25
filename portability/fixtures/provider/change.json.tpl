{
  "provider_version": 1,
  "base_snapshot": "{{SNAPSHOT}}",
  "policy_id": "{{POLICY}}",
  "lease_id": "{{RUN}}",
  "run_id": "{{RUN}}",
  "attempt_id": "attempt-portable",
  "idempotency_key": "portable-once",
  "sources": [
    {
      "id": "22222222-2222-4222-8222-222222222222",
      "sha256": "810162b1e7e50a3a0b4d3e129a1fbcbe914aafaebb8120a94566790dc9a0f2a1"
    }
  ],
  "at": "2026-01-03T00:00:00.000Z",
  "operations": [
    {
      "op": "append_journal",
      "record": {
        "id": "{{RUN}}",
        "policy_id": "{{POLICY}}",
        "review": "Reviewed Beta. No inferred claims.",
        "verification_id": "attempt-portable"
      }
    },
    {
      "op": "append_verification",
      "record": {
        "id": "attempt-portable",
        "run_id": "{{RUN}}",
        "result": "Synthetic deterministic test; no inference."
      }
    }
  ]
}
