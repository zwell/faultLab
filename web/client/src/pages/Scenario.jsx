import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Link, useParams } from "react-router-dom";
import ActionBar from "../components/ActionBar.jsx";
import ContainerTabs from "../components/ContainerTabs.jsx";
import Terminal from "../components/Terminal.jsx";
import VerifyChat from "../components/VerifyChat.jsx";

const SECTION_WHITELIST = new Set(["你会遇到什么", "观察与排查", "参考资料"]);
const SECTION_TITLE_MAP = {
  你会遇到什么: "故障现象",
  观察与排查: "排查路径",
  参考资料: "延伸阅读"
};
const resourceStyles = {
  light: "bg-emerald-600/20 text-emerald-300 border-emerald-500/40",
  medium: "bg-amber-600/20 text-amber-300 border-amber-500/40",
  heavy: "bg-rose-600/20 text-rose-300 border-rose-500/40"
};
const resourceLabels = {
  light: "轻量",
  medium: "中等",
  heavy: "重量"
};
const difficultyMeta = {
  1: { label: "新手", className: "border-emerald-500/40 bg-emerald-600/15 text-emerald-300" },
  2: { label: "入门", className: "border-lime-500/40 bg-lime-600/15 text-lime-300" },
  3: { label: "中等", className: "border-amber-500/40 bg-amber-600/15 text-amber-300" },
  4: { label: "进阶", className: "border-orange-500/40 bg-orange-600/15 text-orange-300" },
  5: { label: "困难", className: "border-rose-500/40 bg-rose-600/15 text-rose-300" }
};

function normalizeDifficulty(level) {
  return Math.max(1, Math.min(5, Number(level) || 1));
}

function extractUsefulReadme(markdownText) {
  if (!markdownText) return "";
  const lines = markdownText.split(/\r?\n/);
  const output = [];
  let currentSection = "";
  let keepCurrentSection = false;

  for (const line of lines) {
    if (line.startsWith("# ")) {
      if (output.length > 0 && output[output.length - 1] !== "") {
        output.push("");
      }
      output.push(line);
      continue;
    }

    if (line.startsWith("## ")) {
      currentSection = line.replace(/^##\s+/, "").trim();
      keepCurrentSection = SECTION_WHITELIST.has(currentSection);
      if (keepCurrentSection) {
        if (output.length > 0 && output[output.length - 1] !== "") {
          output.push("");
        }
        output.push(`## ${SECTION_TITLE_MAP[currentSection] || currentSection}`);
      }
      continue;
    }

    if (keepCurrentSection) {
      output.push(line);
    }
  }

  return output.join("\n").trim();
}

function splitReadmeTitle(markdownText) {
  if (!markdownText) return { title: "", body: "" };
  const lines = markdownText.split(/\r?\n/);
  if (lines[0]?.startsWith("# ")) {
    const title = lines[0].replace(/^#\s+/, "").trim();
    const body = lines.slice(1).join("\n").trim();
    return { title, body };
  }
  return { title: "", body: markdownText };
}

export default function Scenario() {
  const { id } = useParams();
  const [readme, setReadme] = useState("");
  const [readmeError, setReadmeError] = useState("");
  const [readmeLoading, setReadmeLoading] = useState(true);
  const [scenarioMeta, setScenarioMeta] = useState(null);
  const [metaError, setMetaError] = useState("");
  const [leftRatio, setLeftRatio] = useState(40);
  const [dragging, setDragging] = useState(false);
  const [containerRefreshKey, setContainerRefreshKey] = useState(0);
  const shellCommandRef = useRef(null);

  useEffect(() => {
    const loadReadme = async () => {
      try {
        setReadmeLoading(true);
        setReadmeError("");
        const response = await fetch(`/api/scenarios/${id}/readme`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const text = await response.text();
        setReadme(text);
      } catch (error) {
        setReadmeError(error.message || "Unknown error");
      } finally {
        setReadmeLoading(false);
      }
    };
    loadReadme();
  }, [id]);
  useEffect(() => {
    const loadMeta = async () => {
      try {
        setMetaError("");
        const response = await fetch("/api/scenarios");
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        const matched = data.find((item) => item.id === id) || null;
        setScenarioMeta(matched);
      } catch (error) {
        setMetaError(error.message || "Unknown error");
      }
    };
    loadMeta();
  }, [id]);

  const rightRatio = useMemo(() => 100 - leftRatio, [leftRatio]);
  const usefulReadme = useMemo(() => extractUsefulReadme(readme), [readme]);
  const readmeParts = useMemo(() => splitReadmeTitle(usefulReadme), [usefulReadme]);
  const displayTitle = readmeParts.title || scenarioMeta?.title || id;
  const difficulty = normalizeDifficulty(scenarioMeta?.difficulty);
  const difficultyInfo = difficultyMeta[difficulty];
  const resourceClass =
    resourceStyles[scenarioMeta?.resource_level] || "bg-slate-800 text-slate-200 border-slate-600";
  const resourceLabel = resourceLabels[scenarioMeta?.resource_level] || scenarioMeta?.resource_level || "-";
  const durationLabel = scenarioMeta
    ? `${scenarioMeta.duration_min || "?"}-${scenarioMeta.duration_max || "?"} 分钟`
    : "-";

  const handleSplitterMouseDown = () => setDragging(true);
  const handleMouseMove = (event) => {
    if (!dragging) return;
    const viewportWidth = window.innerWidth || 1;
    const next = (event.clientX / viewportWidth) * 100;
    setLeftRatio(Math.max(25, Math.min(70, next)));
  };
  const handleMouseUp = () => setDragging(false);

  useEffect(() => {
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [dragging]);

  const attachContainer = async (containerName) => {
    try {
      const response = await fetch(`/api/scenarios/${id}/attach`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ containerName })
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        if (response.status === 404 && shellCommandRef.current) {
          // Backward compatibility when server has not reloaded new /attach route yet.
          shellCommandRef.current(`docker exec -it ${containerName} /bin/bash || docker exec -it ${containerName} /bin/sh`);
          return;
        }
        throw new Error(data.error || `HTTP ${response.status}`);
      }
    } catch (error) {
      // Surface in devtools; terminal still remains usable.
      console.error("[attach] failed:", error?.message || error);
    }
  };

  const handleActionSuccess = () => {
    setContainerRefreshKey((prev) => prev + 1);
  };

  return (
    <main className="h-screen overflow-hidden px-4 py-4">
      <Link to="/" className="text-sm text-indigo-300 hover:text-indigo-200">
        Back to scenarios
      </Link>

      <section className="mt-3 flex h-[calc(100vh-4.5rem)] min-h-[700px] rounded-xl border border-slate-800 bg-slate-900/40">
        <div style={{ width: `${leftRatio}%` }} className="h-full overflow-auto border-r border-slate-800 p-4">
          {metaError && <p className="mb-4 text-xs text-rose-300">场景元信息加载失败：{metaError}</p>}
          {readmeLoading && <p className="text-sm text-slate-400">Loading README...</p>}
          {readmeError && <p className="text-rose-300">Failed to load README: {readmeError}</p>}
          {!readmeLoading && !readmeError && usefulReadme && (
            <article className="markdown-doc">
              <h1>{displayTitle}</h1>
              {scenarioMeta && (
                <div className="mb-4 rounded-lg border border-slate-800 bg-slate-900/80 p-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded border border-slate-700 bg-slate-800 px-2 py-0.5 text-slate-200">
                      技术栈：{scenarioMeta.tech}
                    </span>
                    <span className={`rounded border px-2 py-0.5 font-medium ${difficultyInfo.className}`}>
                      难度：L{difficulty} {difficultyInfo.label}
                    </span>
                    <span className="rounded border border-slate-700 bg-slate-800 px-2 py-0.5 text-slate-200">
                      预计时长：{durationLabel}
                    </span>
                    <span className={`rounded border px-2 py-0.5 ${resourceClass}`}>资源等级：{resourceLabel}</span>
                  </div>
                </div>
              )}
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  a: ({ ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
                  pre: ({ children }) => <pre className="code-block">{children}</pre>,
                  code: ({ className, children, ...props }) => (
                    <code className={className ? className : "inline-code"} {...props}>
                      {children}
                    </code>
                  )
                }}
              >
                {readmeParts.body}
              </ReactMarkdown>
            </article>
          )}
        </div>

        <div
          className="w-1 cursor-col-resize bg-slate-700/70 hover:bg-indigo-400"
          onMouseDown={handleSplitterMouseDown}
          aria-hidden="true"
        />

        <div style={{ width: `${rightRatio}%` }} className="flex h-full min-w-0 flex-col gap-3 p-3">
          <div className="rounded-lg border border-slate-800 bg-slate-900 p-3">
            <div className="mb-2">
              <ActionBar scenarioId={id} onActionSuccess={handleActionSuccess} />
            </div>
            <ContainerTabs scenarioId={id} onAttach={attachContainer} refreshKey={containerRefreshKey} />
          </div>

          <div className="min-h-0 flex-[6]">
            <Terminal scenarioId={id} commandBridgeRef={shellCommandRef} />
          </div>

          <div className="flex min-h-0 flex-[4] flex-col rounded-lg border border-slate-800 bg-slate-900 p-3">
            <VerifyChat scenarioId={id} />
          </div>
        </div>
      </section>
    </main>
  );
}
