import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  Copy,
  FolderKanban,
  Handshake,
  Loader2,
  Mail,
  Plus,
  Receipt,
  Search,
  Scale,
  Smartphone,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import AppLayout from "../components/AppLayout";

const API_BASE_URL = (import.meta.env.VITE_API_URL || "").replace(/\/+$/, "");

interface FriendGroupBreakdown {
  groupId?: string;
  groupName: string;
  owesYou: number;
  youOwe: number;
}

interface FriendItem {
  id?: string;
  email: string;
  name: string;
  upiId: string;
  totalOwedToMe: number;
  totalOwedByMe: number;
  sharedGroups: string[];
  groupBreakdowns: FriendGroupBreakdown[];
}

interface GroupMemberSummary {
  id: string;
  name: string;
  email: string;
  isMe: boolean;
  netBalance: number;
}

interface FriendToFriendTransfer {
  id: string;
  fromName: string;
  toName: string;
  amount: number;
  groupName: string;
  groupId?: string;
  involvesCurrentUser: boolean;
}

interface GroupSummarySnapshot {
  groupId: string;
  groupName: string;
  totalSpend: number;
  members: GroupMemberSummary[];
  transfers: FriendToFriendTransfer[];
}

function formatINR(value: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function getAuthHeaders(): HeadersInit {
  const token = localStorage.getItem("splitmate_token");
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function getCurrentUserEmail(): string {
  try {
    const user = JSON.parse(localStorage.getItem("splitmate_user") || "{}");
    return typeof user.email === "string" ? user.email.trim().toLowerCase() : "";
  } catch {
    return "";
  }
}

export default function FriendsPage() {
  const [friends, setFriends] = useState<FriendItem[]>([]);
  const [groupTransfers, setGroupTransfers] = useState<FriendToFriendTransfer[]>([]);
  const [groupSummaries, setGroupSummaries] = useState<Record<string, GroupSummarySnapshot>>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [addingFriend, setAddingFriend] = useState(false);

  // Tab & inline expandable summary state (zero page redirects)
  const [activeTab, setActiveTab] = useState<"FRIENDS" | "TRANSFERS">("FRIENDS");
  const [expandedFriendEmail, setExpandedFriendEmail] = useState<string | null>(null);
  const [expandedTransferId, setExpandedTransferId] = useState<string | null>(null);

  // Inline 1-on-1 quick split drawer state
  const [quickSplitOpen, setQuickSplitOpen] = useState(false);
  const [splitFriendEmail, setSplitFriendEmail] = useState("");
  const [splitTitle, setSplitTitle] = useState("");
  const [splitAmount, setSplitAmount] = useState("");
  const [splitPaidBy, setSplitPaidBy] = useState<"ME" | "FRIEND">("ME");
  const [splitSaving, setSplitSaving] = useState(false);

  const loadFriendsAndGroupBalances = useCallback(async () => {
    setLoading(true);
    try {
      const headers = getAuthHeaders();
      const [friendsRes, groupsRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/v1/friends`, { headers }),
        fetch(`${API_BASE_URL}/api/v1/groups`, { headers }).catch(() => null),
      ]);

      const friendsPayload = friendsRes.ok ? await friendsRes.json().catch(() => ({})) : {};
      const rawFriends: any[] = Array.isArray(friendsPayload?.data?.friends)
        ? friendsPayload.data.friends
        : Array.isArray(friendsPayload?.data)
          ? friendsPayload.data
          : Array.isArray(friendsPayload)
            ? friendsPayload
            : [];

      const groupsPayload =
        groupsRes && groupsRes.ok ? await groupsRes.json().catch(() => ({})) : {};
      const rawGroups: any[] = Array.isArray(groupsPayload?.data?.groups)
        ? groupsPayload.data.groups
        : Array.isArray(groupsPayload?.data)
          ? groupsPayload.data
          : Array.isArray(groupsPayload)
            ? groupsPayload
            : [];

      const currentUserEmail = getCurrentUserEmail();
      const friendMap = new Map<string, FriendItem>();

      rawFriends.forEach((f) => {
        const email = String(f.email || "").trim().toLowerCase();
        if (!email) return;
        friendMap.set(email, {
          id: f.id ? String(f.id) : undefined,
          email,
          name: String(f.name || f.fullName || email.split("@")[0]),
          upiId: String(f.upiId || `${email.split("@")[0]}@upi`),
          totalOwedToMe: Math.round((Number(f.totalOwedToMe) || 0) * 100) / 100,
          totalOwedByMe: Math.round((Number(f.totalOwedByMe) || 0) * 100) / 100,
          sharedGroups: Array.isArray(f.sharedGroups) ? f.sharedGroups.map(String) : [],
          groupBreakdowns: Array.isArray(f.groupBreakdowns) ? f.groupBreakdowns : [],
        });
      });

      const computedTransfers: FriendToFriendTransfer[] = [];
      const summariesMap: Record<string, GroupSummarySnapshot> = {};

      rawGroups.forEach((grp, gIdx) => {
        const gId = String(grp.id ?? grp._id ?? `grp_${gIdx}`);
        const gName = String(grp.name ?? "Shared Group");
        const members: any[] = Array.isArray(grp.members) ? grp.members : [];
        if (members.length === 0) return;

        const normalizedMembers: GroupMemberSummary[] = members.map((m, idx) => {
          const u = m.user && typeof m.user === "object" ? m.user : {};
          const mEmail = String(m.email ?? u.email ?? "").trim().toLowerCase();
          const isMe =
            m.isCurrentUser === true ||
            (Boolean(currentUserEmail) && mEmail === currentUserEmail);
          return {
            id: String(m.userId ?? m.id ?? `m_${idx}`),
            name: isMe ? "You" : String(m.name ?? u.name ?? mEmail.split("@")[0] ?? "Member"),
            email: mEmail,
            isMe,
            netBalance: Math.round((Number(m.netBalance ?? m.balance ?? 0) || 0) * 100) / 100,
          };
        });

        const meInGroup = normalizedMembers.find((m) => m.isMe);

        normalizedMembers.forEach((m) => {
          if (m.isMe || !m.email) return;
          const existing = friendMap.get(m.email);
          if (existing) {
            if (!existing.sharedGroups.includes(gName)) {
              existing.sharedGroups.push(gName);
            }
            if (!existing.groupBreakdowns.some((b) => b.groupName === gName)) {
              existing.groupBreakdowns.push({
                groupId: gId,
                groupName: gName,
                owesYou: meInGroup && meInGroup.netBalance > 0 && m.netBalance < 0
                  ? Math.min(meInGroup.netBalance, Math.abs(m.netBalance))
                  : 0,
                youOwe: meInGroup && meInGroup.netBalance < 0 && m.netBalance > 0
                  ? Math.min(Math.abs(meInGroup.netBalance), m.netBalance)
                  : 0,
              });
            }
          } else {
            friendMap.set(m.email, {
              id: m.id,
              email: m.email,
              name: m.name,
              upiId: `${m.email.split("@")[0]}@upi`,
              totalOwedToMe: 0,
              totalOwedByMe: 0,
              sharedGroups: [gName],
              groupBreakdowns: [
                {
                  groupId: gId,
                  groupName: gName,
                  owesYou: 0,
                  youOwe: 0,
                },
              ],
            });
          }
        });

        const debtors = normalizedMembers
          .filter((m) => m.netBalance < -0.009)
          .map((m) => ({ ...m, rem: Math.abs(m.netBalance) }))
          .sort((a, b) => b.rem - a.rem);

        const creditors = normalizedMembers
          .filter((m) => m.netBalance > 0.009)
          .map((m) => ({ ...m, rem: m.netBalance }))
          .sort((a, b) => b.rem - a.rem);

        const groupPairTransfers: FriendToFriendTransfer[] = [];
        let i = 0;
        let j = 0;
        while (i < debtors.length && j < creditors.length) {
          const pay = Math.round(Math.min(debtors[i].rem, creditors[j].rem) * 100) / 100;
          if (pay > 0.009) {
            const transfer: FriendToFriendTransfer = {
              id: `${gId}_${debtors[i].id}_${creditors[j].id}`,
              fromName: debtors[i].name,
              toName: creditors[j].name,
              amount: pay,
              groupName: gName,
              groupId: gId,
              involvesCurrentUser: debtors[i].isMe || creditors[j].isMe,
            };
            computedTransfers.push(transfer);
            groupPairTransfers.push(transfer);
          }
          debtors[i].rem -= pay;
          creditors[j].rem -= pay;
          if (debtors[i].rem < 0.01) i++;
          if (creditors[j].rem < 0.01) j++;
        }

        const rawExpenses: any[] = Array.isArray(grp.expenses) ? grp.expenses : [];
        const totalSpend =
          Number(grp.totalSpend ?? grp.totalAmount) ||
          rawExpenses.reduce((sum, e) => sum + (Number(e.totalAmount ?? e.amount) || 0), 0);

        summariesMap[gId] = {
          groupId: gId,
          groupName: gName,
          totalSpend: Math.round(totalSpend * 100) / 100,
          members: normalizedMembers,
          transfers: groupPairTransfers,
        };
      });

      const list = Array.from(friendMap.values());
      setFriends(list);
      setGroupTransfers(computedTransfers);
      setGroupSummaries(summariesMap);
      if (list.length > 0 && !splitFriendEmail) {
        setSplitFriendEmail(list[0].email);
      }
    } catch (err) {
      console.error("Failed to load friends:", err);
    } finally {
      setLoading(false);
    }
  }, [splitFriendEmail]);

  useEffect(() => {
    void loadFriendsAndGroupBalances();
  }, [loadFriendsAndGroupBalances]);

  const summary = useMemo(() => {
    let totalOwedToMe = 0;
    let totalOwedByMe = 0;

    friends.forEach((f) => {
      totalOwedToMe += Number(f.totalOwedToMe) || 0;
      totalOwedByMe += Number(f.totalOwedByMe) || 0;
    });

    return {
      totalOwedToMe: Math.round(totalOwedToMe * 100) / 100,
      totalOwedByMe: Math.round(totalOwedByMe * 100) / 100,
      netBalance: Math.round((totalOwedToMe - totalOwedByMe) * 100) / 100,
    };
  }, [friends]);

  const filteredFriends = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return friends;
    return friends.filter(
      (f) =>
        f.name.toLowerCase().includes(q) ||
        f.email.toLowerCase().includes(q) ||
        f.upiId?.toLowerCase().includes(q) ||
        f.sharedGroups.some((g) => g.toLowerCase().includes(q))
    );
  }, [friends, searchQuery]);

  const filteredTransfers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return groupTransfers;
    return groupTransfers.filter(
      (t) =>
        t.fromName.toLowerCase().includes(q) ||
        t.toName.toLowerCase().includes(q) ||
        t.groupName.toLowerCase().includes(q)
    );
  }, [groupTransfers, searchQuery]);

  async function handleSendFriendRequest(e: React.FormEvent) {
    e.preventDefault();
    const clean = inviteEmail.trim().toLowerCase();
    if (!clean || addingFriend) return;
    if (friends.some((f) => f.email.toLowerCase() === clean)) {
      setInviteEmail("");
      return;
    }

    setAddingFriend(true);
    const optimisticFriend: FriendItem = {
      name: clean.split("@")[0],
      email: clean,
      upiId: `${clean.split("@")[0]}@upi`,
      totalOwedToMe: 0,
      totalOwedByMe: 0,
      sharedGroups: [],
      groupBreakdowns: [],
    };
    setFriends((prev) => [optimisticFriend, ...prev]);
    setInviteEmail("");

    try {
      await fetch(`${API_BASE_URL}/api/v1/friends/requests`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ email: clean }),
      });
    } catch {
      // Keep optimistic entry
    } finally {
      setAddingFriend(false);
    }
  }

  async function handleQuickSplitSubmit(e: React.FormEvent) {
    e.preventDefault();
    const numeric = parseFloat(splitAmount);
    if (!splitFriendEmail || !splitTitle.trim() || !Number.isFinite(numeric) || numeric <= 0) return;

    const half = Math.round((numeric / 2) * 100) / 100;
    setSplitSaving(true);

    // Optimistically update friend balance right on this page
    setFriends((prev) =>
      prev.map((f) => {
        if (f.email !== splitFriendEmail) return f;
        return {
          ...f,
          totalOwedToMe:
            splitPaidBy === "ME"
              ? Math.round((f.totalOwedToMe + half) * 100) / 100
              : f.totalOwedToMe,
          totalOwedByMe:
            splitPaidBy === "FRIEND"
              ? Math.round((f.totalOwedByMe + half) * 100) / 100
              : f.totalOwedByMe,
        };
      })
    );

    try {
      await fetch(`${API_BASE_URL}/api/v1/expenses`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          title: splitTitle.trim(),
          totalAmount: numeric,
          friendEmail: splitFriendEmail,
          paidBy: splitPaidBy,
          splitType: "EQUAL",
        }),
      });
      window.dispatchEvent(new Event("splitmate:notifications-refresh"));
    } catch {
      // Keep optimistic update
    } finally {
      setSplitSaving(false);
      setSplitTitle("");
      setSplitAmount("");
      setQuickSplitOpen(false);
    }
  }

  return (
    <AppLayout
      title="Friends & Balances"
      subtitle="Tap any friend or transfer to view full balance summary here"
      headerActions={
        <button
          type="button"
          onClick={() => setQuickSplitOpen((prev) => !prev)}
          className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-indigo-600 px-3 text-xs font-bold text-white shadow-xs transition hover:bg-indigo-700 cursor-pointer"
        >
          {quickSplitOpen ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          <span>{quickSplitOpen ? "Close" : "Split 1-on-1"}</span>
        </button>
      }
    >
      <div className="space-y-4 sm:space-y-5 pb-20 sm:pb-6">
        {/* INLINE QUICK 1-ON-1 SPLIT DRAWER (No redirect) */}
        {quickSplitOpen && (
          <form
            onSubmit={handleQuickSplitSubmit}
            className="space-y-3 rounded-2xl border border-indigo-300 bg-white p-3.5 shadow-md sm:p-5 dark:border-indigo-700 dark:bg-zinc-900"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Receipt className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                <h2 className="font-display text-sm font-bold text-slate-900 sm:text-base dark:text-white">
                  Quick 1-on-1 Split (50/50)
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setQuickSplitOpen(false)}
                className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 dark:text-zinc-400 dark:hover:bg-zinc-800 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-200">
                  Friend
                </label>
                <select
                  required
                  value={splitFriendEmail}
                  onChange={(e) => setSplitFriendEmail(e.target.value)}
                  className="mt-1 h-10 w-full rounded-xl border border-slate-300 bg-slate-50 px-2.5 text-xs font-bold text-slate-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                >
                  {friends.length === 0 ? (
                    <option value="">Add a friend first</option>
                  ) : (
                    friends.map((f) => (
                      <option key={f.email} value={f.email}>
                        {f.name}
                      </option>
                    ))
                  )}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-200">
                  Description
                </label>
                <input
                  required
                  placeholder="e.g. Lunch, Cab"
                  value={splitTitle}
                  onChange={(e) => setSplitTitle(e.target.value)}
                  className="mt-1 h-10 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 text-xs font-medium text-slate-900 outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-200">
                  Total Amount (₹)
                </label>
                <input
                  required
                  type="number"
                  step="0.01"
                  min="0.01"
                  placeholder="400.00"
                  value={splitAmount}
                  onChange={(e) => setSplitAmount(e.target.value)}
                  className="mt-1 h-10 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 text-xs font-bold text-slate-900 tabular-nums outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-200">
                  Paid By
                </label>
                <select
                  value={splitPaidBy}
                  onChange={(e) => setSplitPaidBy(e.target.value as "ME" | "FRIEND")}
                  className="mt-1 h-10 w-full rounded-xl border border-slate-300 bg-slate-50 px-2.5 text-xs font-bold text-slate-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                >
                  <option value="ME">You paid</option>
                  <option value="FRIEND">Friend paid</option>
                </select>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={splitSaving || friends.length === 0}
                className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-emerald-600 px-4 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50 cursor-pointer"
              >
                <Check className="h-4 w-4" />
                {splitSaving ? "Saving..." : "Save 50/50 Split"}
              </button>
            </div>
          </form>
        )}

        {/* Compact Summary Strip */}
        <section className="grid grid-cols-2 gap-2.5 sm:gap-4 lg:grid-cols-3">
          <div className="rounded-2xl border border-emerald-200 bg-white p-3.5 shadow-2xs sm:p-5 dark:border-emerald-800/60 dark:bg-zinc-900">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-xs font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                To Receive
              </span>
              <span className="hidden h-8 w-8 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 sm:flex dark:bg-emerald-950 dark:text-emerald-400">
                <ArrowDownLeft className="h-4 w-4" />
              </span>
            </div>
            <p className="mt-1.5 truncate font-display text-lg font-extrabold text-emerald-600 tabular-nums sm:text-2xl dark:text-emerald-400">
              {formatINR(summary.totalOwedToMe)}
            </p>
            <p className="mt-0.5 truncate text-xs text-slate-600 dark:text-zinc-300">
              Friends need to give you
            </p>
          </div>

          <div className="rounded-2xl border border-rose-200 bg-white p-3.5 shadow-2xs sm:p-5 dark:border-rose-800/60 dark:bg-zinc-900">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-xs font-bold uppercase tracking-wider text-rose-600 dark:text-rose-400">
                To Give
              </span>
              <span className="hidden h-8 w-8 items-center justify-center rounded-xl bg-rose-50 text-rose-600 sm:flex dark:bg-rose-950 dark:text-rose-400">
                <ArrowUpRight className="h-4 w-4" />
              </span>
            </div>
            <p className="mt-1.5 truncate font-display text-lg font-extrabold text-rose-600 tabular-nums sm:text-2xl dark:text-rose-400">
              {formatINR(summary.totalOwedByMe)}
            </p>
            <p className="mt-0.5 truncate text-xs text-slate-600 dark:text-zinc-300">
              You need to give friends
            </p>
          </div>

          <div className="col-span-2 rounded-2xl border border-indigo-200 bg-white p-3.5 shadow-2xs sm:rounded-2xl sm:p-5 lg:col-span-1 dark:border-indigo-800/60 dark:bg-zinc-900">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-xs font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                Net Friend Position
              </span>
              <span className="hidden h-8 w-8 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 sm:flex dark:bg-indigo-950 dark:text-indigo-400">
                <Scale className="h-4 w-4" />
              </span>
            </div>
            <p
              className={`mt-1.5 truncate font-display text-lg font-extrabold tabular-nums sm:text-2xl ${
                summary.netBalance > 0
                  ? "text-emerald-600 dark:text-emerald-400"
                  : summary.netBalance < 0
                    ? "text-rose-600 dark:text-rose-400"
                    : "text-slate-900 dark:text-white"
              }`}
            >
              {summary.netBalance > 0
                ? `+${formatINR(summary.netBalance)}`
                : summary.netBalance < 0
                  ? `-${formatINR(Math.abs(summary.netBalance))}`
                  : "All Settled (₹0.00)"}
            </p>
            <p className="mt-0.5 truncate text-xs text-slate-600 dark:text-zinc-300">
              Across {friends.length} {friends.length === 1 ? "friend" : "friends"}
            </p>
          </div>
        </section>

        {/* Add Friend & Search Row */}
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
          <form
            onSubmit={handleSendFriendRequest}
            className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-2xs sm:p-4 lg:col-span-7 dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div className="relative flex-1">
              <Mail className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-zinc-400" />
              <input
                type="email"
                required
                placeholder="Add friend by email address..."
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                className="h-10 w-full rounded-xl border border-slate-300 bg-slate-50 pr-3 pl-9 text-xs font-medium text-slate-900 placeholder:text-slate-400 outline-none focus:border-indigo-500 focus:bg-white sm:text-sm dark:border-zinc-700 dark:bg-zinc-950 dark:text-white dark:placeholder:text-zinc-500 dark:focus:bg-zinc-900"
              />
            </div>
            <button
              type="submit"
              disabled={addingFriend}
              className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 text-xs font-bold text-white shadow-xs transition hover:bg-indigo-700 disabled:opacity-50 cursor-pointer"
            >
              <UserPlus className="h-4 w-4" />
              <span>Add</span>
            </button>
          </form>

          <div className="flex items-center rounded-2xl border border-slate-200 bg-white p-3 shadow-2xs sm:p-4 lg:col-span-5 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="relative w-full">
              <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-zinc-400" />
              <input
                type="text"
                placeholder="Search friend, group, or UPI..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-10 w-full rounded-xl border border-slate-300 bg-slate-50 pr-3 pl-9 text-xs font-medium text-slate-900 placeholder:text-slate-400 outline-none focus:border-indigo-500 focus:bg-white sm:text-sm dark:border-zinc-700 dark:bg-zinc-950 dark:text-white dark:placeholder:text-zinc-500 dark:focus:bg-zinc-900"
              />
            </div>
          </div>
        </div>

        {/* View Toggle: Friends List vs All-Pairs "Who Owes Whom" */}
        <div className="grid grid-cols-2 gap-1.5 rounded-xl border border-slate-200 bg-slate-100 p-1 sm:inline-flex dark:border-zinc-800 dark:bg-zinc-900">
          <button
            type="button"
            onClick={() => setActiveTab("FRIENDS")}
            className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-lg px-4 text-xs font-bold transition cursor-pointer ${
              activeTab === "FRIENDS"
                ? "bg-white text-indigo-600 shadow-xs dark:bg-zinc-800 dark:text-white"
                : "text-slate-600 hover:text-slate-900 dark:text-zinc-300"
            }`}
          >
            <Users className="h-3.5 w-3.5" />
            <span>Friends ({filteredFriends.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("TRANSFERS")}
            className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-lg px-4 text-xs font-bold transition cursor-pointer ${
              activeTab === "TRANSFERS"
                ? "bg-white text-indigo-600 shadow-xs dark:bg-zinc-800 dark:text-white"
                : "text-slate-600 hover:text-slate-900 dark:text-zinc-300"
            }`}
          >
            <Handshake className="h-3.5 w-3.5" />
            <span>Who Owes Whom ({filteredTransfers.length})</span>
          </button>
        </div>

        {/* Loading State */}
        {loading ? (
          <div className="flex items-center justify-center rounded-2xl border border-slate-200 bg-white p-10 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex items-center gap-2.5 text-sm font-semibold text-slate-700 dark:text-zinc-200">
              <Loader2 className="h-5 w-5 animate-spin text-indigo-600 dark:text-indigo-400" />
              <span>Loading friends and balances...</span>
            </div>
          </div>
        ) : activeTab === "TRANSFERS" ? (
          /* ALL-PAIRS WHO NEEDS TO GIVE WHOM WITH INLINE EXPANDABLE SUMMARY */
          <div className="space-y-2.5">
            {filteredTransfers.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center dark:border-zinc-700 dark:bg-zinc-900">
                <Handshake className="mx-auto h-8 w-8 text-emerald-500" />
                <p className="mt-2 text-sm font-bold text-slate-900 dark:text-white">
                  No pending group transfers
                </p>
                <p className="mt-1 text-xs text-slate-600 dark:text-zinc-300">
                  Everyone across your shared groups is settled up!
                </p>
              </div>
            ) : (
              filteredTransfers.map((tr) => {
                const isSummaryOpen = expandedTransferId === tr.id;
                const snapshot = tr.groupId ? groupSummaries[tr.groupId] : undefined;

                return (
                  <div
                    key={tr.id}
                    className={`overflow-hidden rounded-2xl border transition ${
                      tr.involvesCurrentUser
                        ? "border-indigo-300 bg-indigo-50/40 dark:border-indigo-700/70 dark:bg-indigo-950/30"
                        : "border-slate-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setExpandedTransferId(isSummaryOpen ? null : tr.id)}
                      aria-expanded={isSummaryOpen}
                      className="flex w-full items-center justify-between gap-3 p-3.5 text-left sm:p-4 cursor-pointer"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5 text-xs font-bold text-slate-900 sm:text-sm dark:text-white">
                          <span>{tr.fromName}</span>
                          <ArrowRight className="h-3.5 w-3.5 text-slate-500 dark:text-zinc-400" />
                          <span>{tr.toName}</span>
                        </div>
                        <div className="mt-1 flex items-center gap-2">
                          <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700 dark:bg-zinc-800 dark:text-zinc-200">
                            <FolderKanban className="h-3 w-3 text-indigo-500" />
                            {tr.groupName}
                          </span>
                          <span className="text-xs font-semibold text-indigo-600 dark:text-indigo-400">
                            {isSummaryOpen ? "Hide summary" : "View summary"}
                          </span>
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        <span className="font-display text-sm font-black tabular-nums text-indigo-600 sm:text-base dark:text-indigo-400">
                          {formatINR(tr.amount)}
                        </span>
                        <ChevronDown
                          className={`h-4 w-4 text-slate-500 transition-transform dark:text-zinc-400 ${
                            isSummaryOpen ? "rotate-180 text-indigo-600" : ""
                          }`}
                        />
                      </div>
                    </button>

                    {/* INLINE GROUP SUMMARY DRAWER (No redirect) */}
                    {isSummaryOpen && snapshot && (
                      <div className="space-y-3 border-t border-slate-200 bg-slate-50 p-3.5 sm:p-4 dark:border-zinc-800 dark:bg-zinc-950">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400">
                            {snapshot.groupName} Summary
                          </span>
                          <span className="font-bold text-slate-900 tabular-nums dark:text-white">
                            Total Spend: {formatINR(snapshot.totalSpend)}
                          </span>
                        </div>

                        <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
                          <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400">
                            Member Balances
                          </p>
                          <div className="divide-y divide-slate-100 dark:divide-zinc-800">
                            {snapshot.members.map((m) => (
                              <div
                                key={m.id}
                                className="flex items-center justify-between py-1.5 text-xs"
                              >
                                <span className="font-semibold text-slate-800 dark:text-zinc-200">
                                  {m.name}
                                </span>
                                <span
                                  className={`font-extrabold tabular-nums ${
                                    m.netBalance > 0.009
                                      ? "text-emerald-600 dark:text-emerald-400"
                                      : m.netBalance < -0.009
                                        ? "text-rose-600 dark:text-rose-400"
                                        : "text-slate-500 dark:text-zinc-400"
                                  }`}
                                >
                                  {m.netBalance > 0.009
                                    ? `Gets +${formatINR(m.netBalance)}`
                                    : m.netBalance < -0.009
                                      ? `Gives ${formatINR(Math.abs(m.netBalance))}`
                                      : "Settled"}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        ) : filteredFriends.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center dark:border-zinc-700 dark:bg-zinc-900">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-100 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-400">
              <Users className="h-6 w-6" />
            </div>
            <h2 className="mt-3 font-display text-base font-bold text-slate-900 dark:text-white">
              {searchQuery.trim() ? "No matching friends found" : "No friends added yet"}
            </h2>
            <p className="mt-1 text-xs text-slate-600 dark:text-zinc-300">
              {searchQuery.trim()
                ? "Try a different name, email, or group."
                : "Add a friend using their email address above to track balances."}
            </p>
          </div>
        ) : (
          /* FRIENDS CARDS WITH INLINE EXPANDABLE SUMMARY */
          <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
            {filteredFriends.map((friend) => {
              const owedToMe = Number(friend.totalOwedToMe) || 0;
              const owedByMe = Number(friend.totalOwedByMe) || 0;
              const net = Math.round((owedToMe - owedByMe) * 100) / 100;
              const isCardExpanded = expandedFriendEmail === friend.email;

              return (
                <div
                  key={friend.email}
                  className="flex flex-col justify-between overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xs transition hover:border-indigo-300 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-indigo-700"
                >
                  <div
                    className={`h-1.5 w-full ${
                      net > 0.009
                        ? "bg-emerald-500"
                        : net < -0.009
                          ? "bg-rose-500"
                          : "bg-slate-200 dark:bg-zinc-800"
                    }`}
                  />

                  <div className="p-3.5 sm:p-5">
                    {/* Top: Avatar, Name & Net Position */}
                    <div className="flex items-start justify-between gap-2.5">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-100 font-display text-sm font-extrabold text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                          {friend.name
                            .split(" ")
                            .slice(0, 2)
                            .map((n) => n[0]?.toUpperCase())
                            .join("")}
                        </div>
                        <div className="min-w-0">
                          <h2 className="truncate font-display text-sm font-bold text-slate-900 sm:text-base dark:text-white">
                            {friend.name}
                          </h2>
                          <p className="truncate text-xs text-slate-500 dark:text-zinc-400">
                            {friend.email}
                          </p>
                        </div>
                      </div>

                      <div className="shrink-0 text-right">
                        <span
                          className={`inline-block rounded-lg px-2.5 py-1 font-display text-xs font-extrabold tabular-nums sm:text-sm ${
                            net > 0.009
                              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
                              : net < -0.009
                                ? "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200"
                                : "bg-slate-100 text-slate-700 dark:bg-zinc-800 dark:text-zinc-300"
                          }`}
                        >
                          {net > 0.009
                            ? `Owes you ${formatINR(net)}`
                            : net < -0.009
                              ? `You owe ${formatINR(Math.abs(net))}`
                              : "Settled up"}
                        </span>
                      </div>
                    </div>

                    {/* Clear 2-Column Give / Receive Breakdown */}
                    <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl border border-slate-200/80 bg-slate-50 p-2.5 dark:border-zinc-800 dark:bg-zinc-950">
                      <div>
                        <p className="text-[11px] font-semibold text-slate-500 dark:text-zinc-400">
                          Needs to give you
                        </p>
                        <p className="mt-0.5 text-xs font-extrabold tabular-nums text-emerald-600 sm:text-sm dark:text-emerald-400">
                          {formatINR(owedToMe)}
                        </p>
                      </div>
                      <div className="border-l border-slate-200 pl-2.5 dark:border-zinc-800">
                        <p className="text-[11px] font-semibold text-slate-500 dark:text-zinc-400">
                          You need to give
                        </p>
                        <p className="mt-0.5 text-xs font-extrabold tabular-nums text-rose-600 sm:text-sm dark:text-rose-400">
                          {formatINR(owedByMe)}
                        </p>
                      </div>
                    </div>

                    {/* Inline Expandable Group-by-Group Summary */}
                    {isCardExpanded && (
                      <div className="mt-3 rounded-xl border border-indigo-200/80 bg-indigo-50/40 p-3 text-xs dark:border-indigo-800/60 dark:bg-indigo-950/30">
                        <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-indigo-700 dark:text-indigo-300">
                          Group-by-Group Breakdown
                        </p>
                        {friend.groupBreakdowns.length === 0 ? (
                          <p className="text-slate-600 dark:text-zinc-300">
                            Connected via direct 1-on-1 splits (no shared groups yet).
                          </p>
                        ) : (
                          <div className="divide-y divide-indigo-200/50 dark:divide-indigo-800/50">
                            {friend.groupBreakdowns.map((gb, idx) => (
                              <div
                                key={`${gb.groupName}-${idx}`}
                                className="flex items-center justify-between py-1.5"
                              >
                                <span className="font-semibold text-slate-800 dark:text-zinc-200">
                                  {gb.groupName}
                                </span>
                                <span className="font-bold tabular-nums text-slate-700 dark:text-zinc-300">
                                  {gb.owesYou > 0
                                    ? `Owes you ${formatINR(gb.owesYou)}`
                                    : gb.youOwe > 0
                                      ? `You owe ${formatINR(gb.youOwe)}`
                                      : "Settled in group"}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Footer: Shared Groups, Inline Summary Toggle & Copy UPI */}
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs dark:border-zinc-800">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {friend.sharedGroups.length > 0 ? (
                          friend.sharedGroups.map((g) => (
                            <span
                              key={g}
                              className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700 dark:bg-zinc-800 dark:text-zinc-200"
                            >
                              <FolderKanban className="h-3 w-3 text-indigo-500" />
                              {g}
                            </span>
                          ))
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-lg bg-indigo-50 px-2 py-1 text-xs font-semibold text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                            <Users className="h-3 w-3" />
                            1-on-1 Friend
                          </span>
                        )}

                        <button
                          type="button"
                          onClick={() =>
                            setExpandedFriendEmail(isCardExpanded ? null : friend.email)
                          }
                          className="inline-flex h-8 items-center gap-1 rounded-lg bg-slate-100 px-2.5 text-xs font-bold text-slate-800 hover:bg-slate-200 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700 cursor-pointer"
                        >
                          <span>{isCardExpanded ? "Hide" : "Summary"}</span>
                          <ChevronDown
                            className={`h-3.5 w-3.5 transition-transform ${
                              isCardExpanded ? "rotate-180" : ""
                            }`}
                          />
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard?.writeText(friend.upiId);
                          setCopiedId(friend.email);
                          setTimeout(() => setCopiedId(null), 2000);
                        }}
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-bold text-indigo-600 transition hover:bg-indigo-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-indigo-300 dark:hover:bg-zinc-700 cursor-pointer"
                      >
                        {copiedId === friend.email ? (
                          <>
                            <Check className="h-3.5 w-3.5 text-emerald-500" />
                            <span>Copied</span>
                          </>
                        ) : (
                          <>
                            <Smartphone className="h-3.5 w-3.5 text-slate-400" />
                            <span className="max-w-[120px] truncate">{friend.upiId}</span>
                            <Copy className="h-3 w-3 opacity-80" />
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AppLayout>
  );
}