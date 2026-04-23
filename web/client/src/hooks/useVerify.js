import { useCallback, useEffect, useState } from "react";

async function fetchWithRetry(url, options, retries = 1) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fetch(url, options);
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 400));
      }
    }
  }
  throw lastError;
}

function parseSseBuffer(buffer, onEvent) {
  let rest = buffer;
  let idx;
  while ((idx = rest.indexOf("\n\n")) !== -1) {
    const block = rest.slice(0, idx);
    rest = rest.slice(idx + 2);
    for (const line of block.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      try {
        onEvent(JSON.parse(payload));
      } catch (_err) {
        // ignore
      }
    }
  }
  return rest;
}

export function useVerify(scenarioId) {
  const [status, setStatus] = useState(null);
  const [messages, setMessages] = useState([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!scenarioId) return;
    const load = async () => {
      try {
        const response = await fetch(`/api/scenarios/${scenarioId}/verify-status`);
        const data = await response.json();
        setStatus(data);
      } catch (err) {
        setStatus({ configured: false, message: err.message || "无法检查配置" });
      }
    };
    load();
  }, [scenarioId]);

  const sendMessage = useCallback(
    async (text) => {
      const trimmed = text.trim();
      if (!trimmed || !scenarioId || sending) return;

      const history = messages.map(({ role, content }) => ({ role, content }));

      setError("");
      setSending(true);
      setMessages((prev) => [
        ...prev,
        { role: "user", content: trimmed },
        { role: "assistant", content: "", streaming: true }
      ]);

      const finishAssistant = () => {
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last?.role === "assistant") {
            next[next.length - 1] = { role: "assistant", content: last.content, streaming: false };
          }
          return next;
        });
      };

      try {
        const response = await fetchWithRetry(
          `/api/scenarios/${scenarioId}/verify`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "text/event-stream"
            },
            body: JSON.stringify({ message: trimmed, history })
          },
          1
        );

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || `请求失败 HTTP ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        const handleEvent = (evt) => {
          if (evt.t === "chunk" && evt.c) {
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last?.role === "assistant") {
                next[next.length - 1] = {
                  role: "assistant",
                  content: last.content + evt.c,
                  streaming: true
                };
              }
              return next;
            });
          }
          if (evt.t === "error" && evt.m) {
            setError(evt.m);
            finishAssistant();
          }
          if (evt.t === "done") {
            finishAssistant();
          }
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          buffer = parseSseBuffer(buffer, handleEvent);
        }

        if (buffer.trim()) {
          parseSseBuffer(`${buffer}\n\n`, handleEvent);
        }

        finishAssistant();
      } catch (err) {
        setError(err.message || "发送失败");
        setMessages((prev) => prev.slice(0, -2));
      } finally {
        setSending(false);
      }
    },
    [scenarioId, messages, sending]
  );

  return { status, messages, sending, error, sendMessage };
}
