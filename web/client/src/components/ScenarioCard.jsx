import { Link } from "react-router-dom";

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

export default function ScenarioCard({ scenario }) {
  const difficulty = normalizeDifficulty(scenario.difficulty);
  const difficultyInfo = difficultyMeta[difficulty];
  const levelClass = resourceStyles[scenario.resource_level] || "bg-slate-800 text-slate-200 border-slate-600";
  const durationLabel = `${scenario.duration_min || "?"}-${scenario.duration_max || "?"} 分钟`;
  const resourceLabel = resourceLabels[scenario.resource_level] || scenario.resource_level;

  return (
    <Link
      to={`/scenario/${scenario.id}`}
      className="block rounded-xl border border-slate-700 bg-slate-900/70 p-4 transition hover:border-indigo-400 hover:bg-slate-900"
    >
      <h3 className="text-lg font-semibold">{scenario.title}</h3>
      <p className="mt-1 text-sm text-slate-400">{scenario.tech}</p>
      <div className="mt-3 flex items-center justify-between">
        <span className={`rounded border px-2 py-0.5 text-xs font-medium ${difficultyInfo.className}`}>
          L{difficulty} {difficultyInfo.label}
        </span>
        <div className="flex items-center gap-1" aria-label={`difficulty-${difficulty}`}>
          {Array.from({ length: 5 }).map((_, idx) => (
            <span
              key={idx}
              className={`h-1.5 w-4 rounded-sm ${idx < difficulty ? "bg-indigo-400" : "bg-slate-700"}`}
            />
          ))}
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between text-sm text-slate-300">
        <span>{durationLabel}</span>
        <span className={`rounded border px-2 py-0.5 text-xs ${levelClass}`}>{resourceLabel}</span>
      </div>
    </Link>
  );
}
