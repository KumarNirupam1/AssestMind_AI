# ADR 0001 — Asset naming: `PUMP-nnn` as a declared abstraction

- **Status:** Accepted
- **Date:** 2026-09-27
- **Deciders:** project team
- **Relates to:** `assetmind-ai-architecture.md` §3, `assetmind-ai-plan-review.md` §A5/§J1

## Context

The source dataset is **AI4I 2020**, a simulated *milling machine*. It has no
pumps in it. The original execution plan nevertheless built its Phase 9 demo
around an asset called **Pump-102**, and that framing was carried into the
task description the team was given.

The plan review (§J1) identified this as a conceptual mismatch a viva panel
would find, and offered three resolutions:

| Option | Description | Verdict |
|---|---|---|
| (a) | Name assets for what the data represents (`MC-101` machining centres) | Cheapest, most literal |
| (b) | Keep pump names, **state the abstraction and argue it** | Requires a written defence |
| (c) | Source a genuine rotating-equipment dataset | Most faithful, costs a dataset swap |

Options (a) and (b) are both explicitly permitted by the architecture doc,
which requires that a non-literal name be "stated explicitly and argued".

## Decision

Adopt **`PUMP-101` … `PUMP-401`** — option (b).

The asset identifiers describe the *class of equipment the asset represents
in the plant* (a pumping duty), while the sensor channels behind them are an
AI4I stand-in stream.

## The argument

The investigation task this system performs is equipment-agnostic. Given a
stop event, the agent must establish **what failed, when, which readings
precede it, what the maintenance record says, and what the technician should
check first.** That reasoning depends on evidence availability and
traceability, not on the mechanics of the machine.

The mapping is defensible on three grounds:

1. **The dataset is explicitly a stand-in already.** The team uses AI4I
   because it is a public, citable, label-rich dataset (Matzka 2020,
   DOI `10.1109/AI4I49448.2020.00023`) with per-mode ground truth. It was
   never chosen because it depicts a pump.
2. **The signal channels are channel-compatible.** AI4I's air/process
   temperature, rotational speed, torque and tool-wear channels occupy the
   same roles as pump telemetry: a duty indicator, a speed, a load, and a
   cumulative degradation measure. The mapping is at the level of
   *channel semantics*, which is what the tools consume.
3. **`PUMP-nnn` is a recognised IIoT convention**, so a reader is not
   misled into thinking a bespoke scheme was invented for this project.

## Consequences we accept

This is a real cost and is stated rather than hidden.

- **The Phase 2 guardrail rules are milling rules.** They reason about tool
  wear in minutes, `torque × spindle speed`, and the process-to-air
  temperature differential. On a nominally-pump asset, `checkGuardrails`
  will be evaluating cutting behaviour.
- **Therefore the rules must be described as "milling-derived heuristics",
  never as "pump physics".** Any tool description, system prompt, or paper
  sentence that implies the rules model pump failure modes is incorrect.
- **The manual content follows the same rule.** Seeded maintenance procedures
  describe a BT40 spindle taper and a 24-station tool changer, matching the
  milling frame, not the pump label.
- **A panel is likely to probe this.** The first question to expect is "your
  asset is called a pump but your guardrails check tool wear — which is it?"
  The answer is: the label is the plant role, the rules are the available
  physics, and the project claims traceability of reasoning rather than
  domain-specific failure modelling.

## What must appear in the paper

- A stated limitation: results are on a milling-machine dataset used to
  model pumping assets, and the guardrail rules are milling-derived.
- The rules are never described as pump-specific.
- No claim is made that the system models pump failure physics.

## Alternatives rejected

- **`MC-101` machining centres (option a).** Literal and cheapest, but it
  discards the `Pump-102` framing the original task description and Phase 9
  demo were built around. Reversible at any time via the single
  `ASSET_NAMES` constant in `prisma/seed.ts`.
- **Swapping the dataset (option c).** Rejected on cost: a dataset swap would
  also put the AI4I guardrail rule set in question, since it is the labels
  that make Phase 2 and RQ3 possible at all.
