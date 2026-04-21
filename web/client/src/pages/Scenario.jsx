import { Link, useParams } from "react-router-dom";

export default function Scenario() {
  const { id } = useParams();

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <Link to="/" className="text-sm text-indigo-300 hover:text-indigo-200">
        鈫?Back to scenarios
      </Link>

      <section className="mt-4 rounded-xl border border-slate-800 bg-slate-900/60 p-8">
        <h1 className="text-2xl font-semibold">Scenario: {id}</h1>
        <p className="mt-3 text-slate-400">
          Scenario detail page placeholder. README, terminal and action area will be implemented in phase 2.
        </p>
      </section>
    </main>
  );
}
