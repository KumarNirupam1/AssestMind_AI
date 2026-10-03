import { describe, expect, it } from "vitest";

import {
  CONFIG_LABELS,
  CONFIG_OPTIONS,
  configToolCount,
  isToolConfigKey,
} from "@/features/chat/config";
import { TOOL_CONFIGS_FROZEN, TOOL_CONFIG_KEYS } from "@/features/evaluation/question-set.ts";

describe("chat config selector wiring", () => {
  it("exposes exactly the FROZEN config keys, in order", () => {
    expect(CONFIG_OPTIONS).toEqual([...TOOL_CONFIG_KEYS]);
  });

  it("labels every FROZEN config", () => {
    for (const key of TOOL_CONFIG_KEYS) {
      expect(CONFIG_LABELS[key]).toBeTruthy();
    }
  });

  it("derives tool counts from the FROZEN registry, never a re-declaration", () => {
    for (const key of TOOL_CONFIG_KEYS) {
      expect(configToolCount(key)).toBe(TOOL_CONFIGS_FROZEN[key].length);
    }
    // The frozen subsets are strict: 1 has none, 5 has all six.
    expect(configToolCount(1)).toBe(0);
    expect(configToolCount(5)).toBe(6);
  });

  it("validates config ids", () => {
    for (const key of TOOL_CONFIG_KEYS) expect(isToolConfigKey(key)).toBe(true);
    expect(isToolConfigKey(0)).toBe(false);
    expect(isToolConfigKey(6)).toBe(false);
    expect(isToolConfigKey("5")).toBe(false);
    expect(isToolConfigKey(undefined)).toBe(false);
  });
});