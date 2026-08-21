const API_URL = "https://api.minimax.io/v1/chat/completions";

export type MiniMaxMessage = { role: "system" | "user" | "assistant"; content: string };

export async function askMiniMax(messages: MiniMaxMessage[], options?: { temperature?: number; maxTokens?: number }) {
  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) throw new Error("服务器尚未配置 MiniMax API Key");
  const response = await fetch(API_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.MINIMAX_MODEL || "MiniMax-M2.7",
      temperature: options?.temperature ?? 0.45,
      max_completion_tokens: options?.maxTokens ?? 3000,
      messages,
    }),
  });
  const result = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
    base_resp?: { status_code?: number; status_msg?: string };
    error?: { message?: string };
  };
  if (!response.ok || result.base_resp?.status_code) {
    throw new Error(result.error?.message || result.base_resp?.status_msg || `MiniMax API 返回 ${response.status}`);
  }
  return (result.choices?.[0]?.message?.content || "").replace(/<think>[\s\S]*?<\/think>\s*/gi, "").trim();
}
