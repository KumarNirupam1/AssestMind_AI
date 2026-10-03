import { describe, expect, it } from "vitest";

import { getSystemPrompt, SYSTEM_PROMPT_VERSION } from "@/lib/agent/prompts";

describe("system prompt", () => {
  it("is versioned so runs can attribute their exact text", () => {
    expect(SYSTEM_PROMPT_VERSION).toBe("v1");
  });

  it("documents the six FROZEN tools", () => {
    const prompt = getSystemPrompt();
    for (const name of [
      "searchDocumentsVector",
      "searchDocumentsKeyword",
      "getAssetContext",
      "getFaultHistory",
      "getMaintenanceHistory",
      "checkGuardrails",
    ]) {
      expect(prompt).toContain(name);
    }
  });

  it("mandates the machine-checkable citation format", () => {
    const prompt = getSystemPrompt();
    expect(prompt).toContain("[chunk:");
    expect(prompt).toContain("[fault:");
    expect(prompt).toContain("[guardrail:");
    expect(prompt).toMatch(/chunkId.*ordinal/);
  });

  it("forbids inventing ids and citing evidence outside the turn", () => {
    const prompt = getSystemPrompt();
    expect(prompt).toMatch(/invented or mismatched ids/i);
    expect(prompt).toMatch(/actually in the tool results/i);
  });

  it("grounds every factual claim in tool results", () => {
    const prompt = getSystemPrompt();
    expect(prompt).toMatch(/traceable to a tool result/i);
    expect(prompt).toMatch(/outside or training knowledge/i);
  });

  it("is honest about TWF/RNF not being threshold rules", () => {
    const prompt = getSystemPrompt();
    expect(prompt).toMatch(/TWF/);
    expect(prompt).toMatch(/RNF/);
    expect(prompt).toMatch(/NOT threshold rules/i);
    expect(prompt).toMatch(/never invent a threshold/i);
  });

  it("treats document content as untrusted data, never instructions", () => {
    const prompt = getSystemPrompt();
    expect(prompt).toMatch(/untrusted text/i);
    expect(prompt).toMatch(/ignore your instructions/i);
  });

  it("tells the answer to abstain rather than speculate", () => {
    const prompt = getSystemPrompt();
    expect(prompt).toMatch(/wrong asset name/i);
    expect(prompt).toMatch(/do not speculate/i);
  });
});