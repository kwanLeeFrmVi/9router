import { useState, useEffect } from "react";
import { api } from "../lib/api.ts";

export default function Models() {
  const [models, setModels] = useState<{ id: string; created: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.models.list()
      .then(data => setModels(data.data ?? []))
      .catch(e => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Models</h1>

      {error && <div className="rounded-md bg-destructive/10 text-destructive p-3 text-sm">{error}</div>}

      {loading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : models.length === 0 ? (
        <p className="text-muted-foreground">No models available.</p>
      ) : (
        <div className="rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left font-medium">Model ID</th>
                <th className="px-4 py-3 text-left font-medium">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {models.map(m => (
                <tr key={m.id} className="hover:bg-muted/30">
                  <td className="px-4 py-3 font-mono text-xs">{m.id}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {m.created ? new Date(m.created * 1000).toLocaleDateString() : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
