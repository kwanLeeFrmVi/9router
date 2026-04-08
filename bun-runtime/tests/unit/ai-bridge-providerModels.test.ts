/**
 * Unit tests for ai-bridge/config/providerModels.ts
 * Covers: getProviderModels, getDefaultModel, isValidModel, findModelName,
 * getModelTargetFormat, getModelsByProviderId
 */

import { describe, it, expect } from "bun:test";
import {
  getProviderModels,
  getDefaultModel,
  isValidModel,
  findModelName,
  getModelTargetFormat,
  getModelsByProviderId,
  PROVIDER_MODELS,
  PROVIDER_ID_TO_ALIAS,
} from "../../ai-bridge/config/providerModels.ts";

// ─── getProviderModels ────────────────────────────────────────────────────────

describe("getProviderModels", () => {
  it("returns models for a known provider alias (openai)", () => {
    const models = getProviderModels("openai");
    expect(models.length).toBeGreaterThan(0);
    expect(models.some(m => m.id === "gpt-4o")).toBe(true);
  });

  it("returns models for OAuth alias (cc)", () => {
    const models = getProviderModels("cc");
    expect(models.length).toBeGreaterThan(0);
    expect(models.some(m => m.id === "claude-opus-4-6")).toBe(true);
  });

  it("returns empty array for unknown provider", () => {
    expect(getProviderModels("nonexistent")).toHaveLength(0);
  });
});

// ─── getDefaultModel ──────────────────────────────────────────────────────────

describe("getDefaultModel", () => {
  it("returns the first model for a known provider", () => {
    const model = getDefaultModel("openai");
    expect(model).toBe(PROVIDER_MODELS.openai[0].id);
  });

  it("returns null for unknown provider", () => {
    expect(getDefaultModel("nonexistent")).toBeNull();
  });
});

// ─── isValidModel ──────────────────────────────────────────────────────────────

describe("isValidModel", () => {
  it("returns true for a known provider + model pair", () => {
    expect(isValidModel("openai", "gpt-4o")).toBe(true);
  });

  it("returns false for a known provider + unknown model", () => {
    expect(isValidModel("openai", "fake-model-xyz")).toBe(false);
  });

  it("returns false for unknown provider", () => {
    expect(isValidModel("nonexistent", "anything")).toBe(false);
  });

  it("returns true for any model when provider is in passthroughProviders", () => {
    const passthrough = new Set(["custom"]);
    expect(isValidModel("custom", "any-model", passthrough)).toBe(true);
  });
});

// ─── findModelName ────────────────────────────────────────────────────────────

describe("findModelName", () => {
  it("returns the human-readable name for a known model", () => {
    expect(findModelName("openai", "gpt-4o")).toBe("GPT-4o");
  });

  it("returns the model id when model is not found", () => {
    expect(findModelName("openai", "fake-model")).toBe("fake-model");
  });

  it("returns the model id when provider is unknown", () => {
    expect(findModelName("nonexistent", "test-model")).toBe("test-model");
  });
});

// ─── getModelTargetFormat ─────────────────────────────────────────────────────

describe("getModelTargetFormat", () => {
  it("returns null for models without a targetFormat override", () => {
    // Most models don't have targetFormat set
    expect(getModelTargetFormat("openai", "gpt-4o")).toBeNull();
  });

  it("returns null for unknown provider", () => {
    expect(getModelTargetFormat("nonexistent", "model")).toBeNull();
  });

  it("returns targetFormat when set on model entry", () => {
    // Check if any model has targetFormat set
    for (const [alias, models] of Object.entries(PROVIDER_MODELS)) {
      for (const m of models) {
        if (m.targetFormat) {
          const result = getModelTargetFormat(alias, m.id);
          expect(result).toBe(m.targetFormat);
          return;
        }
      }
    }
    // If no model has targetFormat, this test passes vacuously
    expect(true).toBe(true);
  });
});

// ─── getModelsByProviderId ────────────────────────────────────────────────────

describe("getModelsByProviderId", () => {
  it("resolves OAuth provider id to alias and returns models", () => {
    const models = getModelsByProviderId("claude");
    expect(models).toEqual(getProviderModels("cc"));
  });

  it("returns models for provider id that matches alias directly", () => {
    const models = getModelsByProviderId("openai");
    expect(models.length).toBeGreaterThan(0);
  });

  it("returns empty array for unknown provider id", () => {
    expect(getModelsByProviderId("nonexistent")).toHaveLength(0);
  });
});

// ─── PROVIDER_ID_TO_ALIAS ─────────────────────────────────────────────────────

describe("PROVIDER_ID_TO_ALIAS", () => {
  it("maps claude → cc", () => {
    expect(PROVIDER_ID_TO_ALIAS.claude).toBe("cc");
  });

  it("maps codex → cx", () => {
    expect(PROVIDER_ID_TO_ALIAS.codex).toBe("cx");
  });

  it("maps gemini-cli → gc", () => {
    expect(PROVIDER_ID_TO_ALIAS["gemini-cli"]).toBe("gc");
  });

  it("maps cursor → cu", () => {
    expect(PROVIDER_ID_TO_ALIAS.cursor).toBe("cu");
  });
});