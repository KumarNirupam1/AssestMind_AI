# AssetMind AI: A Tool-Calling, Evidence-Traceable Agent for Industrial Asset Fault Investigation

**Author:** [Student name]  
**Programme:** [Programme name], IILM University  
**Supervisor:** [Supervisor name]  
**Submission date:** [Date]

## Abstract

Industrial fault investigation requires engineers to combine heterogeneous
evidence: sensor observations, historical faults, maintenance records, and
operating procedures. Conventional retrieval-augmented generation systems
often implement retrieval as a fixed pipeline and provide limited assurance
that a generated claim is supported by the evidence that was actually used.
This paper presents AssetMind AI, a full-stack generative-AI fault
investigation system in which a language model selects among six typed tools:
semantic document retrieval, keyword document retrieval, asset context, fault
history, maintenance history, and a deterministic guardrail engine. The
system is designed as an agent rather than a fixed retrieve-then-generate
pipeline. Each tool call and result is persisted as versioned evidence, and
answers use machine-checkable citations that are verified against the evidence
from the same turn.

The implementation combines Next.js, the Vercel AI SDK, PostgreSQL 16 with
pgvector and PostgreSQL full-text search, Prisma, OpenAI models, Clerk
authentication, AWS RDS, AWS S3, and Inngest. The guardrail engine implements
the deterministic HDF, PWF, and OSF rules of the AI4I 2020 dataset. These
rules reproduce the corresponding labelled rows exactly: 115 HDF rows, 95
PWF rows, and 98 OSF rows. Tool-wear failure and random failure are explicitly
not treated as deterministic threshold rules because the dataset does not
permit that inference.

At the time of writing, implementation validation has passed: 10,000 dataset
rows were checked, 66 document chunks were embedded with
`text-embedding-3-small`, both keyword and vector retrieval returned
provenance-bearing results, 202 automated tests passed, and the production
health endpoint reported a live RDS connection. The project has a frozen
evaluation protocol comprising 24 labelled questions, five tool-subset
configurations, and three repeats (360 runs). Full comparative agent results
are intentionally not reported here until that grid is executed; reporting
sample runs as population-level findings would be methodologically invalid.
The paper therefore contributes a reproducible system design, a verified
guardrail and evidence architecture, and a protocol for measuring
groundedness, structured-data value, guardrail usage, cost, latency, and
traceability.

**Keywords:** industrial fault investigation; tool-calling agents; retrieval-
augmented generation; predictive maintenance; pgvector; traceability;
grounded generation; AI4I 2020

## 1. Introduction

Industrial equipment investigation is not a single retrieval problem. An
engineer may need to identify an asset, inspect a recent sensor reading,
compare it with previous failures, consult a maintenance procedure, and decide
whether a rule-based signal is relevant. These sources differ in structure,
units, temporal meaning, and evidential authority. A system that produces a
fluent answer without showing which source supported each claim is difficult
to trust and difficult to evaluate.

Large language models (LLMs) make it possible to build conversational
investigation interfaces, but their use introduces three risks. First, the
model may make unsupported claims when the requested fact is absent. Second,
retrieval can be implemented as a hidden fixed pipeline, making it unclear
whether an answer benefited from semantic search, exact search, structured
records, or a rule engine. Third, a citation displayed in an answer may not
correspond to evidence actually returned during that interaction.

AssetMind AI addresses these risks with four design decisions:

1. **Agentic tool selection:** the model receives a subset of a common tool
   registry and chooses which tools to call and in what order. The system does
   not force a retrieve-then-generate sequence.
2. **Evidence as a first-class data product:** every tool call, outcome, and
   citable result is recorded in a versioned evidence structure attached to
   the chat message.
3. **Mechanical citation verification:** answer citations are checked against
   the evidence produced by the same turn rather than trusted by visual
   inspection.
4. **Auditable deterministic guardrails:** the AI4I rules are implemented as
   structured verdicts containing observed values, thresholds, and per-clause
   explanations. Modes that cannot be inferred deterministically are not
   represented as invented thresholds.

The project has five research questions:

- **RQ1:** How much does document retrieval improve groundedness over a
  no-tool baseline?
- **RQ2:** What value do structured asset, fault, and maintenance tools add
  beyond document retrieval?
- **RQ3:** Does the agent call the guardrail tool appropriately, including when
  a signal is weak or irrelevant?
- **RQ4:** What cost and latency trade-off accompanies additional tool
  availability?
- **RQ5:** Can factual claims be traced mechanically to tool evidence from the
  same interaction?

This paper makes three contributions. First, it describes a deployable
fault-investigation agent whose retrieval and structured-data capabilities
share one registry. Second, it documents a reproducible evidence and
evaluation design for traceability. Third, it reports implementation-level
correctness results and precisely distinguishes them from the pending
comparative LLM evaluation.

## 2. Background and Related Work

### 2.1 Retrieval-augmented generation

Retrieval-augmented generation (RAG) combines a generator with an external
non-parametric memory. This can reduce dependence on knowledge encoded in
model parameters and allow answers to use a changing document collection.
However, a conventional RAG diagram does not by itself establish that the
model used the retrieved content, that the retrieved content was relevant, or
that every factual sentence is supported.

AssetMind uses two complementary retrieval mechanisms. Vector retrieval uses
cosine distance over normalized 1536-dimensional embeddings. Keyword
retrieval uses PostgreSQL full-text search over a generated `tsvector`
column with a GIN index. The evaluation uses exact vector scans because the
corpus is small; this avoids approximate-nearest-neighbour parameters becoming
an uncontrolled experimental variable.

### 2.2 Tool-using language-model agents

Tool-using agents allow a model to select actions based on the question and
intermediate results. AssetMind follows this pattern but deliberately avoids
introducing a separate agent framework. The Vercel AI SDK executes the
multi-step loop, while a typed registry determines which tools are available.
This keeps the demonstration path and the evaluation path on the same
implementation.

The model is not permitted to treat retrieved document text as instructions.
The system prompt describes documents as untrusted data, requires abstention
when evidence is insufficient, and requires citations using the exact
identifiers returned by tools.

### 2.3 Predictive-maintenance datasets

The AI4I 2020 Predictive Maintenance Dataset provides 10,000 simulated
industrial-process rows with temperature, speed, torque, tool-wear, product
quality, machine-failure, and failure-mode fields. It is valuable for this
project because it is public, labelled, and reproducible. It is not,
however, a pump dataset. AssetMind therefore uses pump-style identifiers as a
declared plant-role abstraction while preserving the milling-machine meaning
of the source readings and rules. The system does not claim to model pump
physics.

### 2.4 Explainability and traceability

Post-hoc explanations can describe why a model might have produced an answer,
but they do not necessarily prove that the claimed evidence was present in
the model context. AssetMind treats traceability as an observable property:
the answer citation must resolve to an evidence item recorded for that turn.
This is weaker than proving semantic entailment, so the protocol supplements
mechanical citation validity with sentence coverage and a human review of
uncited factual claims.

## 3. Research Questions and Hypotheses

The evaluation is designed as a controlled tool-availability ablation. The
system prompt, model, temperature, output limits, question set, pricing
table, and repeat count are frozen before the agent experiments.

| Research question | Testable comparison |
|---|---|
| RQ1: retrieval groundedness | Configurations 1, 2, 3, and 5 |
| RQ2: structured-data value | Configuration 3 versus 4; 4 versus 5 |
| RQ3: guardrail usage | Guardrail-relevant and guardrail-irrelevant questions in configuration 5 |
| RQ4: cost/latency | Usage, cost, and duration across configurations 1–5 |
| RQ5: traceability | Citation validity, sentence coverage, and human review |

The intended hypotheses are:

- **H1:** adding retrieval will increase citation-supported sentence coverage
  relative to the no-tool baseline.
- **H2:** structured tools will increase the share of answers supported by
  fault and maintenance evidence, rather than only document chunks.
- **H3:** a full tool registry will call the guardrail engine for relevant
  concrete readings while avoiding unnecessary guardrail claims for unrelated
  questions.
- **H4:** additional tool availability will increase token use and latency,
  with diminishing returns as the registry becomes richer.
- **H5:** versioned evidence and citation verification will make invalid
  citations mechanically detectable.

These are hypotheses, not reported results. They must be tested using the
frozen run grid.

## 4. System Architecture

### 4.1 End-to-end architecture

AssetMind AI is a single Next.js application. Authenticated users interact
with a dashboard, asset pages, monitoring views, and an investigation chat.
Server Components read dashboard data directly through Prisma. The chat
route is a streaming endpoint because it runs the LLM loop and returns
incremental UI messages.

The deployed topology is:

```text
Clerk-authenticated browser
        |
        v
Next.js on Vercel
  |-- dashboard and monitoring reads
  |-- streaming chat route
  |-- Inngest webhook
        |
        +--> OpenAI chat and embedding APIs
        +--> PostgreSQL 16 + pgvector on AWS RDS
        |       |-- structured asset data
        |       |-- sensor readings and fault labels
        |       |-- maintenance records
        |       |-- document chunks and vectors
        |       |-- chat evidence
        +--> S3 document storage
        +--> Inngest ingestion jobs
```

The current seeded retrieval corpus contains 32 synthetic documents and 66
chunks. The production database also contains 8 assets, 64 components, 10,000
sensor readings, 330 attributable fault records, and 104 maintenance logs.

### 4.2 Tool registry

The six tools are:

| Tool | Evidence source | Main use |
|---|---|---|
| `searchDocumentsVector` | pgvector | semantic procedures, limits, and narratives |
| `searchDocumentsKeyword` | PostgreSQL full-text search | exact names, fault codes, and terminology |
| `getAssetContext` | relational records | asset identity, components, and current state |
| `getFaultHistory` | relational records | prior faults and outcomes |
| `getMaintenanceHistory` | relational records | maintenance, inspection, and calibration history |
| `checkGuardrails` | deterministic rule engine | HDF, PWF, and OSF verdicts for a stored reading |

`buildToolRegistry(names)` is the single construction function. The user
interface configuration selector, chat route, and evaluation harness all use
this function. The five configurations are tool subsets, not five
independently implemented pipelines:

| Configuration | Registered tools |
|---|---|
| 1: baseline | none |
| 2: vector retrieval | vector retrieval |
| 3: hybrid retrieval | vector and keyword retrieval |
| 4: structured delta | configuration 3 plus asset, fault, and maintenance tools |
| 5: full system | configuration 4 plus guardrails |

Each tool validates inputs with Zod and returns a typed success or failure
outcome. A controlled failure is returned to the model as `ok: false` rather
than terminating the stream. Tool calls are bounded by timeout, retry, result
caps, and an evidence budget.

### 4.3 Prompt and agent runtime

The system prompt is versioned as `v1` and held constant across evaluation
configurations. It defines:

- the investigation role and available tools;
- the requirement that factual claims use same-turn evidence;
- citation formats for chunks, faults, and guardrail modes;
- abstention when data is missing;
- the distinction between guardrails and learned models;
- resistance to instruction-like text inside documents.

The runtime uses the AI SDK v7 `streamText` API, a five-step ceiling, a
maximum output-token limit, a per-user daily quota, and separate accounting
for all-step usage and final-step usage. This is important because all-step
usage and final-step usage have different meanings in the SDK version used by
the project.

### 4.4 Data model and evidence

The relational model includes `Asset`, `Component`, `SensorReading`,
`FaultRecord`, `MaintenanceLog`, `Document`, `DocumentChunk`, `Chat`,
`ChatMessage`, and `DailyUsage`. A sensor reading stores temperatures in
Kelvin, speed in rpm, torque in Nm, tool wear in minutes, quality variant,
and the original dataset failure labels.

Document chunks record the embedding model, embedding dimension, and chunker
version. The vector column is `vector(1536)`, matching
`text-embedding-3-small`. A generated `tsvector` column supports keyword
retrieval. `ChatMessage.evidence` is versioned and validated because it is
simultaneously the UI evidence source, citation-verification input, and
evaluation record.

## 5. Guardrail Rule Engine

The guardrail engine is a deterministic rules component, not a trained
classifier. Its rules were written only after row-by-row comparison with the
AI4I CSV.

### 5.1 Deterministic rules

For a process sample with air temperature \(T_a\), process temperature
\(T_p\), speed \(s\), torque \(\tau\), tool wear \(w\), and product type \(q\):

**Heat dissipation failure (HDF):**

\[
|T_p-T_a| < 8.6 \quad \land \quad s < 1380.
\]

**Power failure (PWF):**

\[
P = \tau \frac{2\pi s}{60}, \qquad
P < 3500 \;\lor\; P > 9000.
\]

The conversion from rpm to radians per second is required; torque multiplied
directly by rpm is not power in watts.

**Overstrain failure (OSF):**

\[
w\tau > L_q,\qquad
L_L=11000,\; L_M=12000,\; L_H=13000.
\]

The product-type-specific thresholds are load-bearing.

### 5.2 Validation against the source labels

| Mode | Dataset label rows | Computed rows | Agreement |
|---|---:|---:|---|
| HDF | 115 | 115 | Exact row-set match |
| PWF | 95 | 95 | Exact row-set match |
| OSF | 98 | 98 | Exact row-set match |

Two modes are intentionally excluded from deterministic scoring:

- **TWF:** tool replacement or failure is randomly assigned around a wear
  interval; 790 rows fall in the 200–240 minute band, but only 46 are
  labelled TWF, and three TWF rows lie outside the band.
- **RNF:** the released CSV contains 19 random-failure labels, while the
  commonly cited documentation reports five. It is a per-row random event,
  not a threshold function of the available process variables.

The system therefore reports TWF and RNF as irreducibly random rather than
inventing a predictor and treating its false negatives as a model defect.

## 6. Materials and Methods

### 6.1 Dataset and corpus

The sensor source is the AI4I 2020 dataset. Temperatures remain in their
dataset-native Kelvin units in storage and are converted for display only.
The seeded application maps rows to eight named assets using a fixed seed.
The asset identifiers use a pump-style naming convention as a declared
abstraction; the underlying readings and documents remain milling-derived.

The document corpus contains synthetic manuals, SOPs, fault narratives, and
inspection reports. This makes the initial evaluation reproducible but limits
external validity. S3 is the intended raw-document store, while PostgreSQL
contains the currently seeded chunks used by retrieval.

### 6.2 Embeddings and retrieval

Each chunk is embedded with OpenAI `text-embedding-3-small` at 1536
dimensions. Vectors are normalized and stored in pgvector. Retrieval uses the
cosine-distance operator and exact scans. Keyword retrieval uses the generated
`tsvector` and GIN index. Both paths return source identifiers and ordinals so
the answer can cite the exact chunk.

The live database currently contains 66/66 populated embeddings. A retrieval
smoke test checks:

1. at least one embedded chunk exists;
2. keyword retrieval returns rows;
3. vector retrieval returns rows;
4. both result types include citation provenance;
5. vector distances are valid cosine distances;
6. vector results are ordered ascending by distance.

### 6.3 Frozen evaluation design

The evaluation protocol was frozen before agent implementation on
2026-09-28. It contains 24 labelled questions, five configurations, and
three repeats per question/configuration:

\[
24 \times 5 \times 3 = 360 \text{ runs}.
\]

The model is `gpt-4o-mini`, temperature is zero, pricing is frozen at
0.15 USD per million input tokens and 0.60 USD per million output tokens,
and the system prompt version and Git SHA are recorded per run.

Question coverage is:

| Question kind | Count |
|---|---:|
| Retrieval | 8 |
| Structured | 4 |
| Guardrail | 6 |
| Mixed | 3 |
| Weak signal | 2 |
| Abstention | 1 |

### 6.4 Metrics

**Groundedness (RQ1):** sentence citation coverage, defined as the fraction
of answer sentences containing at least one citation that resolves to same-turn
evidence.

**Evidence composition (RQ2):** shares of chunk, fault, and guardrail
citations, plus tool-call mix, comparing configurations 3, 4, and 5.

**Guardrail usage (RQ3):** whether the guardrail tool was called on relevant
questions, whether deterministic mode claims matched the verdict, and whether
the model over-called the tool on irrelevant questions. TWF and RNF are not
assigned threshold precision/recall.

**Cost and latency (RQ4):** all-step usage, final-step usage, calculated cost,
and wall-clock duration. Means and standard deviations are reported across
the three repeats.

**Traceability (RQ5):** mechanical citation validity, sentence coverage, and
human review of uncited factual claims. Citation validity is computed as:

\[
\text{validity} =
\frac{\text{valid citations}}
{\text{valid citations}+\text{invalid citations}}.
\]

An answer with no citations is not treated as invalid by this formula; its
groundedness is captured separately by sentence coverage.

### 6.5 Reproducibility

The project records the protocol and question set in version-controlled files.
The repository includes scripts for guardrail verification, database
verification, retrieval verification, citation verification, and evaluation
execution. CI runs linting, typechecking, the guardrail dataset check, unit
tests, and the production build without requiring a live database.

The production deployment uses Next.js on Vercel, PostgreSQL on AWS RDS,
OpenAI for chat and embeddings, Clerk for authentication, and AWS S3 for raw
documents. The current RDS instance has a one-day backup retention setting and
CloudWatch baseline alarms for CPU, storage, and connections.

## 7. Results

### 7.1 Implementation validation

The following results are directly verified by repository tests or live
read-only checks:

| Validation | Result |
|---|---|
| Unit-test files | 20 passed |
| Unit tests | 202 passed |
| Guardrail dataset rows checked | 10,000 |
| HDF/PWF/OSF label agreement | Exact row-set agreement |
| Assets | 8 |
| Components | 64 |
| Sensor readings | 10,000 |
| Attributable fault records | 330 |
| Maintenance records | 104 |
| Documents | 32 |
| Document chunks | 66 |
| Populated embeddings | 66/66 |
| Keyword retrieval | 5 results with provenance |
| Vector retrieval | 5 results with provenance |
| Evaluation question set | 24 valid questions |
| Citation sample verifier | 3 sample manifests passed |
| Production health | HTTP 200; database up |
| GitHub CI for commit `c2b9743` | Passed |

These are implementation and data-integrity results. They do not establish
that the full agent is better than the baseline on the research questions.

### 7.2 Retrieval smoke-test result

The live retrieval check returned five keyword results and five vector
results. The vector results were ordered by ascending cosine distance and
returned source identifiers and ordinals. The top free-text query distance
was approximately 0.97. This is a valid nonzero distance: a free-text query
need not exactly equal any stored chunk. The test therefore checks numerical
validity and ordering rather than incorrectly requiring a distance near zero.

The keyword and vector paths may disagree, which is expected and is the
reason the protocol measures retrieval configurations separately.

### 7.3 What cannot yet be claimed

The repository contains a frozen protocol and sample evaluation manifests,
but the complete 360-run grid and its human review have not been included in
the evidence used for this paper. Consequently, this paper does not claim:

- a measured groundedness improvement for H1;
- a measured structured-data improvement for H2;
- a guardrail-call precision or over-reliance rate for H3;
- a population-level cost/latency curve for H4;
- a complete unsupported-claim rate for H5.

Those claims become reportable after executing the full grid, preserving its
manifest, verifying citations, and completing the planned human review.

## 8. Discussion

### 8.1 Why the architecture is appropriate for investigation

A fixed retrieval pipeline assumes that every question requires the same
sequence. That is not true for an investigation assistant. A question about
the meaning of an SOP term may need document retrieval; a question about
recent failures may need a relational history tool; a question about a
concrete reading may need a guardrail check; and an unanswerable question
should produce abstention. A common registry with selectable subsets makes
these alternatives measurable without duplicating code.

### 8.2 Traceability is stronger than displaying citations

The system does not treat a model-generated source label as trustworthy.
Evidence is captured when the tool executes, and the citation verifier checks
that the label resolves to that evidence. This catches invented identifiers,
wrong ordinals, and citations to modes not returned in the turn. It does not,
by itself, prove that the cited result semantically entails every word in the
sentence, which is why the protocol adds human review.

### 8.3 Deterministic rules and honest uncertainty

The guardrail analysis demonstrates a methodological principle important for
industrial AI: a labelled field is not automatically predictable from the
available measurements. HDF, PWF, and OSF are reproducible under their
verified compound rules. TWF and RNF are not. Treating all five modes as
thresholds would create an apparently complete but scientifically incorrect
system.

### 8.4 Deployment realism

The application is deployed rather than evaluated only as a notebook. This
exposes operational concerns that are invisible in an offline prototype:
serverless connection limits, secret management, health checks, backups,
authentication, and observability. The current deployment still has a
security limitation: the RDS security group permits public PostgreSQL access.
This is documented as unresolved rather than hidden.

## 9. Limitations and Threats to Validity

### 9.1 Construct validity

Sentence citation coverage is a mechanical proxy for groundedness. A cited
sentence can still overstate what its source entails, while a correct
common-sense sentence may be uncited. Human review is therefore required for
unsupported-claim analysis.

### 9.2 Internal validity

Tool availability changes the context available to the model. Configuration
5 may have more evidence and more tokens than configuration 1, so a gain
cannot be attributed solely to a particular retrieval mechanism. The protocol
holds the prompt, model, temperature, limits, and question set constant, but
context volume remains a declared confound. The agent also chooses tool order,
which is a treatment variable rather than a fixed sequence.

### 9.3 External validity

The sensor data come from one simulated milling-machine dataset. The
application uses pump-style names as a declared abstraction, and the
documents are synthetic. Results should not be generalized to real pump
failure physics, other industrial plants, or safety-critical deployment
without domain-specific data and validation.

### 9.4 Conclusion validity

Temperature-zero repeats do not eliminate provider-side or infrastructure
variance. Three repeats may be sufficient for a capstone comparison but are
not a complete characterization of model stochasticity. A small corpus and
24-question set also limit statistical power.

### 9.5 Operational limitations

The current RDS security group is publicly reachable on port 5432, although
database authentication and SSL are used. A production deployment should use
private networking, a verified fixed-egress solution, or a narrowly scoped
allowlist. Document ingestion through S3 and Inngest is implemented as an
extension path but the seeded evaluation corpus is already in PostgreSQL.

## 10. Ethical, Safety, and Security Considerations

AssetMind is a decision-support system, not an autonomous controller. It does
not issue machine commands or replace an engineer's inspection. The model is
instructed to abstain when evidence is missing and to distinguish deterministic
guardrails from irreducible random modes.

The system limits tool steps, output tokens, per-tool execution time, and
daily user token consumption. Clerk protects user conversations, and chat
records are scoped by Clerk user ID. Document text is treated as untrusted
data to reduce prompt-injection risk. Secrets are stored outside source
control, and the system must not expose the system prompt, tool schemas, or
credentials.

The AI4I license and source provenance must be retained in the final
submission. The paper should clearly distinguish public source data,
synthetic seeded documents, and generated model output.

## 11. Conclusion

AssetMind AI demonstrates a reproducible architecture for evidence-traceable
industrial fault investigation. Its central design is not a fixed RAG
pipeline, but a tool-calling agent whose available actions can be ablated
without creating separate implementations. Structured records, two retrieval
paths, and deterministic guardrails are exposed through a common registry.
Evidence is captured during execution and citations are verified against the
same-turn trace.

The implementation is validated at the data and software levels: the
deterministic guardrails reproduce the HDF, PWF, and OSF labels exactly;
database schema, pgvector, full-text search, and embeddings are operational;
automated tests and CI pass; and the deployed health endpoint reaches the
live database. The work deliberately does not overclaim comparative agent
performance before the frozen 360-run evaluation is complete.

The next empirical step is to execute the frozen grid, report means and
standard deviations for groundedness, evidence composition, guardrail use,
cost, latency, and traceability, and perform the planned human review of
uncited claims. That result will determine whether the system's agentic tool
selection provides a measurable advantage over simpler tool configurations.

## References

1. Matzka, S. (2020). *Explainable Artificial Intelligence for Predictive
   Maintenance Applications*. 2020 Third International Conference on
   Artificial Intelligence for Industries (AI4I), IEEE.
   DOI: 10.1109/AI4I49448.2020.00023.
2. Lewis, P., Perez, E., Piktus, A., Petroni, F., Karpukhin, V., Goyal, N.,
   Küttler, H., Lewis, M., Yih, W.-t., Rocktäschel, T., Riedel, S., and
   Kiela, D. (2020). Retrieval-Augmented Generation for Knowledge-Intensive
   NLP Tasks. *Advances in Neural Information Processing Systems*, 33.
3. Yao, S., Zhao, J., Yu, D., Du, N., Shafran, I., Narasimhan, K., and Cao, Y.
   (2023). ReAct: Synergizing Reasoning and Acting in Language Models.
   *International Conference on Learning Representations*.
4. Johnson, J., Douze, M., and Jégou, H. (2019). Billion-scale similarity
   search with GPUs. *IEEE Transactions on Big Data*, 7(3), 535–547.
5. AWS. (2026). *Amazon RDS for PostgreSQL documentation*. AWS documentation.
6. PostgreSQL Global Development Group. (2026). *Full Text Search and
   `tsvector` documentation*. PostgreSQL documentation.
7. AssetMind AI project repository and frozen evaluation artifacts:
   [architecture](./assetmind-ai-architecture.md),
   [evaluation protocol](./evaluation-protocol.md),
   [guardrail ADR](./adr/0002-ai4i-guardrail-rules.md), and
   [source repository](https://github.com/KumarNirupam1/AssestMind_AI).

## Appendix A. Reproduction commands

From the repository root:

```bash
npm install
npm run lint
npm run typecheck
npm test
npm run verify:questions
npm run verify:rules
npm run verify:db
npm run verify:retrieval
npm run verify:citations
npm run build
```

For a live OpenAI embedding provider:

```bash
export ASSETMIND_EMBED_PROVIDER=openai
export OPENAI_API_KEY='provided through a local secret mechanism'
npm run embed:backfill
npm run verify:retrieval
```

The full evaluation is governed by
[`docs/evaluation-protocol.md`](./evaluation-protocol.md). It must not be
modified to fit observed results after execution.

## Appendix B. Paper evidence map

| Paper claim | Repository evidence |
|---|---|
| Tool registry is shared | `lib/agent/registry.ts` |
| Prompt is versioned | `lib/agent/prompts.ts` |
| Guardrail formulas | `features/guardrails/rules.ts` |
| Guardrail row-by-row verification | `scripts/verify-guardrail-rules.mjs` |
| Retrieval query builders | `features/ingestion/retrieval.ts` |
| Evidence and citations | `features/evaluation/metrics.ts`, `lib/agent/chat-store.ts` |
| Frozen configurations | `features/evaluation/question-set.ts` |
| Frozen protocol | `docs/evaluation-protocol.md` |
| Database schema | `prisma/schema.prisma` |
| Automated tests | `**/*.test.ts` |
| Deployment health | `app/api/health/route.ts` |
