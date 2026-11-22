import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fixture, harness } from "./test-fixtures.mjs";

test("timings preserve default bytes/results and cover real validation/query/stats stages", (t) => {
  const f = fixture(t),
    cli = join(harness, "processor/memory-tool.mjs");
  for (const command of ["validate", "context", "stats"]) {
    const run = (...extra) =>
      spawnSync(process.execPath, [cli, command, "--root", f.root, ...extra], {
        encoding: "utf8",
      });
    const plain = run(),
      off = run("--timings", "false"),
      on = run("--timings", "true");
    assert.equal(plain.status, 0);
    assert.equal(off.stdout, plain.stdout);
    assert.equal(off.stderr, plain.stderr);
    assert.equal(on.status, 0, on.stderr);
    const { timings, ...result } = JSON.parse(on.stdout);
    assert.deepEqual(result, JSON.parse(plain.stdout));
    assert.ok(timings.elapsed_ms >= 0);
    for (const phase of [
      "load",
      "schema",
      "graph",
      "hypotheses",
      "provenance",
      "claims",
      "history",
      ...(command === "context"
        ? ["query", "render"]
        : command === "stats"
          ? ["stats"]
          : []),
    ])
      assert.ok(timings.phases[phase]?.elapsed_ms >= 0, phase);
    assert.equal(run("--timings", "yes").status, 1);
    assert.equal(run("--timings", "true", "--timings", "true").status, 1);
  }
  f.write("questions/queue.md", "Broken readable queue");
  f.write("questions/queue.json", {
    schema_version: 1,
    questions: [
      {
        id: "q",
        text: "Missing?",
        status: "open",
        source_observation_id: "missing",
      },
    ],
  });
  const run = (...extra) =>
    spawnSync(process.execPath, [cli, "validate", "--root", f.root, ...extra], {
      encoding: "utf8",
    });
  const plain = run(),
    off = run("--timings", "false"),
    on = run("--timings", "true");
  assert.equal(plain.status, 1);
  assert.equal(off.stderr, plain.stderr);
  assert.equal(on.status, 1);
  assert.ok(on.stderr.startsWith(plain.stderr));
  assert.equal(on.stdout, "");
});
