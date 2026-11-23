# Guided Golem setup for ChatGPT Work

Use ChatGPT Work as the inference host. Read integration/SETUP.instance.md from
this same harness and follow its guided setup procedure. Propose application
docs/GOLEM_WORK.md as the reusable setup record, unless an existing selected
record or the user specifies another location. Use the current Work tools and
connections, and explicitly load the application instructions.

## Memory-backed questions and goals

Use [the portable cognitive-task protocol](../docs/COGNITIVE_TASKS.md) and
[the SudoLang task prompt](../integration/COGNITIVE_TASK.sudo.md) for question or
goal-driven cognition. The host binds committed memory and guidance, schedules
finite invocations and retains linked conversation messages. User and Golem
questions can branch; inferred intent never grants action/write authorization.
This read-only answer path is separate from observation-batch processing.
