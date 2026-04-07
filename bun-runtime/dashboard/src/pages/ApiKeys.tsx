import { useState, useEffect } from "react";
import { api } from "../lib/api.ts";
import { maskKey } from "../lib/utils.ts";
import { Plus, Trash2, Copy, ToggleLeft, ToggleRight } from "lucide-react";

interface ApiKey {
  id: string;
  name: string;
  key: string;
  isActive: boolean;
  createdAt?: string;
}

export default function ApiKeys() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [newName, setNewName] = useState("");
  const [newlyCreated, setNewlyCreated] = useState<ApiKey | null>(null);

  async function load() {
    setLoading(true);
    try {
      const data = await api.keys.list() as { keys: ApiKey[] };
      setKeys(data.keys);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleCreate() {
    if (!newName.trim()) return;
    try {
      const created = await api.keys.create(newName) as ApiKey;
      setNewlyCreated(created);
      setNewName("");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
    }
  }

  async function handleToggle(key: ApiKey) {
    try {
      await api.keys.update(key.id, { isActive: !key.isActive });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Toggle failed");
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this API key?")) return;
    try {
      await api.keys.remove(id);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  }

  function copyKey(k: string) {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(k).catch(() => {});
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">API Keys</h1>
        <button
          onClick={() => { setNewlyCreated(null); setShowModal(true); }}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" /> Create Key
        </button>
      </div>

      {error && <div className="rounded-md bg-destructive/10 text-destructive p-3 text-sm">{error}</div>}

      {loading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : keys.length === 0 ? (
        <p className="text-muted-foreground">No API keys yet.</p>
      ) : (
        <div className="rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left font-medium">Name</th>
                <th className="px-4 py-3 text-left font-medium">Key</th>
                <th className="px-4 py-3 text-left font-medium">Created</th>
                <th className="px-4 py-3 text-left font-medium">Active</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {keys.map(k => (
                <tr key={k.id} className="hover:bg-muted/30">
                  <td className="px-4 py-3 font-medium">{k.name}</td>
                  <td className="px-4 py-3 font-mono text-xs">{maskKey(k.key ?? "")}</td>
                  <td className="px-4 py-3 text-muted-foreground">{k.createdAt ? new Date(k.createdAt).toLocaleDateString() : "—"}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => handleToggle(k)} className="text-primary hover:text-primary/80">
                      {k.isActive ? <ToggleRight className="h-5 w-5" /> : <ToggleLeft className="h-5 w-5 text-muted-foreground" />}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => k.key && copyKey(k.key)} className="mr-2 text-muted-foreground hover:text-foreground"><Copy className="h-4 w-4" /></button>
                    <button onClick={() => handleDelete(k.id)} className="text-destructive hover:text-destructive/80"><Trash2 className="h-4 w-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-sm rounded-xl bg-card p-6 shadow-lg space-y-4">
            <h2 className="text-lg font-semibold">Create API Key</h2>

            {newlyCreated ? (
              <>
                <div className="rounded-md bg-green-500/10 border border-green-500/30 p-3">
                  <p className="text-sm font-medium text-green-600 mb-1">Key created! Copy it now — it won't be shown again.</p>
                  <code className="block bg-black/10 rounded px-2 py-1 text-xs font-mono break-all">{newlyCreated.key}</code>
                </div>
                <button onClick={() => { setShowModal(false); setNewlyCreated(null); }} className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Done</button>
              </>
            ) : (
              <>
                <div>
                  <label className="text-sm font-medium">Key Name</label>
                  <input
                    value={newName}
                    onChange={e => setNewName((e.target as unknown as { value: string }).value)}
                    className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    placeholder="My API Key"
                    autoFocus
                    onKeyDown={e => e.key === "Enter" && handleCreate()}
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <button onClick={() => setShowModal(false)} className="rounded-md border px-4 py-2 text-sm hover:bg-muted">Cancel</button>
                  <button onClick={handleCreate} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">Create</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
