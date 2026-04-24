import { useCallback, useEffect, useState } from "react";

const idle = "idle";
const starting = "starting";
const started = "started";
const injecting = "injecting";
const injected = "injected";
const cleaning = "cleaning";

export default function ActionBar({ scenarioId, onActionSuccess }) {
  const [phase, setPhase] = useState(idle);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState(null);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    if (!scenarioId) return;
    let cancelled = false;

    const syncPhaseFromContainers = async () => {
      try {
        setSyncing(true);
        const [containersResp, runtimeResp] = await Promise.all([
          fetch(`/api/scenarios/${scenarioId}/containers`),
          fetch(`/api/scenarios/${scenarioId}/runtime-state`)
        ]);
        if (!containersResp.ok) return;
        const data = await containersResp.json().catch(() => ({}));
        const runtime = runtimeResp.ok ? await runtimeResp.json().catch(() => ({})) : {};
        const containers = Array.isArray(data) ? data : data.containers || [];
        if (cancelled) return;
        // If containers are already running, treat as started after refresh.
        if (containers.length > 0) {
          if (runtime?.injected) {
            setSummary(runtime.summary || null);
            setPhase(injected);
          } else {
            setPhase((prev) => (prev === injected ? injected : started));
          }
          return;
        }
        // Keep injected state if user already injected in this session.
        setPhase((prev) => (prev === injected ? injected : idle));
      } catch {
        // Ignore sync errors and keep current UI state.
      } finally {
        if (!cancelled) {
          setSyncing(false);
        }
      }
    };

    setError("");
    setSummary(null);
    setPhase(idle);
    syncPhaseFromContainers();

    return () => {
      cancelled = true;
    };
  }, [scenarioId]);

  const postAction = useCallback(
    async (path) => {
      const response = await fetch(`/api/scenarios/${scenarioId}${path}`, { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }
      return data;
    },
    [scenarioId]
  );

  const onStart = async () => {
    setError("");
    setSummary(null);
    setPhase(starting);
    try {
      await postAction("/start");
      setPhase(started);
      onActionSuccess?.("start");
    } catch (err) {
      setError(err.message || "启动失败");
      setPhase(idle);
    }
  };

  const onInject = async () => {
    setError("");
    setPhase(injecting);
    try {
      const data = await postAction("/inject");
      setSummary(data.summary || null);
      setPhase(injected);
      onActionSuccess?.("inject");
    } catch (err) {
      setError(err.message || "注入失败");
      setPhase(started);
    }
  };

  const onClean = async () => {
    const fallbackPhase = phase === started ? started : injected;
    setError("");
    setPhase(cleaning);
    try {
      await postAction("/clean");
      setSummary(null);
      setPhase(idle);
      onActionSuccess?.("clean");
    } catch (err) {
      setError(err.message || "清理失败");
      setPhase(fallbackPhase);
    }
  };

  const busy = phase === starting || phase === injecting || phase === cleaning || syncing;
  const canStart = phase === idle && !busy;
  const canRestart = (phase === started || phase === injected) && !busy;
  const canInject = phase === started && !busy;
  const canClean = (phase === injected || phase === started) && !busy;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!canStart && !canRestart}
          onClick={onStart}
          className={`rounded px-3 py-1 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40 ${
            error && (phase === idle || phase === starting) ? "bg-rose-600" : "bg-indigo-600 hover:bg-indigo-500"
          }`}
        >
          {phase === idle ? "启动环境" : "重启环境"}
          {phase === starting ? "…" : ""}
        </button>
        <button
          type="button"
          disabled={!canInject}
          onClick={onInject}
          className="rounded bg-indigo-600 px-3 py-1 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          注入故障{phase === injecting ? "…" : ""}
        </button>
        <button
          type="button"
          disabled={!canClean}
          onClick={onClean}
          className="rounded bg-slate-700 px-3 py-1 text-sm font-medium text-slate-100 hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          清理环境{phase === cleaning ? "…" : ""}
        </button>
        {busy && (
          <span className="text-xs text-slate-400">
            {syncing ? "同步环境状态中..." : "执行中，输出在下方终端"}
          </span>
        )}
      </div>

      {error && <p className="text-xs text-rose-300">{error}</p>}

      {summary && Object.keys(summary).length > 0 && (
        <div className="rounded-md border border-slate-700 bg-slate-950/80 p-2 text-xs text-slate-200">
          <div className="mb-1 font-semibold text-slate-300">注入摘要</div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            {Object.entries(summary).map(([key, value]) => (
              <div key={key} className="contents">
                <dt className="text-slate-500">{key}</dt>
                <dd className="font-mono text-slate-100">{String(value)}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}
