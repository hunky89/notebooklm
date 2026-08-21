"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";

type Snapshot = { notebookName: string; summary?: string; notes: Array<{ title: string; content: string }>; reports: Array<{ title: string; markdown: string }>; sourceTitles: string[] };
export default function SharedNotebook() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null); const [error, setError] = useState("");
  useEffect(() => { const token = new URLSearchParams(window.location.search).get("token") || ""; fetch(`/api/shares?token=${encodeURIComponent(token)}`).then(async (response) => { const data = await response.json() as { snapshot?: Snapshot; error?: string }; if (!response.ok || !data.snapshot) throw new Error(data.error || "无法打开分享"); setSnapshot(data.snapshot); }).catch((reason) => setError(reason instanceof Error ? reason.message : "无法打开分享")); }, []);
  if (error) return <main className="shared-shell"><div className="shared-card"><h1>分享不可用</h1><p>{error}</p></div></main>;
  if (!snapshot) return <main className="shared-shell"><div className="shared-card"><p>正在加载共享研究…</p></div></main>;
  return <main className="shared-shell"><article className="shared-card"><span className="eyebrow">Nota 只读分享</span><h1>{snapshot.notebookName}</h1><p>{snapshot.sourceTitles.length} 个来源：{snapshot.sourceTitles.join("、")}</p>{snapshot.summary && <ReactMarkdown>{snapshot.summary}</ReactMarkdown>}{snapshot.notes.map((note) => <section key={note.title}><h2>{note.title}</h2><ReactMarkdown>{note.content}</ReactMarkdown></section>)}{snapshot.reports.map((report) => <section key={report.title}><h2>{report.title}</h2><ReactMarkdown>{report.markdown}</ReactMarkdown></section>)}</article></main>;
}
