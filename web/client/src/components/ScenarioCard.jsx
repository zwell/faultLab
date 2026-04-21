import { Link } from "react-router-dom";

const resourceStyles = {
  light: "bg-emerald-600/20 text-emerald-300 border-emerald-500/40",
  medium: "bg-amber-600/20 text-amber-300 border-amber-500/40",
  heavy: "bg-rose-600/20 text-rose-300 border-rose-500/40"
};

function difficultyStars(level) {
  const safe = Math.max(1, Math.min(5, Number(level) || 1));
  return "*".repeat(safe) + "-".repeat(5 - safe);
}

export default function ScenarioCard({ scenario }) {
  const levelClass = resourceStyles[scenario.resource_level] || "bg-slate-800 text-slate-200 border-slate-600";
  const durationLabel = `${scenario.duration_min || "?"}-${scenario.duration_max || "?"} min`;

  return (
    <Link
      to={`/scenario/${scenario.id}`}
      className="block rounded-xl border border-slate-700 bg-slate-900/70 p-4 transition hover:border-indigo-400 hover:bg-slate-900"
    >
      <h3 className="text-lg font-semibold">{scenario.title}</h3>
      <p className="mt-1 text-sm text-slate-400">{scenario.tech}</p>
      <p className="mt-3 text-sm text-amber-300">{difficultyStars(scenario.difficulty)}</p>
      <div className="mt-3 flex items-center justify-between text-sm text-slate-300">
        <span>{durationLabel}</span>
        <span className={`rounded border px-2 py-0.5 text-xs ${levelClass}`}>{scenario.resource_level}</span>
      </div>
    </Link>
  );
}
