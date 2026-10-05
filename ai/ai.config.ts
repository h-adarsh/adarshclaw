import {createOpenRouter} from "@openrouter/ai-sdk-provider";

export function getAgentModel(){
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    // Say it clearly, instead of failing later inside the first request.
    throw new Error("OPENROUTER_API_KEY is not set.");
  }

  const provider = createOpenRouter({ apiKey });
  const modelId = process.env.OPEN_ROUTER_DEFAULT_MODEL || "openrouter/free";

  return provider(modelId)
}