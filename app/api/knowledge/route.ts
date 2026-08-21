import { askMiniMax } from "@/lib/minimax";
import { readSources, type StoredSource } from "@/lib/source-store";
import { readKnowledge, writeKnowledge, type CitationRef, type KnowledgeArtifacts, type MindNode } from "@/lib/knowledge-store";
import { assertNotebookAccess } from "@/lib/notebook-store";
import { AuthError, requireRequestUser } from "@/lib/auth-store";
import { consumeAiRequest } from "@/lib/quota-store";

function sourceSignature(sources: StoredSource[]) {
  return sources.map((source) => `${source.id}:${source.version || 1}:${source.updatedAt || source.createdAt}:${source.segments.length}`).join("|");
}

function buildContext(sources: StoredSource[]) {
  return sources.slice(0, 12).flatMap((source, sourceIndex) => source.segments.slice(0, 10).map((segment, segmentIndex) => ({
    token: `S${sourceIndex + 1}:C${segmentIndex + 1}`,
    source,
    segment,
  })));
}

function parseJson(raw: string) {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("知识产物不是有效 JSON");
  return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> { return value && typeof value === "object" ? value as Record<string, unknown> : {}; }

function normalizeArtifacts(raw: Record<string, unknown>, context: ReturnType<typeof buildContext>, signature: string): KnowledgeArtifacts {
  const referenceMap = new Map(context.map((item) => [item.token, { sourceId: item.source.id, segmentId: item.segment.id }]));
  const citations = (value: unknown): CitationRef[] => Array.isArray(value)
    ? value.map((item) => referenceMap.get(String(item).replaceAll("[", "").replaceAll("]", ""))).filter((item): item is CitationRef => Boolean(item)).slice(0, 5)
    : [];
  const citedText = (value: unknown) => { const item = asRecord(value); return { text: String(item.text || "").slice(0, 1200), citations: citations(item.citations) }; };
  const mindNode = (value: unknown, depth = 0): MindNode => { const item = asRecord(value); return ({
    label: String(item.label || (depth ? "主题" : "知识地图")).slice(0, 100),
    note: item.note ? String(item.note).slice(0, 300) : undefined,
    citations: citations(item.citations),
    children: depth >= 2 || !Array.isArray(item.children) ? [] : item.children.slice(0, 7).map((child) => mindNode(child, depth + 1)),
  }); };
  const summary = asRecord(raw.summary);
  return {
    generatedAt: new Date().toISOString(),
    sourceSignature: signature,
    summary: {
      title: String(summary.title || "知识库概览").slice(0, 120),
      overview: String(summary.overview || "已完成资料分析。").slice(0, 1800),
      points: Array.isArray(summary.points) ? summary.points.slice(0, 8).map(citedText) : [],
    },
    mindmap: mindNode(raw.mindmap),
    cards: Array.isArray(raw.cards) ? raw.cards.slice(0, 12).map((value) => { const item = asRecord(value); return { question: String(item.question || "").slice(0, 300), answer: String(item.answer || "").slice(0, 900), citations: citations(item.citations) }; }).filter((item) => item.question && item.answer) : [],
    wiki: Array.isArray(raw.wiki) ? raw.wiki.slice(0, 10).map((value) => { const item = asRecord(value); return { title: String(item.title || "条目").slice(0, 120), content: String(item.content || "").slice(0, 1800), citations: citations(item.citations) }; }).filter((item) => item.content) : [],
  };
}

export async function GET(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const { notebook } = await assertNotebookAccess(new URL(request.url).searchParams.get("notebookId"), user.id);
    const sources = (await readSources(notebook.id)).filter((source) => source.enabled !== false);
    const knowledge = await readKnowledge(notebook.id);
    return Response.json({ knowledge, stale: Boolean(knowledge && knowledge.sourceSignature !== sourceSignature(sources)) });
  } catch (error) { return routeError(error); }
}

export async function POST(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const { notebook } = await assertNotebookAccess(new URL(request.url).searchParams.get("notebookId"), user.id, "edit");
    const sources = (await readSources(notebook.id)).filter((source) => source.enabled !== false);
    if (!sources.length) return Response.json({ error: "请先导入资料" }, { status: 400 });
    const signature = sourceSignature(sources);
    const existing = await readKnowledge(notebook.id);
    if (existing?.sourceSignature === signature) return Response.json({ knowledge: existing, stale: false });
    await consumeAiRequest(user.id);
    const context = buildContext(sources);
    const sourceText = context.map((item) => `[${item.token}] ${item.source.title} / ${item.segment.label}\n${item.segment.text.slice(0, 1400)}`).join("\n\n---\n\n");
    const prompt = `根据下面资料生成可持续更新的知识工作台。JSON 必须严格符合：\n{"summary":{"title":"...","overview":"...","points":[{"text":"...","citations":["S1:C1"]}]},"mindmap":{"label":"...","note":"...","citations":[],"children":[{"label":"...","note":"...","citations":["S1:C1"],"children":[]}]},"cards":[{"question":"...","answer":"...","citations":["S1:C1"]}],"wiki":[{"title":"...","content":"...","citations":["S1:C1"]}]}\n要求：摘要 4-8 个要点；思维导图两层、覆盖主要概念；记忆卡 6-12 张；Wiki 3-8 个条目并整合跨来源信息。\n\n资料：\n${sourceText}`;
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const raw = await askMiniMax([
          { role: "system", content: "你是知识架构师。只输出一个合法 JSON 对象，不要代码围栏、解释或思考过程。所有事实必须来自给定片段，并使用片段标识作为 citations。不要编造引用。" },
          { role: "user", content: `${prompt}${attempt ? "\n\n上一次输出无法解析。请缩短文字并再次确保 JSON 完整、所有字符串正确转义。" : ""}` },
        ], { temperature: attempt ? 0.1 : 0.25, maxTokens: 6000 });
        const knowledge = normalizeArtifacts(parseJson(raw), context, signature);
        await writeKnowledge(knowledge, notebook.id);
        return Response.json({ knowledge, stale: false });
      } catch (error) { lastError = error; }
    }
    throw lastError;
  } catch (error) { return routeError(error); }
}

function routeError(error: unknown) {
  const status = error instanceof AuthError ? error.status : (error instanceof Error && error.message.startsWith("无权") ? 403 : 500);
  return Response.json({ error: error instanceof Error ? error.message : "请求失败" }, { status });
}
