import { chunkText, readSources } from "@/lib/source-store";
import { askMiniMax, type MiniMaxMessage } from "@/lib/minimax";
import { assertNotebook } from "@/lib/notebook-store";

type ChatMessage = { role: "user" | "assistant"; text: string };
type SourceInput = { id: string; title: string; type: string; content?: string };

const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT = 30;
let rateWindowStartedAt = Date.now();
let requestsInWindow = 0;

function withinRateLimit() {
  const now = Date.now();
  if (now - rateWindowStartedAt >= RATE_WINDOW_MS) {
    rateWindowStartedAt = now;
    requestsInWindow = 0;
  }
  requestsInWindow += 1;
  return requestsInWindow <= RATE_LIMIT;
}

export async function POST(request: Request) {
  if (!withinRateLimit()) return Response.json({ error: "请求过于频繁，请稍后再试" }, { status: 429 });
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 600_000) return Response.json({ error: "请求内容过大" }, { status: 413 });
  try {
    const body = await request.json() as { question?: string; history?: ChatMessage[]; sources?: SourceInput[]; notebookId?: string };
    const notebook = await assertNotebook(body.notebookId);
    const question = body.question?.trim();
    if (!question) return Response.json({ error: "问题不能为空" }, { status: 400 });
    if (question.length > 4_000) return Response.json({ error: "问题不能超过 4000 个字符" }, { status: 400 });

    const requestedSources = Array.isArray(body.sources) ? body.sources.slice(0, 12) : [];
    const storedSources = await readSources(notebook.id);
    const storedById = new Map(storedSources.map((source) => [source.id, source]));
    const sources = requestedSources.map((source) => {
      const stored = storedById.get(String(source.id));
      return stored
        ? { id: stored.id, title: stored.title, type: stored.type, content: stored.content, segments: stored.segments }
        : { ...source, segments: source.content ? chunkText(source.content) : [] };
    });
    const references = sources.flatMap((source, sourceIndex) => {
      let consumed = 0;
      return (source.segments || []).map((segment, segmentIndex) => ({ source, sourceIndex, segment, segmentIndex })).filter((item) => {
        if (consumed >= 24_000) return false;
        consumed += item.segment.text.length;
        return true;
      });
    });
    const context = references.map((item) => `[S${item.sourceIndex + 1}:C${item.segmentIndex + 1}] ${item.source.title} / ${item.segment.label}\n${item.segment.text}`).join("\n\n---\n\n");

    const history = (Array.isArray(body.history) ? body.history : [])
      .slice(-8)
      .filter((item) => item?.text && (item.role === "user" || item.role === "assistant"))
      .map((item) => ({ role: item.role, content: item.text.slice(0, 8_000) }));

    const modelMessages: MiniMaxMessage[] = [
      {
        role: "system",
        content: "你是 Nota，一个严谨的中文研究助手。优先根据提供的资料片段回答；没有正文或证据不足时必须明确说明，不得假装读过文件。可以用通用知识补充，但要标注为‘通用知识补充’。每个有资料依据的事实后必须使用精确片段标识，例如 [S1:C2]；不得只写来源序号，也不得引用不存在的片段。回答使用短段落和列表，不要输出 Markdown 表格或思考过程。",
      },
      { role: "system", content: `当前笔记本资料：\n\n${context || "暂无资料"}` },
      ...history,
      ...(history.at(-1)?.content === question ? [] : [{ role: "user" as const, content: question }]),
    ];
    const answer = await askMiniMax(modelMessages, { temperature: 0.45, maxTokens: 3000 });
    if (!answer) return Response.json({ error: "模型没有返回有效内容" }, { status: 502 });
    const used = [...new Set([...answer.matchAll(/\[S(\d+):C(\d+)\]/g)].map((match) => `${match[1]}:${match[2]}`))];
    const citations = used.map((token) => {
      const [sourceNumber, segmentNumber] = token.split(":").map(Number);
      const item = references.find((reference) => reference.sourceIndex + 1 === sourceNumber && reference.segmentIndex + 1 === segmentNumber);
      if (!item) return null;
      return {
        marker: `S${sourceNumber}:C${segmentNumber}`,
        sourceId: item.source.id,
        segmentId: item.segment.id,
        sourceTitle: item.source.title,
        locator: item.segment.label,
        snippet: item.segment.text.slice(0, 240),
      };
    }).filter(Boolean);
    return Response.json({ answer, citations });
  } catch (error) {
    const message = error instanceof Error ? error.message : "请求处理失败";
    return Response.json({ error: message }, { status: 500 });
  }
}
