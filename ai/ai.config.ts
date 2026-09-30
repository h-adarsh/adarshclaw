import {createOpenRouter} from "@openrouter/ai-sdk-provider";

export function getAgentModel(){
  
const provider = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});
const modelId = process.env.OPEN_ROUTER_DEFAULT_MODEL || "openrouter/free";

return provider(modelId)

}