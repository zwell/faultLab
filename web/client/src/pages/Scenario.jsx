import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Link, useParams } from "react-router-dom";
import ActionBar from "../components/ActionBar.jsx";
import ContainerTabs from "../components/ContainerTabs.jsx";
import Terminal from "../components/Terminal.jsx";

const SECTION_WHITELIST = new Set(["你会遇到什么", "观察与排查", "参考资料"]);
const SECTION_TITLE_MAP = {
  你会遇到什么: "故障现象",
  观察与排查: "排查路径",
  参考资料: "延伸阅读"
};

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

export default function Scenario() {
  const { id } = useParams();
  const [readme, setReadme] = useState("");
  const [readmeError, setReadmeError] = useState("");
  const [readmeLoading, setReadmeLoading] = useState(true);
  const [leftRatio, setLeftRatio] = useState(40);
  const [dragging, setDragging] = useState(false);
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

  const rightRatio = useMemo(() => 100 - leftRatio, [leftRatio]);
  const usefulReadme = useMemo(() => extractUsefulReadme(readme), [readme]);

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

  const attachContainer = (containerName) => {
    if (!shellCommandRef.current) return;
    shellCommandRef.current(`docker exec -it ${containerName} /bin/bash || docker exec -it ${containerName} /bin/sh`);
  };

  return (
    <main className="h-screen overflow-hidden px-4 py-4">
      <Link to="/" className="text-sm text-indigo-300 hover:text-indigo-200">
        Back to scenarios
      </Link>

      <section className="mt-3 flex h-[calc(100vh-4.5rem)] min-h-[700px] rounded-xl border border-slate-800 bg-slate-900/40">
        <div style={{ width: `${leftRatio}%` }} className="h-full overflow-auto border-r border-slate-800 p-4">
          {readmeLoading && <p className="text-sm text-slate-400">Loading README...</p>}
          {readmeError && <p className="text-rose-300">Failed to load README: {readmeError}</p>}
          {!readmeLoading && !readmeError && usefulReadme && (
            <article className="markdown-doc">
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
                {usefulReadme}
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
              <ActionBar scenarioId={id} />
            </div>
            <ContainerTabs scenarioId={id} onAttach={attachContainer} />
          </div>

          <div className="min-h-0 flex-[6]">
            <Terminal scenarioId={id} commandBridgeRef={shellCommandRef} />
          </div>

          <div className="flex-[4] rounded-lg border border-slate-800 bg-slate-900 p-3 text-sm text-slate-400">
            Verify 对话区（阶段四）
          </div>
        </div>
      </section>
    </main>
  );
}
