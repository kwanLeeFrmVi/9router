import { useState, useEffect, useRef, useCallback } from "react";
import { Terminal, Trash2 } from "lucide-react";
import type { ConsoleLogEntry } from "../lib/types.ts";

const LEVEL_COLORS: Record<string, string> = {
  info:  "text-cyan-400",
  log:   "text-slate-100",
  warn:  "text-yellow-400",
  error: "text-red-400",
  debug: "text-gray-500",
};

export default function Logs() {
  const [logs, setLogs] = useState<ConsoleLogEntry[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);
  const atBottomRef = useRef(true);

  const scrollToBottom = useCallback(() => {
    if (!autoScroll || !containerRef.current) return;
    containerRef.current.scrollTop = containerRef.current.scrollHeight;
  }, [autoScroll]);

  // Load initial logs
  useEffect(() => {
    fetch("/api/console-logs", {
      headers: { Authorization: `Bearer ${localStorage.getItem("auth_token")}` },
    })
      .then(r => r.json())
      .then((data: ConsoleLogEntry[]) => setLogs(data))
      .catch(() => {});
  }, []);

  // SSE live stream
  useEffect(() => {
    const es = new EventSource("/api/console-logs/stream", {
      // SSE doesn't support custom headers; token is stored from login
    });
    esRef.current = es;

    es.onmessage = (e) => {
      try {
        const entry: ConsoleLogEntry = JSON.parse(e.data);
        if ("type" in entry && (entry as { type?: string }).type === "clear") {
          setLogs([]);
        } else {
          setLogs(prev => [...prev.slice(-999), entry]);
        }
      } catch { /* ignore parse errors */ }
    };

    return () => { es.close(); esRef.current = null; };
  }, []);

  // Auto-scroll on new entries
  useEffect(() => { scrollToBottom(); }, [logs, scrollToBottom]);

  // Detect manual scroll
  function handleScroll() {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    atBottomRef.current = scrollHeight - scrollTop - clientHeight < 40;
    setAutoScroll(atBottomRef.current);
  }

  return (
    <div className="flex h-[calc(100vh-3rem)] flex-col gap-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <Terminal className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-xl font-bold">Console Logs</h1>
          <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">{logs.length} lines</span>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
            <input type="checkbox" checked={autoScroll} onChange={e => setAutoScroll((e.target as unknown as { checked: boolean }).checked)} />
            Auto-scroll
          </label>
          <button
            onClick={() => setLogs([])}
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
          >
            <Trash2 className="h-3.5 w-3.5" /> Clear
          </button>
        </div>
      </div>

      {/* Terminal */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto rounded-lg border border-slate-800 bg-[#0d1117] p-4 font-mono text-sm leading-relaxed"
      >
        {logs.map(entry => (
          <div key={entry.id} className={`${LEVEL_COLORS[entry.level] ?? "text-slate-100"}`}>
            <span className="text-gray-600">[{entry.timestamp.split("T")[1]?.split(".")[0]}]</span>{" "}
            <span className="text-gray-500 uppercase text-xs mr-1">[{entry.level}]</span>
            {entry.message}
          </div>
        ))}
        {logs.length === 0 && (
          <div className="text-gray-600 italic">No logs yet. Waiting for output…</div>
        )}
      </div>
    </div>
  );
}
