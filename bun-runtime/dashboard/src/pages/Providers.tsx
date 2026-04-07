import { useState, useEffect } from "react";
import { api } from "../lib/api.ts";
import { Plus, Trash2, Pencil, ToggleLeft, ToggleRight } from "lucide-react";
import type { ProviderConnection } from "../lib/types.ts";

export default function Providers() {
  const [connections, setConnections] = useState<ProviderConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<ProviderConnection | null>(null);
  const [form, setForm] = useState({ provider: "", apiKey: "", baseUrl: "", priority: "100" });

  async function load() {
    setLoading(true);
    try {
      const data = await api.providers.list() as { connections: ProviderConnection[] };
      setConnections(data.connections);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleSave() {
    const payload: Record<string, unknown> = { provider: form.provider, priority: parseInt(form.priority) };
    if (form.apiKey) payload.apiKey = form.apiKey;
    if (form.baseUrl) payload.baseUrl = form.baseUrl;

    try {
      if (editing) {
        await api.providers.update(editing.id, payload);
      } else {
        await api.providers.create(payload);
      }
      setShowModal(false);
      setEditing(null);
      setForm({ provider: "", apiKey: "", baseUrl: "", priority: "100" });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    }
  }

  async function handleToggle(conn: ProviderConnection) {
    try {
      await api.providers.update(conn.id, { isActive: !conn.isActive });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Toggle failed");
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this provider?")) return;
    try {
      await api.providers.remove(id);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  }

  function openEdit(conn: ProviderConnection) {
    setEditing(conn);
    setForm({
      provider: conn.provider ?? "",
      apiKey: (conn.apiKey as string) ?? "",
      baseUrl: (conn.baseUrl as string) ?? "",
      priority: String(conn.priority ?? 100),
    });
    setShowModal(true);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Providers</h1>
        <button
          onClick={() => { setEditing(null); setForm({ provider: "", apiKey: "", baseUrl: "", priority: "100" }); setShowModal(true); }}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" /> Add Provider
        </button>
      </div>

      {error && <div className="rounded-md bg-destructive/10 text-destructive p-3 text-sm">{error}</div>}

      {loading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : connections.length === 0 ? (
        <p className="text-muted-foreground">No providers configured yet.</p>
      ) : (
        <div className="rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left font-medium">Provider</th>
                <th className="px-4 py-3 text-left font-medium">API Key</th>
                <th className="px-4 py-3 text-left font-medium">Priority</th>
                <th className="px-4 py-3 text-left font-medium">Active</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {connections.map(c => (
                <tr key={c.id} className="hover:bg-muted/30">
                  <td className="px-4 py-3 font-mono text-xs">{c.provider}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {c.apiKey ? "••••••••" + (c.apiKey as string).slice(-4) : "—"}
                  </td>
                  <td className="px-4 py-3">{String(c.priority ?? 100)}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => handleToggle(c)} className="text-primary hover:text-primary/80">
                      {c.isActive
                        ? <ToggleRight className="h-5 w-5" />
                        : <ToggleLeft  className="h-5 w-5 text-muted-foreground" />}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => openEdit(c)} className="mr-2 text-muted-foreground hover:text-foreground"><Pencil className="h-4 w-4" /></button>
                    <button onClick={() => handleDelete(c.id)} className="text-destructive hover:text-destructive/80"><Trash2 className="h-4 w-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-xl bg-card p-6 shadow-lg space-y-4">
            <h2 className="text-lg font-semibold">{editing ? "Edit Provider" : "Add Provider"}</h2>
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium">Provider</label>
                <input value={form.provider} onChange={e => setForm(f => ({ ...f, provider: (e.target as unknown as { value: string }).value }))}
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" placeholder="e.g. antigravity" />
              </div>
              <div>
                <label className="text-sm font-medium">API Key</label>
                <input type="password" value={form.apiKey} onChange={e => setForm(f => ({ ...f, apiKey: (e.target as unknown as { value: string }).value }))}
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" placeholder="sk-…" />
              </div>
              <div>
                <label className="text-sm font-medium">Base URL <span className="text-muted-foreground font-normal">(optional)</span></label>
                <input value={form.baseUrl} onChange={e => setForm(f => ({ ...f, baseUrl: (e.target as unknown as { value: string }).value }))}
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" placeholder="https://api.example.com" />
              </div>
              <div>
                <label className="text-sm font-medium">Priority</label>
                <input type="number" value={form.priority} onChange={e => setForm(f => ({ ...f, priority: (e.target as unknown as { value: string }).value }))}
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowModal(false)} className="rounded-md border px-4 py-2 text-sm hover:bg-muted">Cancel</button>
              <button onClick={handleSave} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
