import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request("http://localhost/", { headers: { accept: "text/html" } }), {
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  }, { waitUntil() {}, passThroughOnException() {} });
}

test("server-renders the Nota knowledge workspace", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /Nota — 让资料，成为答案/);
  assert.match(html, /与资料对话/);
  assert.match(html, /自动摘要/);
  assert.match(html, /思维导图/);
  assert.match(html, /记忆卡/);
  assert.match(html, /Wiki/);
  assert.match(html, /\.pptx/);
  assert.match(html, /可点击定位的引用/);
});

test("keeps source citations and generated knowledge wired to APIs", async () => {
  const [page, sourceRoute, chatRoute, knowledgeRoute, parser] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/sources/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/chat/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/knowledge/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/document-parser.ts", import.meta.url), "utf8"),
  ]);
  assert.match(page, /openSource\(citation\.sourceId, citation\.segmentId\)/);
  assert.match(page, /\/api\/knowledge/);
  assert.match(sourceRoute, /originalFile/);
  assert.match(chatRoute, /sourceIndex \+ 1/);
  assert.match(knowledgeRoute, /mindmap/);
  assert.match(knowledgeRoute, /cards/);
  assert.match(knowledgeRoute, /wiki/);
  assert.match(parser, /parsePptx/);
  assert.match(parser, /parseXlsx/);
  assert.match(parser, /parseEpub/);
});

test("scopes sources, chat, knowledge and original files to a notebook", async () => {
  const [page, notebooks, sources, chat, knowledge, files, store] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/notebooks/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/sources/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/chat/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/knowledge/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/sources/file/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/source-store.ts", import.meta.url), "utf8"),
  ]);
  assert.match(page, /createNotebook/);
  assert.match(page, /switchNotebook/);
  assert.match(page, /notebookId: activeNotebookId/);
  assert.match(notebooks, /crypto\.randomUUID/);
  assert.match(sources, /readSources\(notebookId\)/);
  assert.match(chat, /readSources\(notebook\.id\)/);
  assert.match(knowledge, /readKnowledge\(notebook\.id\)/);
  assert.match(files, /readSources\(notebook\.id\)/);
  assert.match(store, /join\(dataDirectory, "notebooks", id\)/);
});
