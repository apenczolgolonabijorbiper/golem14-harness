// Assemble explicit semantic inputs only. Lease/ledger/publication stay adapter-owned.
const json = (value) => JSON.stringify(value, null, 2) + "\n";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const object = (value) =>
  value && typeof value === "object" && !Array.isArray(value);
export function renderQueue(queue) {
  // A text block preserves literal Unicode, punctuation and multiline questions.
  // Fence length is chosen so supplied backticks cannot terminate the block.
  return (
    "# Questions\n\n" +
    queue.questions
      .map((q) => {
        const text = q.text,
          fence = "`".repeat(
            Math.max(
              3,
              ...[...text.matchAll(/`+/g)].map((m) => m[0].length + 1),
            ),
          );
        return `## ${q.id} (${q.status})\n\n${fence}text\n${text}\n${fence}\n`;
      })
      .join("\n")
  );
}
export function cycleArtifacts(changes, state, graph, lease) {
  const errors = [],
    writes = new Map(),
    queue = structuredClone(state.queue),
    sources = new Set(graph.sources.map((s) => s.id));
  const fail = (path, message) => errors.push(path + ": " + message);
  if (changes.questions !== undefined) {
    if (!Array.isArray(changes.questions) || changes.questions.length > 20000)
      fail("questions", "Expected at most 20000 updates");
    else {
      const seen = new Set();
      for (const [i, q] of changes.questions.entries()) {
        const path = `questions/queue.json.questions[${i}]`;
        if (
          !object(q) ||
          Object.keys(q).some(
            (k) =>
              ![
                "id",
                "status",
                "text",
                "source_observation_id",
                "created_at",
                "answer",
                "analysis",
              ].includes(k),
          ) ||
          typeof q.id !== "string" ||
          !/^[a-zA-Z0-9_-]{1,80}$/.test(q.id) ||
          seen.has(q.id) ||
          typeof q.text !== "string" ||
          !q.text.trim() ||
          q.text.length > 2000 ||
          !["open", "closed"].includes(q.status)
        ) {
          fail(path, "Invalid/duplicate question update");
          continue;
        }
        seen.add(q.id);
        if (!sources.has(q.source_observation_id))
          fail(
            path + ".source_observation_id",
            "Not in resulting graph: " + q.source_observation_id,
          );
        if (
          q.analysis !== undefined &&
          (!object(q.analysis) ||
            !Array.isArray(q.analysis.source_observation_ids) ||
            q.analysis.source_observation_ids.some((id) => !sources.has(id)))
        ) {
          fail(path + ".analysis", "Invalid analysis source references");
          continue;
        }
        const index = queue.questions.findIndex((old) => old.id === q.id);
        if (index < 0) queue.questions.push(structuredClone(q));
        else
          queue.questions[index] = {
            ...queue.questions[index],
            ...structuredClone(q),
          };
      }
      if (changes.questions.length) {
        writes.set("questions/queue.json", json(queue));
        writes.set("questions/queue.md", renderQueue(queue));
      }
    }
  }
  const hypotheses =
    changes.hypotheses === undefined
      ? state.hypotheses
      : structuredClone(changes.hypotheses);
  if (changes.hypotheses !== undefined)
    writes.set(state.layout.hypotheses_path, json(hypotheses));
  if (changes.events !== undefined) {
    if (!Array.isArray(changes.events) || changes.events.length > 20)
      fail("events", "Expected at most 20 events");
    else
      for (const [i, event] of changes.events.entries()) {
        const path = `events[${i}]`;
        if (
          !object(event) ||
          Object.keys(event).some(
            (k) =>
              ![
                "observation_id",
                "question_id",
                "answer",
                "answered_at",
              ].includes(k),
          ) ||
          !uuid.test(event.observation_id ?? "") ||
          typeof event.answer !== "string" ||
          !event.answer.trim() ||
          event.answer.length > 64000 ||
          typeof event.answered_at !== "string" ||
          !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(
            event.answered_at,
          ) ||
          !Number.isFinite(Date.parse(event.answered_at))
        ) {
          fail(path, "Invalid chat event");
          continue;
        }
        const source = state.sources[event.observation_id],
          question = queue.questions.find((q) => q.id === event.question_id);
        if (
          !lease.sources.some((s) => s.id === event.observation_id) ||
          !question ||
          !source ||
          (source.question_id && source.question_id !== event.question_id)
        ) {
          fail(
            path,
            "Event must match a claimed observation and known question",
          );
          continue;
        }
        const target = `memory/events/chat/${event.observation_id}.json`;
        if (writes.has(target)) {
          fail(path, "Duplicate event destination");
          continue;
        }
        writes.set(target, json(event));
      }
  }
  return { errors, writes, queue, hypotheses };
}
