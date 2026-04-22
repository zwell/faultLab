import { useEffect, useState } from "react";

export default function ContainerTabs({ scenarioId, onAttach }) {
  const [containers, setContainers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!scenarioId) return;
    const load = async () => {
      try {
        setLoading(true);
        const response = await fetch(`/api/scenarios/${scenarioId}/containers`);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const data = await response.json();
        setContainers(data);
        setError("");
      } catch (err) {
        setError(err.message || "Unknown error");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [scenarioId]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {loading && <span className="text-xs text-slate-400">Loading containers...</span>}
      {error && <span className="text-xs text-rose-300">Container list unavailable: {error}</span>}
      {!loading &&
        !error &&
        containers.map((container) => (
          <button
            key={container.name}
            type="button"
            onClick={() => onAttach(container.name)}
            className="rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-200 hover:border-indigo-400"
            title={container.name}
          >
            {container.role}
          </button>
        ))}
    </div>
  );
}

