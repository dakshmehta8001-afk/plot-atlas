@AGENTS.md

## Delegation

- Use the `search` and `grep` subagents for broad repo searches instead of long inline Read and Grep chains. They run on Haiku and keep the main context small.
- After a non-trivial change, run the `audit` subagent on the diff before saying the work is done. It is read-only.
- Do single lookups and single commands yourself: one grep, one build, one test run. A subagent costs more than it saves there.
- Ask for an Opus review before locking a large plan, when the same error appears twice, and before signing off a large diff. Skip it for small edits.
