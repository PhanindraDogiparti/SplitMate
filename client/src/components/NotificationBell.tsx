import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Bell, CheckCheck, Loader2, X } from "lucide-react";

const API_BASE_URL = (import.meta.env.VITE_API_URL || "").replace(/\/+$/, "");

export interface AppNotification {
  id: string;
  title?: string;
  message: string;
  isRead: boolean;
  link?: string;
  groupId?: string;
  createdAt: string;
}

function getAuthHeaders(): HeadersInit {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = localStorage.getItem("splitmate_token");
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function formatTimeAgo(iso: string): string {
  const diffSec = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (diffSec < 60) return "Just now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const location = useLocation();

  const unreadCount = items.filter((n) => !n.isRead).length;

  const fetchNotifications = useCallback(async (silent = true) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/notifications`, {
        headers: getAuthHeaders(),
        credentials: "include",
      });
      if (!res.ok) return;
      const json = await res.json();
      const list: AppNotification[] = Array.isArray(json)
        ? json
        : Array.isArray(json?.data)
          ? json.data
          : Array.isArray(json?.notifications)
            ? json.notifications
            : [];
      setItems(
        list.map((n: any) => ({
          id: String(n.id),
          title: n.title || "SplitMate",
          message: n.message || n.body || n.description || "New activity",
          isRead: Boolean(n.isRead ?? n.read ?? false),
          link: n.link || (n.groupId ? `/groups/${n.groupId}` : undefined),
          groupId: n.groupId,
          createdAt: n.createdAt || new Date().toISOString(),
        })),
      );
    } catch {
      // Fail silently during background poll
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  // Initial load + 20s polling + refresh when app/tab regains focus
  useEffect(() => {
    void fetchNotifications(false);
    const interval = window.setInterval(() => void fetchNotifications(true), 20000);
    const onFocus = () => void fetchNotifications(true);
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [fetchNotifications]);

  // Auto-close on route change
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  // Auto-close on outside click/tap and Escape key
  useEffect(() => {
    if (!open) return;

    const handleOutside = (e: MouseEvent | TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("touchstart", handleOutside, { passive: true });
    window.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("touchstart", handleOutside);
      window.removeEventListener("keydown", handleEsc);
    };
  }, [open]);

  async function handleNotificationClick(item: AppNotification) {
    // 1. Optimistically mark as read & close immediately
    setItems((prev) => prev.map((n) => (n.id === item.id ? { ...n, isRead: true } : n)));
    setOpen(false);

    if (item.link) {
      navigate(item.link);
    }

    // 2. Persist read state in background
    if (!item.isRead) {
      void fetch(`${API_BASE_URL}/api/v1/notifications/${encodeURIComponent(item.id)}/read`, {
        method: "PUT",
        headers: getAuthHeaders(),
        credentials: "include",
      }).catch(() => {});
    }
  }

  async function handleMarkAllRead() {
    setItems((prev) => prev.map((n) => ({ ...n, isRead: true })));
    void fetch(`${API_BASE_URL}/api/v1/notifications/read-all`, {
      method: "PUT",
      headers: getAuthHeaders(),
      credentials: "include",
    }).catch(() => {});
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next) void fetchNotifications(true);
        }}
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
        className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 transition hover:bg-slate-50 active:scale-95 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800 cursor-pointer"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-1.5 -right-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-600 px-1 text-[11px] font-extrabold text-white shadow-sm ring-2 ring-white tabular-nums dark:ring-zinc-950">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* Mobile backdrop for effortless tap-to-close */}
          <div
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 bg-slate-950/30 backdrop-blur-[1px] sm:hidden"
          />

          <div className="fixed inset-x-3 top-16 z-50 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl sm:absolute sm:inset-x-auto sm:top-12 sm:right-0 sm:w-96 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-zinc-800">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-extrabold text-slate-900 dark:text-white">
                  Notifications
                </h3>
                {unreadCount > 0 && (
                  <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-bold text-indigo-600 dark:bg-indigo-950/70 dark:text-indigo-300">
                    {unreadCount} new
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1">
                {unreadCount > 0 && (
                  <button
                    type="button"
                    onClick={handleMarkAllRead}
                    className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-950/50 cursor-pointer"
                  >
                    <CheckCheck className="h-3.5 w-3.5" />
                    Read all
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close notifications"
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-zinc-800 cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="max-h-[70dvh] divide-y divide-slate-100 overflow-y-auto sm:max-h-96 dark:divide-zinc-800">
              {loading && items.length === 0 ? (
                <div className="flex items-center justify-center gap-2 py-10 text-xs font-medium text-slate-500">
                  <Loader2 className="h-4 w-4 animate-spin text-indigo-600" />
                  Loading updates...
                </div>
              ) : items.length === 0 ? (
                <div className="py-10 text-center text-xs font-medium text-slate-500 dark:text-zinc-400">
                  You&apos;re all caught up! No notifications yet.
                </div>
              ) : (
                items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleNotificationClick(item)}
                    className={`flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-slate-50 dark:hover:bg-zinc-800/70 cursor-pointer ${
                      !item.isRead ? "bg-indigo-50/40 dark:bg-indigo-950/20" : ""
                    }`}
                  >
                    <span
                      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                        !item.isRead ? "bg-indigo-600" : "bg-transparent"
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs leading-relaxed font-semibold text-slate-800 dark:text-zinc-100">
                        {item.message}
                      </p>
                      <p className="mt-1 text-[11px] font-medium text-slate-400 dark:text-zinc-500">
                        {formatTimeAgo(item.createdAt)}
                      </p>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}