# ADR 0003 — Product UI: simulated live monitoring and retrieval-mode selector

- **Status:** Accepted
- **Date:** 2026-10-04

## Context

The prototype's evaluation protocol is frozen (see `docs/evaluation-protocol.md`)
and the agent architecture is deliberately a tool registry, not a RAG pipeline.
A product-facing request then added two UI surfaces:

1. A live plant-monitoring view, so the app reads like operations software
   rather than a chat demo.
2. A clearer "which retrieval strategy am I using" control in the chat header
   (the five frozen tool configs already existed, but were labelled numerically).

There is no PLC/MQTT feed, no streaming database, and no plan to add one within
the capstone timeline.

## Decision

**Monitoring is a deterministic, client-side simulation.** It is seeded from
each asset's latest stored `SensorReading`, advanced by a fixed-seed PRNG
(`mulberry32`), and evaluated with the *same* `evaluateGuardrails` rules the
agent tool uses. It performs no database writes. The UI carries an explicit
"Simulated feed" label because presenting synthetic telemetry as real plant
data would be a research-integrity problem.

**The retrieval-mode selector is display-only.** `CONFIG_LABELS` and
`CONFIG_DESCRIPTIONS` change how the five frozen configs are presented; they do
not change membership. `TOOL_CONFIGS_FROZEN` and `buildToolRegistry` remain the
single source of truth, shared with the eval harness.

## Consequences

- The evaluation protocol and Phase 6A question set are untouched; no re-freeze
  or new ADR is needed for label/description changes.
- No schema change, no new dependency, and no new background job.
- Monitoring telemetry is **not** evidence for RQ3. Only tool-call evidence
  recorded in `ChatMessage.evidence` counts. If the paper shows a monitoring
  screenshot, it must say it is simulated.
- A future real feed can replace `features/monitoring/simulation.ts` behind the
  same `MonitoringSnapshot` shape without touching the UI or the guardrail rules.
