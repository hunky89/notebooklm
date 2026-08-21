"use client";

/* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events */

import { ChangeEvent, FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";

type Source = { id: string; type: string; title: string; meta: string; color: string; url?: string; enabled?: boolean; labels?: string[]; version?: number };
type Citation = { marker?: string; sourceId: string; segmentId: string; sourceTitle?: string; locator?: string; snippet?: string };
type Message = { role: "user" | "assistant"; text: string; citations?: Citation[] };
type SourceDetail = Source & { originalUrl?: string; segments: Array<{ id: string; label: string; text: string }> };
type MindNode = { label: string; note?: string; citations: Citation[]; children: MindNode[] };
type Knowledge = {
  generatedAt: string;
  summary: { title: string; overview: string; points: Array<{ text: string; citations: Citation[] }> };
  mindmap: MindNode;
  cards: Array<{ question: string; answer: string; citations: Citation[] }>;
  wiki: Array<{ title: string; content: string; citations: Citation[] }>;
};
type WorkspaceView = "chat" | "notes" | "summary" | "mindmap" | "cards" | "wiki";
type Notebook = { id: string; name: string; createdAt: string; updatedAt: string };
type AuthUser = { id: string; email: string; displayName: string };
type Conversation = { id: string; title: string; messages?: Message[]; messageCount?: number; preview?: string; selectedSourceIds: string[]; updatedAt: string };
type Note = { id: string; title: string; content: string; citations: Citation[]; updatedAt: string };
type SourceGuide = { sourceId: string; generatedAt: string; summary: string; topics: string[]; entities: string[]; outline: string[]; suggestedQuestions: string[] };
type NotebookSettings = { language: string; answerLength: "short" | "balanced" | "detailed"; audience: string; style: string; strictCitations: boolean; allowGeneralKnowledge: boolean; customInstructions: string };

const initialSources: Source[] = [];

const suggestions = [
  { icon: "⌁", title: "提炼核心洞察", note: "总结所有资料的关键结论" },
  { icon: "◇", title: "比较观点差异", note: "找出来源之间的一致与分歧" },
  { icon: "☷", title: "生成研究简报", note: "整理成结构清晰的报告" },
  { icon: "◎", title: "发现新的问题", note: "从资料中寻找研究方向" },
];

export default function Home() {
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authName, setAuthName] = useState("");
  const [authError, setAuthError] = useState("");
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [activeNotebookId, setActiveNotebookId] = useState("default");
  const [sources, setSources] = useState(initialSources);
  const [query, setQuery] = useState("");
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [notebookModalOpen, setNotebookModalOpen] = useState(false);
  const [notebookName, setNotebookName] = useState("");
  const [urlValue, setUrlValue] = useState("");
  const [toast, setToast] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [activeView, setActiveView] = useState<WorkspaceView>("chat");
  const [knowledge, setKnowledge] = useState<Knowledge | null>(null);
  const [knowledgeLoading, setKnowledgeLoading] = useState(false);
  const [selectedSource, setSelectedSource] = useState<SourceDetail | null>(null);
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null);
  const [flippedCards, setFlippedCards] = useState<number[]>([]);
  const [openWiki, setOpenWiki] = useState(0);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [noteDraft, setNoteDraft] = useState({ title: "", content: "" });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<NotebookSettings>({ language: "中文", answerLength: "balanced", audience: "通用读者", style: "清晰、严谨", strictCitations: true, allowGeneralKnowledge: false, customInstructions: "" });
  const [sourceGuide, setSourceGuide] = useState<SourceGuide | null>(null);
  const [guideLoading, setGuideLoading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const activeNotebookRef = useRef("default");
  const notebookLoadSequence = useRef(0);
  const activeNotebook = notebooks.find((item) => item.id === activeNotebookId) || { id: "default", name: "AI 产品研究" };

  const filteredSources = useMemo(
    () => sources.filter((source) => source.title.toLowerCase().includes(query.toLowerCase())),
    [query, sources],
  );

  async function loadNotebookList() {
    try {
      const response = await fetch("/api/notebooks");
      if (response.status === 401) { setAuthUser(null); return; }
      const data = await response.json() as { notebooks?: Notebook[] };
      const items = Array.isArray(data.notebooks) ? data.notebooks : [];
      setNotebooks(items);
      const saved = window.localStorage.getItem("nota-active-notebook");
      const id = items.some((item) => item.id === saved) ? saved! : (items[0]?.id || "default");
      activeNotebookRef.current = id;
      setActiveNotebookId(id);
      void loadNotebook(id);
    } catch { notify("暂时无法读取笔记本"); }
    finally { setAuthLoading(false); }
  }

  useEffect(() => {
    fetch("/api/auth").then((response) => response.json()).then((data: { user?: AuthUser | null; needsSetup?: boolean }) => {
      setNeedsSetup(Boolean(data.needsSetup));
      setAuthUser(data.user || null);
      if (data.user) void loadNotebookList();
      else setAuthLoading(false);
    }).catch(() => { setAuthError("暂时无法连接认证服务"); setAuthLoading(false); });
    // Initial authentication/bootstrap is intentionally run once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submitAuth(event: FormEvent) {
    event.preventDefault();
    setAuthError("");
    setAuthLoading(true);
    try {
      const response = await fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: needsSetup ? "setup" : "login", email: authEmail, password: authPassword, displayName: authName }) });
      const data = await response.json() as { user?: AuthUser; error?: string };
      if (!response.ok || !data.user) throw new Error(data.error || "登录失败");
      setAuthUser(data.user);
      setNeedsSetup(false);
      setAuthPassword("");
      await loadNotebookList();
    } catch (error) { setAuthError(error instanceof Error ? error.message : "登录失败"); setAuthLoading(false); }
  }

  async function logout() {
    await fetch("/api/auth", { method: "DELETE" });
    setAuthUser(null);
    setNotebooks([]);
    setSources([]);
    setKnowledge(null);
    setMessages([]);
  }

  function notebookQuery(notebookId = activeNotebookId) {
    return `notebookId=${encodeURIComponent(notebookId)}`;
  }

  async function loadNotebook(notebookId: string) {
    activeNotebookRef.current = notebookId;
    const loadSequence = ++notebookLoadSequence.current;
    setSources([]);
    setKnowledge(null);
    setMessages([]);
    setIsThinking(false);
    setKnowledgeLoading(false);
    setSelectedSource(null);
    setActiveView("chat");
    try {
      const query = notebookQuery(notebookId);
      const [sourceData, knowledgeData, conversationData, noteData, settingsData] = await Promise.all([
        fetch(`/api/sources?${query}`).then((response) => response.json()),
        fetch(`/api/knowledge?${query}`).then((response) => response.json()),
        fetch(`/api/conversations?${query}`).then((response) => response.json()),
        fetch(`/api/notes?${query}`).then((response) => response.json()),
        fetch(`/api/settings?${query}`).then((response) => response.json()),
      ]) as [{ sources?: Source[] }, { knowledge?: Knowledge; stale?: boolean }, { conversations?: Conversation[] }, { notes?: Note[] }, { settings?: NotebookSettings }];
      if (loadSequence !== notebookLoadSequence.current || activeNotebookRef.current !== notebookId) return;
      const loadedSources = Array.isArray(sourceData.sources) ? sourceData.sources : [];
      setSources(loadedSources);
      setKnowledge(knowledgeData.knowledge || null);
      setConversations(conversationData.conversations || []);
      setActiveConversationId(null);
      setNotes(noteData.notes || []);
      if (settingsData.settings) setSettings(settingsData.settings);
      if (loadedSources.some((source) => source.enabled !== false) && (!knowledgeData.knowledge || knowledgeData.stale)) void refreshKnowledge(notebookId);
    } catch { notify("暂时无法读取该笔记本"); }
  }

  function switchNotebook(notebookId: string) {
    if (notebookId === activeNotebookId) return;
    setActiveNotebookId(notebookId);
    activeNotebookRef.current = notebookId;
    window.localStorage.setItem("nota-active-notebook", notebookId);
    void loadNotebook(notebookId);
  }

  async function createNotebook(event?: FormEvent) {
    event?.preventDefault();
    const name = notebookName.trim();
    if (!name) return;
    const response = await fetch("/api/notebooks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
    const data = await response.json() as { notebook?: Notebook; error?: string };
    if (!response.ok || !data.notebook) return notify(data.error || "笔记本创建失败");
    setNotebooks((items) => [data.notebook!, ...items]);
    setActiveNotebookId(data.notebook.id);
    activeNotebookRef.current = data.notebook.id;
    window.localStorage.setItem("nota-active-notebook", data.notebook.id);
    await loadNotebook(data.notebook.id);
    setNotebookName("");
    setNotebookModalOpen(false);
    notify(`已创建「${data.notebook.name}」`);
  }

  async function manageNotebook() {
    const choice = window.prompt("输入新名称可重命名；输入 DELETE 可删除当前笔记本", activeNotebook.name)?.trim();
    if (!choice) return;
    if (choice === "DELETE") {
      if (activeNotebookId === "default") return notify("默认笔记本不能删除");
      if (!window.confirm(`确定删除「${activeNotebook.name}」及其中全部资料吗？`)) return;
      const response = await fetch(`/api/notebooks?id=${encodeURIComponent(activeNotebookId)}`, { method: "DELETE" });
      const data = await response.json() as { notebooks?: Notebook[]; error?: string };
      if (!response.ok || !data.notebooks) return notify(data.error || "删除失败");
      setNotebooks(data.notebooks);
      const nextId = data.notebooks[0]?.id || "default";
      setActiveNotebookId(nextId);
      activeNotebookRef.current = nextId;
      window.localStorage.setItem("nota-active-notebook", nextId);
      await loadNotebook(nextId);
      return notify("笔记本已删除");
    }
    const response = await fetch("/api/notebooks", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: activeNotebookId, name: choice }) });
    const data = await response.json() as { notebook?: Notebook; error?: string };
    if (!response.ok || !data.notebook) return notify(data.error || "重命名失败");
    setNotebooks((items) => items.map((item) => item.id === data.notebook!.id ? data.notebook! : item));
    notify("笔记本已重命名");
  }

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2400);
  }

  async function refreshKnowledge(notebookId = activeNotebookId) {
    if (activeNotebookRef.current === notebookId) setKnowledgeLoading(true);
    try {
      const response = await fetch(`/api/knowledge?${notebookQuery(notebookId)}`, { method: "POST" });
      const data = await response.json() as { knowledge?: Knowledge; error?: string };
      if (!response.ok || !data.knowledge) throw new Error(data.error || "知识视图更新失败");
      if (activeNotebookRef.current !== notebookId) return;
      setKnowledge(data.knowledge);
      notify("摘要、思维导图、记忆卡和 Wiki 已更新");
    } catch (error) {
      if (activeNotebookRef.current === notebookId) notify(error instanceof Error ? error.message : "知识视图更新失败");
    } finally { if (activeNotebookRef.current === notebookId) setKnowledgeLoading(false); }
  }

  async function openSource(sourceId: string, segmentId?: string) {
    const notebookId = activeNotebookId;
    try {
      const response = await fetch(`/api/sources?id=${encodeURIComponent(sourceId)}&${notebookQuery()}`);
      const data = await response.json() as { source?: SourceDetail; error?: string };
      if (!response.ok || !data.source) throw new Error(data.error || "来源读取失败");
      if (activeNotebookRef.current !== notebookId) return;
      setSelectedSource(data.source);
      setSourceGuide(null);
      fetch(`/api/guides?${notebookQuery()}&sourceId=${encodeURIComponent(sourceId)}`).then((response) => response.json()).then((guideData: { guide?: SourceGuide }) => setSourceGuide(guideData.guide || null)).catch(() => undefined);
      setSelectedSegmentId(segmentId || data.source.segments[0]?.id || null);
      window.setTimeout(() => document.getElementById(`segment-${segmentId || data.source!.segments[0]?.id}`)?.scrollIntoView({ block: "center" }), 120);
    } catch (error) { notify(error instanceof Error ? error.message : "来源读取失败"); }
  }

  async function addFiles(files: FileList | File[]) {
    const incoming = Array.from(files);
    if (!incoming.length) return;
    const notebookId = activeNotebookId;
    setIsImporting(true);
    notify(`正在上传并解析 ${incoming.length} 个文件`);
    try {
      const form = new FormData();
      incoming.forEach((file) => form.append("files", file));
      const response = await fetch(`/api/sources?${notebookQuery()}`, { method: "POST", body: form });
      const data = await response.json() as { sources?: Source[]; error?: string; errors?: Array<{ name: string; error: string }> };
      if (!response.ok || !data.sources) throw new Error(data.error || "文件导入失败");
      if (activeNotebookRef.current !== notebookId) return;
      setSources((current) => [...current, ...data.sources!]);
      setModalOpen(false);
      notify(data.errors?.length ? `已导入 ${data.sources.length} 个，${data.errors.length} 个失败` : `已完成 ${data.sources.length} 个文件的解析`);
      void refreshKnowledge(notebookId);
    } catch (error) {
      notify(error instanceof Error ? error.message : "文件导入失败");
    } finally {
      setIsImporting(false);
    }
  }

  async function addUrl(event: FormEvent) {
    event.preventDefault();
    const clean = urlValue.trim();
    if (!clean) return;
    const notebookId = activeNotebookId;
    setIsImporting(true);
    try {
      const response = await fetch(`/api/sources?${notebookQuery()}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: clean }) });
      const data = await response.json() as { sources?: Source[]; error?: string };
      if (!response.ok || !data.sources) throw new Error(data.error || "网页导入失败");
      if (activeNotebookRef.current !== notebookId) return;
      setSources((current) => [...current, ...data.sources!]);
      setUrlValue("");
      setModalOpen(false);
      notify("网页正文已解析并加入资料库");
      void refreshKnowledge(notebookId);
    } catch (error) {
      notify(error instanceof Error ? error.message : "网页导入失败");
    } finally {
      setIsImporting(false);
    }
  }

  async function removeSource(id: string) {
    const notebookId = activeNotebookId;
    const response = await fetch(`/api/sources?id=${encodeURIComponent(id)}&${notebookQuery()}`, { method: "DELETE" });
    if (response.ok && activeNotebookRef.current === notebookId) {
      const remaining = sources.filter((item) => item.id !== id);
      setSources(remaining);
      if (remaining.length) void refreshKnowledge(notebookId);
      else setKnowledge(null);
    }
    else notify("来源移除失败");
  }

  async function toggleSource(source: Source) {
    const enabled = source.enabled === false;
    const response = await fetch("/api/sources", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ notebookId: activeNotebookId, id: source.id, enabled }) });
    const data = await response.json() as { source?: Source; error?: string };
    if (!response.ok || !data.source) return notify(data.error || "来源选择更新失败");
    setSources((items) => items.map((item) => item.id === source.id ? data.source! : item));
    void refreshKnowledge();
  }

  async function newConversation() {
    const selectedSourceIds = sources.filter((source) => source.enabled !== false).map((source) => source.id);
    const response = await fetch("/api/conversations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ notebookId: activeNotebookId, title: "新对话", selectedSourceIds }) });
    const data = await response.json() as { conversation?: Conversation; error?: string };
    if (!response.ok || !data.conversation) return notify(data.error || "新对话创建失败");
    setConversations((items) => [data.conversation!, ...items]);
    setActiveConversationId(data.conversation.id);
    setMessages([]);
  }

  async function openConversation(id: string) {
    const response = await fetch(`/api/conversations?${notebookQuery()}&id=${encodeURIComponent(id)}`);
    const data = await response.json() as { conversation?: Conversation; error?: string };
    if (!response.ok || !data.conversation) return notify(data.error || "对话读取失败");
    setActiveConversationId(id);
    setMessages(data.conversation.messages || []);
  }

  async function saveNote(message?: Message) {
    const title = message ? message.text.replace(/[#*_`]/g, "").slice(0, 42) : noteDraft.title.trim();
    const content = message?.text || noteDraft.content.trim();
    if (!content) return notify("请先填写笔记内容");
    const response = await fetch("/api/notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ notebookId: activeNotebookId, title: title || "研究笔记", content, citations: message?.citations || [] }) });
    const data = await response.json() as { note?: Note; error?: string };
    if (!response.ok || !data.note) return notify(data.error || "笔记保存失败");
    setNotes((items) => [data.note!, ...items]);
    setNoteDraft({ title: "", content: "" });
    notify("已保存到笔记");
  }

  async function deleteNote(id: string) {
    const response = await fetch(`/api/notes?${notebookQuery()}&id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!response.ok) return notify("笔记删除失败");
    setNotes((items) => items.filter((item) => item.id !== id));
  }

  async function saveSettings(event: FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ notebookId: activeNotebookId, ...settings }) });
    const data = await response.json() as { settings?: NotebookSettings; error?: string };
    if (!response.ok || !data.settings) return notify(data.error || "设置保存失败");
    setSettings(data.settings);
    setSettingsOpen(false);
    notify("笔记本指令已保存");
  }

  async function generateGuide() {
    if (!selectedSource) return;
    setGuideLoading(true);
    try {
      const response = await fetch("/api/guides", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ notebookId: activeNotebookId, sourceId: selectedSource.id }) });
      const data = await response.json() as { guide?: SourceGuide; error?: string };
      if (!response.ok || !data.guide) throw new Error(data.error || "来源指南生成失败");
      setSourceGuide(data.guide);
    } catch (error) { notify(error instanceof Error ? error.message : "来源指南生成失败"); }
    finally { setGuideLoading(false); }
  }

  async function ask(question = prompt) {
    const clean = question.trim();
    if (!clean || isThinking) return;
    const notebookId = activeNotebookId;
    let conversationId = activeConversationId;
    if (!conversationId) {
      const response = await fetch("/api/conversations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ notebookId, title: clean.slice(0, 60), selectedSourceIds: sources.filter((source) => source.enabled !== false).map((source) => source.id) }) });
      const data = await response.json() as { conversation?: Conversation };
      if (data.conversation) { conversationId = data.conversation.id; setActiveConversationId(conversationId); setConversations((items) => [data.conversation!, ...items]); }
    }
    setPrompt("");
    const history = [...messages, { role: "user" as const, text: clean }];
    setMessages(history);
    setIsThinking(true);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: clean, history: history.slice(-10), sources: sources.filter((source) => source.enabled !== false).map(({ id, title, type }) => ({ id, title, type })), notebookId: activeNotebookId, conversationId }),
      });
      const data = await response.json() as { answer?: string; citations?: Citation[]; error?: string };
      if (!response.ok || !data.answer) throw new Error(data.error || "模型暂时无法回答");
      if (activeNotebookRef.current !== notebookId) return;
      setMessages((current) => [...current, { role: "assistant", text: data.answer!, citations: data.citations || [] }]);
      setConversations((items) => items.map((item) => item.id === conversationId ? { ...item, title: item.messageCount ? item.title : clean.slice(0, 60), messageCount: (item.messageCount || 0) + 2, preview: data.answer!.slice(0, 120), updatedAt: new Date().toISOString() } : item));
    } catch (error) {
      const message = error instanceof Error ? error.message : "模型连接失败，请稍后重试";
      if (activeNotebookRef.current === notebookId) setMessages((current) => [...current, { role: "assistant", text: `暂时无法完成回答：${message}` }]);
    } finally {
      if (activeNotebookRef.current === notebookId) setIsThinking(false);
    }
  }

  function handleComposerKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      ask();
    }
  }

  function citationButtons(citations: Citation[] = []) {
    if (!citations.length) return null;
    return <div className="citations">{citations.map((citation, index) => {
      const source = sources.find((item) => item.id === citation.sourceId);
      return <button key={`${citation.sourceId}-${citation.segmentId}-${index}`} onClick={() => openSource(citation.sourceId, citation.segmentId)} title={citation.snippet || "查看原文片段"}>[{index + 1}] {citation.sourceTitle || source?.title || "来源"}{citation.locator ? ` · ${citation.locator}` : ""}</button>;
    })}</div>;
  }

  function displayAnswer(message: Message) {
    let text = message.text;
    message.citations?.forEach((citation, index) => {
      if (citation.marker) text = text.replaceAll(`[${citation.marker}]`, `[${index + 1}]`);
    });
    return text;
  }

  function mindBranch(node: MindNode, depth = 0) {
    return <div className={`mind-branch depth-${depth}`} key={`${node.label}-${depth}`}>
      <article className="mind-node"><b>{node.label}</b>{node.note && <p>{node.note}</p>}{citationButtons(node.citations)}</article>
      {!!node.children?.length && <div className="mind-children">{node.children.map((child) => mindBranch(child, depth + 1))}</div>}
    </div>;
  }

  function share() {
    if (navigator.clipboard) navigator.clipboard.writeText(window.location.href);
    notify("分享链接已复制");
  }

  if (authLoading) return <main className="auth-shell"><div className="auth-card"><span className="brand-mark">N</span><h1>Nota</h1><p>正在加载你的研究空间…</p></div></main>;
  if (!authUser) return <main className="auth-shell"><form className="auth-card" onSubmit={submitAuth}><span className="brand-mark">N</span><h1>{needsSetup ? "创建管理员账户" : "登录 Nota"}</h1><p>{needsSetup ? "首次使用需要创建管理员。现有笔记本会安全归属此账户。" : "登录后访问你的独立笔记本。"}</p>{needsSetup && <input aria-label="显示名称" placeholder="显示名称" value={authName} onChange={(event) => setAuthName(event.target.value)} required />}<input aria-label="邮箱" type="email" placeholder="邮箱" value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} required /><input aria-label="密码" type="password" placeholder="密码（至少 10 位）" value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} minLength={10} required />{authError && <div className="auth-error">{authError}</div>}<button type="submit">{needsSetup ? "创建并进入" : "登录"}</button></form></main>;

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">N</span><span>Nota</span></div>
        <button className="new-notebook" onClick={() => setNotebookModalOpen(true)}><span>＋</span> 新建笔记本</button>
        <nav className="main-nav" aria-label="主要导航">
          <a className="active" href="#workspace"><span>◫</span> 我的笔记本</a>
          <a href="#workspace" onClick={() => notify("探索功能即将开放")}><span>⌁</span> 探索</a>
          <a href="#workspace" onClick={() => notify("暂无新的共享内容")}><span>♧</span> 与我共享</a>
        </nav>
        <div className="recent-label">我的笔记本</div>
        <div className="notebook-list">{notebooks.map((notebook) => <button className={`recent-item ${notebook.id === activeNotebookId ? "active" : ""}`} key={notebook.id} onClick={() => switchNotebook(notebook.id)}><span className="recent-dot" /><span><b>{notebook.name}</b><small>{notebook.id === activeNotebookId ? "当前打开" : "独立资料库"}</small></span></button>)}</div>
        <div className="sidebar-spacer" />
        <div className="usage-card"><div><span>本月用量</span><b>68%</b></div><div className="usage-track"><i /></div><p>已使用 34 / 50 个来源</p><button onClick={() => notify("升级方案即将开放")}>升级空间</button></div>
        <div className="profile"><span className="avatar">{authUser.displayName.slice(0, 1)}</span><span><b>{authUser.displayName}</b><small>{authUser.email}</small></span><button aria-label="退出登录" onClick={logout}>退出</button></div>
      </aside>

      <section className="workspace" id="workspace">
        <header className="topbar">
          <div><span className="crumb">我的笔记本</span><span className="slash">/</span><b>{activeNotebook.name}</b></div>
          <div className="top-actions"><button aria-label="笔记本设置" onClick={() => setSettingsOpen(true)}>⚙</button><button aria-label="管理笔记本" onClick={manageNotebook}>•••</button><button className="share" onClick={share}>↗ 分享</button></div>
        </header>

        <div className="project-head">
          <div><span className="eyebrow">研究笔记本 · 数据独立</span><h1>{activeNotebook.name}</h1><p>当前资料、对话和知识视图仅属于这个笔记本。</p></div>
          <div className="collaborators"><span>周</span><span>沈</span><span>＋2</span></div>
        </div>

        <div className="work-grid">
          <section className="sources-panel">
            <div className="panel-title"><div><h2>来源</h2><span className="count">{sources.filter((source) => source.enabled !== false).length}/{sources.length}</span></div><button onClick={() => setModalOpen(true)}>＋ 添加来源</button></div>
            <label className="source-search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="搜索来源" placeholder="搜索来源…" /></label>
            <div className="source-list">
              {filteredSources.map((source) => (
                <article className={`source-card ${source.enabled === false ? "disabled" : ""}`} key={source.id}>
                  <input type="checkbox" checked={source.enabled !== false} onChange={() => toggleSource(source)} aria-label={`在回答中使用 ${source.title}`} />
                  <button className="source-open" onClick={() => openSource(source.id)}>
                    <span className={`file-icon ${source.color}`}>{source.type}</span>
                    <span><b>{source.title}</b><small>{source.meta}{source.version ? ` · v${source.version}` : ""}</small></span>
                  </button>
                  <button aria-label={`移除 ${source.title}`} onClick={() => removeSource(source.id)}>×</button>
                </article>
              ))}
              {!filteredSources.length && <p className="empty-source">没有匹配的来源</p>}
            </div>
            <button className="drop-zone" onClick={() => fileInput.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); addFiles(event.dataTransfer.files); }}>
              <span className="upload-icon">↑</span><b>拖拽文件到这里</b><small>支持 PDF、Word、PPT、Excel、EPUB 等</small>
            </button>
            <input ref={fileInput} hidden multiple type="file" accept=".pdf,.docx,.pptx,.xlsx,.epub,.txt,.md,.csv,.html,.htm,.rtf,.json" onChange={(event: ChangeEvent<HTMLInputElement>) => event.target.files && addFiles(event.target.files)} />
          </section>

          <section className="chat-panel">
            <div className="chat-head"><div><span className="spark">✦</span><span><h2>{activeView === "chat" ? "与资料对话" : activeView === "notes" ? "研究笔记" : "知识工作台"}</h2><p>{knowledgeLoading ? "正在自动更新知识视图…" : `基于 ${sources.filter((source) => source.enabled !== false).length} 个已选来源`}</p></span></div>{activeView === "chat" ? <div className="conversation-tools"><select aria-label="历史对话" value={activeConversationId || ""} onChange={(event) => event.target.value ? openConversation(event.target.value) : undefined}><option value="">当前对话</option>{conversations.map((item) => <option value={item.id} key={item.id}>{item.title}</option>)}</select><button onClick={newConversation}>＋ 新对话</button></div> : activeView === "notes" ? <button onClick={() => setActiveView("chat")}>返回对话</button> : <button disabled={knowledgeLoading || !sources.some((source) => source.enabled !== false)} onClick={() => refreshKnowledge()}>↻ 更新</button>}</div>
            <nav className="view-tabs" aria-label="知识视图">
              {([{ id: "chat", label: "对话" }, { id: "notes", label: `笔记 ${notes.length}` }, { id: "summary", label: "自动摘要" }, { id: "mindmap", label: "思维导图" }, { id: "cards", label: "记忆卡" }, { id: "wiki", label: "Wiki" }] as Array<{ id: WorkspaceView; label: string }>).map((item) => <button className={activeView === item.id ? "active" : ""} key={item.id} onClick={() => setActiveView(item.id)}>{item.label}</button>)}
            </nav>
            {activeView === "chat" ? <>
              <div className={`chat-body ${messages.length ? "has-messages" : ""}`}>
                {!messages.length ? <>
                  <div className="welcome-orb">✦</div><h2>今天想研究什么？</h2><p>我会阅读你的全部资料，给出可点击定位的引用。</p>
                  <div className="suggestion-grid">{suggestions.map((item) => <button key={item.title} onClick={() => ask(item.title)}><span>{item.icon}</span><b>{item.title}</b><small>{item.note}</small></button>)}</div>
                </> : <div className="message-list" aria-live="polite">
                  {messages.map((message, index) => <div className={`message ${message.role}`} key={`${message.role}-${index}`}>
                    {message.role === "assistant" && <span className="message-avatar">✦</span>}
                    <div><ReactMarkdown>{displayAnswer(message)}</ReactMarkdown>{citationButtons(message.citations)}{message.role === "assistant" && <button className="save-note" onClick={() => saveNote(message)}>＋ 保存为笔记</button>}</div>
                  </div>)}
                  {isThinking && <div className="message assistant"><span className="message-avatar">✦</span><div className="thinking"><i /><i /><i /></div></div>}
                </div>}
              </div>
              <div className="composer"><div><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={handleComposerKey} aria-label="向资料提问" placeholder="向你的资料提问…" rows={1} /><button className="send" aria-label="发送" disabled={!prompt.trim() || isThinking} onClick={() => ask()}>↑</button></div><p>点击回答下方的引用，可定位到对应页、幻灯片或原文片段。</p></div>
            </> : activeView === "notes" ? <div className="notes-body"><form className="note-compose" onSubmit={(event) => { event.preventDefault(); void saveNote(); }}><input value={noteDraft.title} onChange={(event) => setNoteDraft((draft) => ({ ...draft, title: event.target.value }))} placeholder="笔记标题" /><textarea value={noteDraft.content} onChange={(event) => setNoteDraft((draft) => ({ ...draft, content: event.target.value }))} placeholder="记录观点、结论或下一步…" /><button disabled={!noteDraft.content.trim()}>保存笔记</button></form><div className="note-list">{notes.map((note) => <article key={note.id}><header><div><b>{note.title}</b><small>{new Date(note.updatedAt).toLocaleString("zh-CN")}</small></div><button onClick={() => deleteNote(note.id)}>删除</button></header><ReactMarkdown>{note.content}</ReactMarkdown>{citationButtons(note.citations)}</article>)}{!notes.length && <p className="empty-note">还没有笔记。可手动记录，也可把 AI 回答一键保存。</p>}</div></div> : <div className="knowledge-body">
              {knowledgeLoading && <div className="knowledge-loading"><span className="welcome-orb">✦</span><b>正在重建知识视图</b><p>分析全部来源并同步摘要、导图、记忆卡与 Wiki…</p></div>}
              {!knowledgeLoading && !knowledge && <div className="knowledge-loading"><span className="welcome-orb">＋</span><b>导入资料后自动生成</b><p>知识视图会随着来源变化自动更新。</p></div>}
              {!knowledgeLoading && knowledge && activeView === "summary" && <section className="summary-view"><span className="view-kicker">自动更新 · {new Date(knowledge.generatedAt).toLocaleString("zh-CN")}</span><h2>{knowledge.summary.title}</h2><p className="summary-overview">{knowledge.summary.overview}</p><div className="insight-list">{knowledge.summary.points.map((point, index) => <article key={index}><span>{String(index + 1).padStart(2, "0")}</span><div><p>{point.text}</p>{citationButtons(point.citations)}</div></article>)}</div></section>}
              {!knowledgeLoading && knowledge && activeView === "mindmap" && <section className="mindmap-view"><div className="view-intro"><span className="view-kicker">自动知识结构</span><h2>思维导图</h2><p>每个节点都可追溯到原始资料。</p></div><div className="mindmap-canvas">{mindBranch(knowledge.mindmap)}</div></section>}
              {!knowledgeLoading && knowledge && activeView === "cards" && <section className="cards-view"><div className="view-intro"><span className="view-kicker">主动回忆</span><h2>记忆卡片</h2><p>点击卡片翻看答案与来源。</p></div><div className="flashcard-grid">{knowledge.cards.map((card, index) => { const flipped = flippedCards.includes(index); return <article className={`flashcard ${flipped ? "flipped" : ""}`} key={index}><button className="flashcard-flip" onClick={() => setFlippedCards((items) => items.includes(index) ? items.filter((item) => item !== index) : [...items, index])}><small>{flipped ? "答案" : `问题 ${index + 1}`}</small><b>{flipped ? card.answer : card.question}</b><span>{flipped ? "点击返回问题" : "点击查看答案 →"}</span></button>{flipped && citationButtons(card.citations)}</article>; })}</div></section>}
              {!knowledgeLoading && knowledge && activeView === "wiki" && <section className="wiki-view"><aside>{knowledge.wiki.map((entry, index) => <button className={openWiki === index ? "active" : ""} key={entry.title} onClick={() => setOpenWiki(index)}><span>{String(index + 1).padStart(2, "0")}</span>{entry.title}</button>)}</aside>{knowledge.wiki[openWiki] && <article><span className="view-kicker">自动 Wiki 条目</span><h2>{knowledge.wiki[openWiki].title}</h2><ReactMarkdown>{knowledge.wiki[openWiki].content}</ReactMarkdown>{citationButtons(knowledge.wiki[openWiki].citations)}</article>}</section>}
            </div>}
          </section>
        </div>
      </section>

      {notebookModalOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setNotebookModalOpen(false); }}>
        <section className="source-modal notebook-modal" role="dialog" aria-modal="true" aria-labelledby="notebook-modal-title">
          <button className="modal-close" aria-label="关闭新建笔记本" onClick={() => setNotebookModalOpen(false)}>×</button>
          <span className="modal-icon">＋</span><h2 id="notebook-modal-title">新建独立笔记本</h2><p>每个笔记本分别保存来源、对话和知识视图，内容不会互相混用。</p>
          <form className="notebook-form" onSubmit={createNotebook}><input aria-label="笔记本名称" value={notebookName} onChange={(event) => setNotebookName(event.target.value)} placeholder="例如：市场研究" maxLength={60} /><button disabled={!notebookName.trim()} type="submit">创建笔记本</button></form>
        </section>
      </div>}

      {modalOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setModalOpen(false); }}>
        <section className="source-modal" role="dialog" aria-modal="true" aria-labelledby="source-modal-title">
          <button className="modal-close" aria-label="关闭" onClick={() => setModalOpen(false)}>×</button>
          <span className="modal-icon">↑</span><h2 id="source-modal-title">添加研究来源</h2><p>导入资料后，Nota 会自动解析并建立可引用的知识索引。</p>
          <button className="local-upload" disabled={isImporting} onClick={() => fileInput.current?.click()}><b>{isImporting ? "正在解析…" : "从设备上传"}</b><small>PDF、Word、PPTX、Excel、EPUB、Markdown 等</small><span>选择文件 →</span></button>
          <div className="or"><span>或粘贴网页链接</span></div>
          <form onSubmit={addUrl}><input value={urlValue} onChange={(event) => setUrlValue(event.target.value)} placeholder="https://example.com/article" aria-label="网页链接" /><button disabled={isImporting}>{isImporting ? "解析中" : "添加"}</button></form>
        </section>
      </div>}
      {settingsOpen && <div className="modal-backdrop" role="presentation" onMouseDown={() => setSettingsOpen(false)}><form className="source-modal settings-modal" onSubmit={saveSettings} onMouseDown={(event) => event.stopPropagation()}><button type="button" className="modal-close" onClick={() => setSettingsOpen(false)}>×</button><span className="modal-icon">⚙</span><h2>笔记本回答设置</h2><p>这些指令只作用于当前笔记本中的回答。</p><label>输出语言<input value={settings.language} onChange={(event) => setSettings({ ...settings, language: event.target.value })} /></label><label>回答篇幅<select value={settings.answerLength} onChange={(event) => setSettings({ ...settings, answerLength: event.target.value as NotebookSettings["answerLength"] })}><option value="short">精简</option><option value="balanced">平衡</option><option value="detailed">详细</option></select></label><label>目标读者<input value={settings.audience} onChange={(event) => setSettings({ ...settings, audience: event.target.value })} /></label><label>表达风格<input value={settings.style} onChange={(event) => setSettings({ ...settings, style: event.target.value })} /></label><label>自定义指令<textarea value={settings.customInstructions} onChange={(event) => setSettings({ ...settings, customInstructions: event.target.value })} placeholder="例如：优先比较不同来源的分歧" /></label><label className="check-row"><input type="checkbox" checked={settings.strictCitations} onChange={(event) => setSettings({ ...settings, strictCitations: event.target.checked })} />严格引用来源</label><label className="check-row"><input type="checkbox" checked={settings.allowGeneralKnowledge} onChange={(event) => setSettings({ ...settings, allowGeneralKnowledge: event.target.checked })} />允许补充通用知识</label><button className="primary-action">保存设置</button></form></div>}
      {selectedSource && <div className="modal-backdrop source-reader-backdrop" role="presentation" onMouseDown={() => setSelectedSource(null)}>
        <section className="source-reader" role="dialog" aria-modal="true" aria-labelledby="source-reader-title" onMouseDown={(event) => event.stopPropagation()}>
          <header><div><span className={`file-icon ${selectedSource.color}`}>{selectedSource.type}</span><span><h2 id="source-reader-title">{selectedSource.title}</h2><p>{selectedSource.segments.length} 个可引用片段</p></span></div><div>{selectedSource.originalUrl && <a href={selectedSource.originalUrl} target="_blank" rel="noreferrer">打开原文件 ↗</a>}<button aria-label="关闭原文" onClick={() => setSelectedSource(null)}>×</button></div></header>
          <div className="reader-guide"><div><b>Source Guide</b><small>摘要、主题、实体与建议问题</small></div><button disabled={guideLoading} onClick={generateGuide}>{guideLoading ? "生成中…" : sourceGuide ? "重新生成" : "生成指南"}</button></div>
          {sourceGuide && <section className="guide-content"><p>{sourceGuide.summary}</p><div>{sourceGuide.topics.map((topic) => <span key={topic}>{topic}</span>)}</div><h3>内容目录</h3><ol>{sourceGuide.outline.map((item) => <li key={item}>{item}</li>)}</ol><h3>建议提问</h3>{sourceGuide.suggestedQuestions.map((question) => <button key={question} onClick={() => { setSelectedSource(null); setActiveView("chat"); void ask(question); }}>{question}</button>)}</section>}
          <div className="reader-content">{selectedSource.segments.map((segment) => <article id={`segment-${segment.id}`} className={selectedSegmentId === segment.id ? "active" : ""} key={segment.id} onClick={() => setSelectedSegmentId(segment.id)}><span>{segment.label}</span><p>{segment.text}</p></article>)}</div>
        </section>
      </div>}
      {toast && <div className="toast" role="status">✓ {toast}</div>}
    </main>
  );
}
