/**
 * Fixture model catalog, mirroring backend/app/agent/llm/catalog.py.
 *
 * Includes one unavailable provider so the picker's greyed-out rows can be
 * built and reviewed without reconfiguring the harness.
 */

import type { ModelCatalog } from "@/lib/models";

export const MOCK_MODEL_CATALOG: ModelCatalog = {
  provider: "anthropic",
  default: "claude-opus-5",
  pricing_as_of: "2026-06-24",
  models: [
    {
      id: "claude-fable-5",
      label: "Fable 5",
      provider: "anthropic",
      description:
        "Anthropic's most capable model, for demanding reasoning and long-horizon agentic work. Thinking is always on.",
      context_tokens: 1_000_000,
      input_per_mtok: 10,
      output_per_mtok: 50,
      available: true,
      default: false,
    },
    {
      id: "claude-opus-5",
      label: "Opus 5",
      provider: "anthropic",
      description:
        "The default. Deep reasoning with adaptive thinking on by default, and the best all-round choice for tool use.",
      context_tokens: 1_000_000,
      input_per_mtok: 5,
      output_per_mtok: 25,
      available: true,
      default: true,
    },
    {
      id: "claude-sonnet-5",
      label: "Sonnet 5",
      provider: "anthropic",
      description:
        "Most of Opus's capability at a lower price. A good fit for high-volume turns where cost matters more than depth.",
      context_tokens: 1_000_000,
      input_per_mtok: 2,
      output_per_mtok: 10,
      available: true,
      default: false,
    },
    {
      id: "claude-haiku-4-5",
      label: "Haiku 4.5",
      provider: "anthropic",
      description:
        "Fastest and cheapest. Best for simple, speed-critical turns rather than multi-step tool work.",
      context_tokens: 200_000,
      input_per_mtok: 1,
      output_per_mtok: 5,
      available: true,
      default: false,
    },
    {
      id: "gpt-4o",
      label: "GPT-4o",
      provider: "openai",
      description: "OpenAI's general-purpose multimodal model.",
      context_tokens: 128_000,
      input_per_mtok: null,
      output_per_mtok: null,
      available: false,
      default: false,
    },
  ],
};
