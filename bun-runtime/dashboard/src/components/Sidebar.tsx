import { useAuth } from "../lib/auth.tsx";
import { NavLink } from "react-router-dom";
import {
  LayoutGrid, Key, BarChart2, Terminal, Box,
  LogOut, ChevronRight,
} from "lucide-react";

const NAV = [
  { to: "/providers", label: "Providers",  Icon: LayoutGrid },
  { to: "/keys",       label: "API Keys",  Icon: Key },
  { to: "/usage",      label: "Usage",     Icon: BarChart2 },
  { to: "/logs",       label: "Console",   Icon: Terminal },
  { to: "/models",     label: "Models",    Icon: Box },
];

export default function Sidebar() {
  const { username, logout } = useAuth();

  return (
    <aside className="flex w-56 flex-col border-r bg-card">
      {/* Logo */}
      <div className="flex items-center gap-2 border-b px-4 py-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground font-bold text-sm">9</div>
        <span className="font-semibold">router</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-0.5 p-3">
        {NAV.map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`
            }
          >
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div className="border-t p-3">
        <div className="mb-1 px-3 py-1 text-xs text-muted-foreground truncate">
          {username ?? "Admin"}
        </div>
        <button
          onClick={logout}
          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <LogOut className="h-4 w-4" />
          Sign Out
        </button>
      </div>
    </aside>
  );
}
