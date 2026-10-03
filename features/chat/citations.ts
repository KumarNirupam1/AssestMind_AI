/**
 * Tokenizer for the machine-checkable citation syntax the model is
 * instructed to emit: `[chunk:<id>#<n>]`, `[fault:<id>]`,
 * `[guardrail:<MODE>]`.
 *
 * Pure and UI-free so the accept/reject cases are unit-testable.
 */

export type CitationToken = {
  kind: "chunk" | "fault" | "guardrail";
  /** For chunk: `<id>#<ordinal>`; for fault: `<id>`; for guardrail: `<mode>`. */
  value: string;
};

export type CitationSegment =
  | { type: "text"; text: string }
  | { type: "citation"; token: CitationToken; raw: string };

const CITATION_RE =
  /\[((?:chunk:[A-Za-z0-9_-]+#\d+)|(?:fault:[A-Za-z0-9_-]+)|(?:guardrail:[A-Z]{3}))\]/g;

function parseToken(raw: string): CitationToken {
  if (raw.startsWith("chunk:")) {
    return { kind: "chunk", value: raw.slice("chunk:".length) };
  }
  if (raw.startsWith("fault:")) {
    return { kind: "fault", value: raw.slice("fault:".length) };
  }
  return { kind: "guardrail", value: raw.slice("guardrail:".length) };
}

export function splitCitations(text: string): CitationSegment[] {
  const segments: CitationSegment[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(CITATION_RE)) {
    const index = match.index ?? 0;
    if (index > lastIndex) segments.push({ type: "text", text: text.slice(lastIndex, index) });
    const raw = match[1];
    segments.push({ type: "citation", token: parseToken(raw), raw });
    lastIndex = index + match[0].length;
  }
  if (lastIndex < text.length) segments.push({ type: "text", text: text.slice(lastIndex) });
  return segments;
}