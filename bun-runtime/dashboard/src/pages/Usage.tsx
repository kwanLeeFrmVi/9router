import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "../lib/api.ts";
import type { UsageStats } from "../lib/types.ts";
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, Tooltip, Legend,
} from "chart.js";
import { Bar } from "react-chartjs-2";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

const PERIODS = ["24h", "7d", "30d", "all"] as const;
type Period = (typeof PERIODS)[number];

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return String(n);
}

export default function Usage() {
  const [period, setPeriod] = useState<Period>("24h");
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const esRef = useRef<EventSource | null>(null);

  const load = useCallback(async (p: Period) => {
    setLoading(true);
    try {
      const data = await api.usage.stats(p) as UsageStats;
      setStats(data);
    } catch {
      // silently fail, keep previous data
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(period);
    // Poll every 30s
    const id = setInterval(() => load(period), 30_000);
    return () => clearInterval(id);
  }, [period, load]);

  // Also subscribe to SSE for real-time updates
  useEffect(() => {
    const es = new EventSource("/api/usage/stream");
    esRef.current = es;
    es.onmessage = (e) => {
      try { const _ = JSON.parse(e.data); load(period); } catch { /* heartbeat */ }
    };
    return () => { es.close(); esRef.current = null; };
  }, [period, load]);

  const s = stats;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Usage</h1>
        <div className="flex gap-1 rounded-lg border bg-card p-1">
          {PERIODS.map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`rounded px-3 py-1 text-sm font-medium transition-colors ${
                period === p ? "bg-primary text-primary-foreground" : "hover:bg-muted"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {loading && !s && <p className="text-muted-foreground">Loading…</p>}

      {s && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {[
              { label: "Requests",        value: fmt(s.totalRequests) },
              { label: "Prompt Tokens",   value: fmt(s.totalPromptTokens) },
              { label: "Completion Tokens", value: fmt(s.totalCompletionTokens) },
              { label: "Total Cost",      value: "$" + s.totalCost.toFixed(4) },
            ].map(c => (
              <div key={c.label} className="rounded-xl border bg-card p-4">
                <p className="text-sm text-muted-foreground">{c.label}</p>
                <p className="mt-1 text-2xl font-bold tabular-nums">{c.value}</p>
              </div>
            ))}
          </div>

          {/* By-provider bar chart */}
          {s.byProvider.length > 0 && (
            <div className="rounded-xl border bg-card p-4">
              <h2 className="mb-4 text-sm font-semibold">Cost by Provider</h2>
              <Bar
                data={{
                  labels: s.byProvider.map(r => r.provider),
                  datasets: [{
                    label: "Cost ($)",
                    data: s.byProvider.map(r => r.cost),
                    backgroundColor: "rgba(59,130,246,0.6)",
                    borderColor: "rgb(59,130,246)",
                    borderWidth: 1,
                  }],
                }}
                options={{
                  responsive: true,
                  plugins: { legend: { display: false } },
                  scales: { y: { beginAtZero: true } },
                }}
              />
            </div>
          )}

          {/* By-model table */}
          {s.byModel.length > 0 && (
            <div className="rounded-xl border bg-card overflow-hidden">
              <h2 className="p-4 text-sm font-semibold border-b">By Model</h2>
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Model</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">Requests</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">Tokens</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">Cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {s.byModel.map(r => (
                    <tr key={r.model} className="hover:bg-muted/30">
                      <td className="px-4 py-2 font-mono text-xs">{r.model}</td>
                      <td className="px-4 py-2 text-right">{r.requests.toLocaleString()}</td>
                      <td className="px-4 py-2 text-right">{fmt(r.tokens)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">${r.cost.toFixed(4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
