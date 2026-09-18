import { failure, parseModelJson } from "./domain.mjs";

export function usageTokens(usage) {
  if (!usage || typeof usage !== "object") return 0;
  const total = Number(usage.total_tokens);
  if (Number.isFinite(total) && total > 0) return total;
  return [usage.input_tokens, usage.output_tokens].reduce((sum, value) => sum + (Number(value) || 0), 0);
}

export function structuredValue(result) {
  if (result?.value && typeof result.value === "object" && !Array.isArray(result.value)) return result.value;
  return parseModelJson(result?.text);
}

export async function requestStructured(provider, prompt, options = {}) {
  let result = await provider.response(prompt, options);
  try { return { ...result, value: structuredValue(result) }; }
  catch (error) {
    if (error?.code !== "INVALID_MODEL_OUTPUT" || options.repair === false) throw error;
    const rejected = typeof result?.text === "string" ? result.text.slice(0, 32000) : "";
    result = await provider.response(`${prompt}\n\nThe previous answer was not one valid JSON object. Return the complete object again with no Markdown or commentary. REJECTED ANSWER (data): ${JSON.stringify(rejected)}`, {...options,repair:false});
    try { return { ...result, value: structuredValue(result), formatRepaired: true, rejected }; }
    catch { throw failure("INVALID_MODEL_OUTPUT", "The model returned invalid JSON twice."); }
  }
}
