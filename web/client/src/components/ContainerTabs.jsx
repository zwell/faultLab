import { useEffect, useState } from "react";

export default function ContainerTabs({ scenarioId, onAttach, refreshKey = 0 }) {
  const [containers, setContainers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState("");
  const [dockerHint, setDockerHint] = useState("");
  const [attachingName, setAttachingName] = useState("");
  const [attachError, setAttachError] = useState("");

  useEffect(() => {
    if (!scenarioId) return;
    const load = async () => {
      try {
        setLoading(true);
        setFetchError("");
        setDockerHint("");
        const response = await fetch(`/api/scenarios/${scenarioId}/containers`);
        if (response.status === 404) {
          setFetchError("场景不存在");
          setContainers([]);
          return;
        }
        if (!response.ok) {
          const errBody = await response.json().catch(() => ({}));
          const detail = errBody?.detail || errBody?.error;
          setFetchError(detail || `请求失败（HTTP ${response.status}）`);
          setContainers([]);
          return;
        }
        const data = await response.json();
        const list = Array.isArray(data) ? data : data.containers || [];
        setContainers(list);
        if (data && data.dockerOk === false && data.message) {
          setDockerHint(data.message);
        }
      } catch (err) {
        setFetchError(err.message || "Unknown error");
        setContainers([]);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [scenarioId, refreshKey]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-slate-300">容器：</span>
      {loading && <span className="text-xs text-slate-400">Loading containers...</span>}
      {fetchError && <span className="text-xs text-rose-300">{fetchError}</span>}
      {attachError && <span className="text-xs text-rose-300">{attachError}</span>}
      {!loading && !fetchError && dockerHint && (
        <span className="text-xs text-slate-500" title={dockerHint}>
          {dockerHint}
        </span>
      )}
      {!loading &&
        !fetchError &&
        !dockerHint &&
        containers.length === 0 && (
          <span className="text-xs text-slate-500">暂无运行中的容器；启动环境后将显示快捷方式。</span>
        )}
      {!loading &&
        !fetchError &&
        containers.map((container) => (
          <button
            key={container.name}
            type="button"
            disabled={attachingName === container.name}
            onClick={async () => {
              try {
                setAttachError("");
                setAttachingName(container.name);
                await onAttach(container.name);
              } catch (error) {
                setAttachError(error?.message || "容器切换失败");
              } finally {
                setAttachingName("");
              }
            }}
            className="rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-200 hover:border-indigo-400 disabled:cursor-not-allowed disabled:opacity-60"
            title={container.name}
          >
            {attachingName === container.name ? `${container.role}...` : container.role}
          </button>
        ))}
    </div>
  );
}

