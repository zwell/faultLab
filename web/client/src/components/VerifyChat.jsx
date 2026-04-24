import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useVerify } from "../hooks/useVerify.js";

const markdownComponents = {
  a: ({ ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
  pre: ({ children }) => <pre className="code-block">{children}</pre>,
  code: ({ className, children, ...props }) => (
    <code className={className ? className : "inline-code"} {...props}>
      {children}
    </code>
  )
};

export default function VerifyChat({
  scenarioId,
  collapsed = false,
  onEngagementChange,
  onCollapsedFocus,
  focusBridgeRef
}) {
  const { status, messages, sending, error, sendMessage } = useVerify(scenarioId);
  const [input, setInput] = useState("");
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  useEffect(() => {
    // Expand only after actual send/response begins, not while typing draft input.
    const engaged = messages.length > 0 || sending;
    onEngagementChange?.(engaged);
  }, [messages, sending, onEngagementChange]);

  useEffect(() => {
    if (!focusBridgeRef) return;
    focusBridgeRef.current = () => {
      inputRef.current?.focus();
    };
    return () => {
      if (focusBridgeRef) focusBridgeRef.current = null;
    };
  }, [focusBridgeRef]);

  const onSubmit = () => {
    sendMessage(input);
    setInput("");
  };

  const configured = status?.configured === true;

  if (collapsed) {
    return (
      <div className="flex items-end gap-2">
        <textarea
          ref={inputRef}
          value={input}
          disabled={!configured || sending}
          onChange={(e) => setInput(e.target.value)}
          onFocus={() => onCollapsedFocus?.()}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              onSubmit();
            }
          }}
          placeholder={configured ? "输入分析…（Ctrl+Enter 发送）" : "配置 .env 后可使用"}
          rows={1}
          className="min-h-[2.5rem] flex-1 resize-none rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 disabled:opacity-50"
        />
        <button
          type="button"
          disabled={!configured || sending || !input.trim()}
          onClick={onSubmit}
          className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {sending ? "发送中" : "发送"}
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {!configured && status && (
        <div className="rounded-md border border-amber-600/40 bg-amber-950/40 px-3 py-2 text-xs text-amber-100">
          <div className="font-semibold text-amber-200">Verify 未就绪</div>
          <p className="mt-1 text-amber-100/90">
            {status.message ||
              "请在仓库根目录 .env 配置 LLM：ANTHROPIC_API_KEY（推荐），或与 CLI 一致的 DASHSCOPE_API_KEY / OPENAI_API_KEY。密钥仅保存在本机 .env，由本地 server 读取，不会发往浏览器以外的地址。"}
          </p>
        </div>
      )}

      {error && <p className="text-xs text-rose-300">{error}</p>}

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto rounded-md border border-slate-800 bg-slate-950/40 p-2">
        {messages.length === 0 && (
          <p className="text-xs text-slate-500">描述你的排查结论与证据链</p>
        )}
        {messages.map((msg, idx) => (
          <div key={idx} className={msg.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div
              className={`max-w-[95%] rounded-lg px-3 py-2 text-sm ${
                msg.role === "user" ? "bg-indigo-600 text-white" : "bg-slate-800 text-slate-100"
              }`}
            >
              {msg.role === "user" ? (
                <p className="whitespace-pre-wrap">{msg.content}</p>
              ) : (
                <div className={`markdown-doc text-sm ${msg.streaming ? "streaming-cursor" : ""}`}>
                  {msg.content ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                      {msg.content}
                    </ReactMarkdown>
                  ) : (
                    msg.streaming && <span className="text-slate-500">思考中…</span>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="flex gap-2">
        <textarea
          ref={inputRef}
          value={input}
          disabled={!configured || sending}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              onSubmit();
            }
          }}
          placeholder={configured ? "输入分析…（Ctrl+Enter 发送）" : "配置 .env 后可使用"}
          rows={2}
          className="min-h-[2.5rem] flex-1 resize-none rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 disabled:opacity-50"
        />
        <button
          type="button"
          disabled={!configured || sending || !input.trim()}
          onClick={onSubmit}
          className="self-end rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {sending ? "发送中" : "发送"}
        </button>
      </div>
    </div>
  );
}
