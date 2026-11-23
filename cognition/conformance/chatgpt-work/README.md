# ChatGPT Work evaluation record

The 18 synthetic cases were answered by the model in the current ChatGPT Work
session on 2026-11-23. Harness metadata and source locators were serialized
mechanically. The retained integrity checker accepted 18 of 18 result envelopes.
The case rubrics were visible to the answering model. This run used prepared
synthetic snapshots and the portable validator. It did not exercise a fresh
Work session as a separately dispatched executor. Model ID, cost and package
hash were not observed. The input retains each case's finite limits and
synthetic usage; those values do not measure Work session usage.

Harness base inspected: b63323216f4b51334e77156217ef4e4465936c78.

| File | SHA-256 |
|---|---|
| input.json | d7258b69bdf71dc465dd4547571085ef90d08406dcab20b9dff831e78836ec23 |
| results.json | 10bea1e470235650c554d739890d3969393c0151c3c0d10e27508c4333124071 |
| integrity-report.json | c0a72bda2b10a894c6534919435946bcece4be45d25f7483ae8ee0e2a162d4fd |
| server/cognitive-task.mjs | 9ffcb901a7770924c8b56d879037bc5529eb6e5843763e7e32b76b0fbac6808e |
| server/cognitive-reference.mjs | d7abb905a647dde5fa9fa1366d67b969adde9ea87c8c505032196c5b24b7eb74 |
| tools/evaluate-cognition.mjs | d91ac6222a4d88c87af15d50b8e2b8c8d7d556dcffa366cac81a08834778fed0 |
| cognition/conformance/cases.mjs | e29298dfe687e80ea68ad1facac81bde76420caed7875273d540050513b82ebd |

Run the checker from the repository root:

```sh
node tools/evaluate-cognition.mjs check cognition/conformance/chatgpt-work/input.json cognition/conformance/chatgpt-work/results.json /tmp/work-integrity-report.json
```

For the remaining vendor acceptance run, start a fresh ChatGPT Work session
using the portable executor procedure in docs/COGNITIVE_TASKS.md. Supply the
prepared request and ask for the JSON response without repository writes.
Keep expected outcomes and semantic rubrics with the evaluator when sending
case data to the fresh session. Retain the original response, run the checker
against the complete prepared input, and record a separate semantic verdict
with the reason for each case. The earlier Codex CLI startup probe was a
different execution environment.
