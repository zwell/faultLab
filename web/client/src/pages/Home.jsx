import { useEffect, useMemo, useState } from "react";
import ScenarioCard from "../components/ScenarioCard.jsx";

const resources = ["light", "medium", "heavy"];
const difficulties = [1, 2, 3, 4, 5];

export default function Home() {
  const [scenarios, setScenarios] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedTech, setSelectedTech] = useState("all");
  const [selectedDifficulties, setSelectedDifficulties] = useState([]);
  const [selectedResources, setSelectedResources] = useState([]);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const response = await fetch("/api/scenarios");
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const data = await response.json();
        setScenarios(data);
      } catch (err) {
        setError(err.message || "Unknown error");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  const techOptions = useMemo(() => {
    const techSet = new Set(scenarios.map((item) => item.tech).filter(Boolean));
    return ["all", ...Array.from(techSet)];
  }, [scenarios]);

  const filteredScenarios = useMemo(
    () =>
      scenarios.filter((item) => {
        if (selectedTech !== "all" && item.tech !== selectedTech) return false;
        if (selectedDifficulties.length > 0 && !selectedDifficulties.includes(item.difficulty)) return false;
        if (selectedResources.length > 0 && !selectedResources.includes(item.resource_level)) return false;
        return true;
      }),
    [scenarios, selectedTech, selectedDifficulties, selectedResources]
  );

  const toggleDifficulty = (value) => {
    setSelectedDifficulties((prev) =>
      prev.includes(value) ? prev.filter((item) => item !== value) : [...prev, value]
    );
  };

  const toggleResource = (value) => {
    setSelectedResources((prev) =>
      prev.includes(value) ? prev.filter((item) => item !== value) : [...prev, value]
    );
  };

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <h1 className="text-2xl font-bold">FaultLab Scenarios</h1>
      <p className="mt-2 text-sm text-slate-400">Choose a scenario and start troubleshooting.</p>

      <section className="mt-6 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
        <div className="flex flex-wrap gap-2">
          {techOptions.map((tech) => (
            <button
              key={tech}
              type="button"
              onClick={() => setSelectedTech(tech)}
              className={`rounded-lg px-3 py-1.5 text-sm ${
                selectedTech === tech ? "bg-indigo-500 text-white" : "bg-slate-800 text-slate-300"
              }`}
            >
              {tech}
            </button>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {difficulties.map((level) => (
            <button
              key={level}
              type="button"
              onClick={() => toggleDifficulty(level)}
              className={`rounded-lg border px-3 py-1.5 text-sm ${
                selectedDifficulties.includes(level)
                  ? "border-amber-400 bg-amber-500/15 text-amber-300"
                  : "border-slate-700 bg-slate-800 text-slate-300"
              }`}
            >
              Difficulty {level}
            </button>
          ))}
        </div>

        <div className="mt-2 flex flex-wrap gap-2">
          {resources.map((resource) => (
            <button
              key={resource}
              type="button"
              onClick={() => toggleResource(resource)}
              className={`rounded-lg border px-3 py-1.5 text-sm ${
                selectedResources.includes(resource)
                  ? "border-emerald-400 bg-emerald-500/10 text-emerald-300"
                  : "border-slate-700 bg-slate-800 text-slate-300"
              }`}
            >
              {resource}
            </button>
          ))}
        </div>
      </section>

      {loading && <p className="mt-6 text-slate-400">Loading scenarios...</p>}
      {error && <p className="mt-6 text-rose-300">Failed to load scenarios: {error}</p>}

      {!loading && !error && (
        <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredScenarios.map((scenario) => (
            <ScenarioCard key={scenario.id} scenario={scenario} />
          ))}
          {filteredScenarios.length === 0 && <p className="text-slate-400">No scenario matches current filters.</p>}
        </section>
      )}
    </main>
  );
}
