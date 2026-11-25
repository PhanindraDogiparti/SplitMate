import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  AlertCircle,
  ArrowLeft,
  ArrowUpDown,
  BarChart3,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  Filter,
  HandCoins,
  Handshake,
  Link2,
  Loader2,
  Plus,
  Receipt,
  RotateCcw,
  Shield,
  SlidersHorizontal,
  Share2,
  Sparkles,
  Tag,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import AppLayout from "../components/AppLayout";
import GroupSettlementSection, {
  type CompletedSettlementItem,
} from "../components/GroupSettlementSection";
import GroupBillsSection, {
  type ExpenseAllocationItem,
  type GroupExpenseItem,
  type SplitMethod,
} from "../components/GroupBillsSection";

const EditExpenseModal = lazy(() => import("../components/EditExpenseModal"));
const GroupMembersModal = lazy(() => import("../components/GroupMembersModal"));
const ShareModal = lazy(() => import("../components/ShareModal"));

const API_BASE_URL = (import.meta.env.VITE_API_URL || "").replace(/\/+$/, "");

type GroupType = "TRIP" | "ROOMMATE" | "FRIENDS" | "CUSTOM";
type ExpenseSortOption = "RECENT" | "AMOUNT_DESC" | "AMOUNT_ASC" | "MY_SHARE_DESC";
type DateFilterOption = "ALL" | "TODAY" | "LAST_7_DAYS" | "THIS_MONTH" | "CUSTOM";
type MobileTab = "SETTLE" | "EXPENSES" | "MEMBERS";

const REOPEN_WINDOW_MS = 24 * 60 * 60 * 1000;

interface GroupMemberItem {
  id: string;
  name: string;
  email: string;
  upiId?: string;
  isCurrentUser: boolean;
  role: "ADMIN" | "MEMBER";
  netBalance: number;
}

interface GroupDetailData {
  id: string;
  name: string;
  description: string;
  type: GroupType;
  customTypeLabel?: string;
  currency: string;
  simplifyDebts: boolean;
  members: GroupMemberItem[];
  expenses: GroupExpenseItem[];
  completedSettlements: CompletedSettlementItem[];
}

interface SettlementToastData {
  id: number;
  headline: string;
  subtext: string;
  amountLabel?: string;
}

function getAuthHeaders(): HeadersInit {
  const token = localStorage.getItem("splitmate_token");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function getCurrentUserEmail(): string {
  try {
    const user = JSON.parse(localStorage.getItem("splitmate_user") || "{}");
    return typeof user.email === "string" ? user.email.trim().toLowerCase() : "";
  } catch {
    return "";
  }
}

function normalizeGroupType(rawType: unknown): GroupType {
  const upper = String(rawType || "FRIENDS").toUpperCase();
  if (upper === "TRIP" || upper === "ROOMMATE" || upper === "FRIENDS" || upper === "CUSTOM") {
    return upper;
  }
  return "CUSTOM";
}

function normalizeSplitMethod(rawSplit: unknown): SplitMethod {
  const upper = String(rawSplit || "EQUAL").toUpperCase();
  if (upper === "EQUAL" || upper === "EXACT" || upper === "PERCENTAGE" || upper === "SHARES") {
    return upper;
  }
  return "EQUAL";
}

function getExpenseVersionToken(expenses: GroupExpenseItem[]): string {
  const latestUpdatedAt = expenses.reduce((latest, expense) => {
    const updatedAt = expense.updatedAt || "";
    return updatedAt > latest ? updatedAt : latest;
  }, "");
  return `${expenses.length}:${latestUpdatedAt}`;
}

function parseSortableTimestamp(rawPrimary: unknown, rawFallback: unknown): number {
  for (const candidate of [rawPrimary, rawFallback]) {
    if (typeof candidate === "number" && Number.isFinite(candidate)) return candidate;
    if (typeof candidate === "string" && candidate.trim()) {
      const parsed = Date.parse(candidate.trim());
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return 0;
}

function normalizeGroupDetail(raw: Record<string, unknown>, fallbackId: string): GroupDetailData {
  const currentUserEmail = getCurrentUserEmail();
  const rawMembers = Array.isArray(raw.members) ? raw.members : [];
  const members: GroupMemberItem[] = rawMembers.map((m, idx) => {
    const memberObj = (m && typeof m === "object" ? m : {}) as Record<string, unknown>;
    const nestedUser =
      memberObj.user && typeof memberObj.user === "object"
        ? (memberObj.user as Record<string, unknown>)
        : {};
    const rawId = String(memberObj.userId ?? memberObj.id ?? memberObj._id ?? `m_${idx}`);
    const email = String(memberObj.email ?? nestedUser.email ?? "");
    const isCurrentUser =
      memberObj.isCurrentUser === true ||
      rawId === "you" ||
      rawId === "current_user" ||
      (Boolean(currentUserEmail) && email.trim().toLowerCase() === currentUserEmail);

    return {
      id: rawId,
      name: String(
        memberObj.name ??
          memberObj.fullName ??
          nestedUser.name ??
          nestedUser.fullName ??
          (isCurrentUser ? "You" : `Member ${idx + 1}`)
      ),
      email,
      upiId: memberObj.upiId ? String(memberObj.upiId) : undefined,
      isCurrentUser,
      role: String(memberObj.role || "MEMBER").toUpperCase() === "ADMIN" ? "ADMIN" : "MEMBER",
      netBalance: Number(memberObj.netBalance ?? memberObj.balance ?? 0) || 0,
    };
  });

  const currentUserId = members.find((member) => member.isCurrentUser)?.id;
  const memberNameMap = new Map(members.map((m) => [m.id, m.name]));

  const rawExpenses = Array.isArray(raw.expenses) ? raw.expenses : [];
  const expenses: GroupExpenseItem[] = rawExpenses.map((e, idx) => {
    const expObj = (e && typeof e === "object" ? e : {}) as Record<string, unknown>;
    const settledAtRaw = expObj.settledAt;
    const settledAt =
      typeof settledAtRaw === "number"
        ? settledAtRaw
        : settledAtRaw
          ? new Date(String(settledAtRaw)).getTime() || undefined
          : undefined;
    const totalAmount = Number(expObj.totalAmount ?? expObj.amount ?? 0) || 0;

    const rawPayers = Array.isArray(expObj.payers) ? expObj.payers : [];
    const payers: ExpenseAllocationItem[] = rawPayers.map((payer) => {
      const payerObj = (payer && typeof payer === "object" ? payer : {}) as Record<string, unknown>;
      const mId = String(payerObj.memberId ?? payerObj.member_id ?? "");
      return {
        memberId: mId,
        memberName: String(
          payerObj.memberName ?? payerObj.name ?? memberNameMap.get(mId) ?? "Member"
        ),
        amount: Number(payerObj.amount ?? 0) || 0,
      };
    });

    const rawSplits = Array.isArray(expObj.splits) ? expObj.splits : [];
    const splits: ExpenseAllocationItem[] = rawSplits.map((split) => {
      const splitObj = (split && typeof split === "object" ? split : {}) as Record<string, unknown>;
      const mId = String(splitObj.memberId ?? splitObj.member_id ?? "");
      return {
        memberId: mId,
        memberName: String(
          splitObj.memberName ?? splitObj.name ?? memberNameMap.get(mId) ?? "Member"
        ),
        amount: Number(splitObj.amount ?? 0) || 0,
      };
    });

    const paidById = String(expObj.paidByMemberId ?? expObj.paidById ?? payers[0]?.memberId ?? "you");
    if (payers.length === 0) {
      payers.push({
        memberId: paidById,
        memberName: String(expObj.paidByName ?? expObj.paidBy ?? memberNameMap.get(paidById) ?? "Member"),
        amount: totalAmount,
      });
    }
    const yourShare =
      splits.find((split) => split.memberId === currentUserId)?.amount ??
      (Number(expObj.yourShare ?? 0) || 0);

    const rawSettled = expObj.isSettled ?? expObj.settled;
    const isSettled =
      rawSettled === true ||
      rawSettled === 1 ||
      String(rawSettled ?? "").trim().toLowerCase() === "true";

    const createdAtStr = String(expObj.createdAt ?? expObj.date ?? "");
    const timestamp = parseSortableTimestamp(expObj.createdAt ?? expObj.date, expObj.updatedAt);

    return {
      id: String(expObj.id ?? expObj._id ?? `ge_${idx}`),
      title: String(expObj.title ?? expObj.description ?? "Expense"),
      category: String(expObj.category ?? "Other"),
      paidById,
      paidByName: String(expObj.paidByName ?? expObj.paidBy ?? "Member"),
      totalAmount,
      yourShare,
      payers,
      splits,
      splitType: normalizeSplitMethod(expObj.splitType ?? expObj.splitMethod),
      paymentMethod: String(expObj.paymentMethod ?? "UPI"),
      date: String(expObj.date ?? expObj.createdAt ?? ""),
      createdAt: createdAtStr,
      timestamp,
      notes: expObj.notes ? String(expObj.notes) : undefined,
      isSettled,
      settledAt,
      updatedAt: String(expObj.updatedAt ?? expObj.createdAt ?? ""),
    };
  });

  const rawSettlements = Array.isArray(raw.completedSettlements)
    ? raw.completedSettlements
    : Array.isArray(raw.settlements)
      ? raw.settlements
      : [];

  const completedSettlements: CompletedSettlementItem[] = rawSettlements.map((s, idx) => {
    const sObj = (s && typeof s === "object" ? s : {}) as Record<string, unknown>;
    return {
      id: String(sObj.id ?? sObj._id ?? `cs_${idx}`),
      fromId: sObj.fromMemberId ? String(sObj.fromMemberId) : sObj.fromId ? String(sObj.fromId) : undefined,
      from: String(sObj.from ?? sObj.fromName ?? "Member"),
      toId: sObj.toMemberId ? String(sObj.toMemberId) : sObj.toId ? String(sObj.toId) : undefined,
      to: String(sObj.to ?? sObj.toName ?? "Member"),
      amount: Number(sObj.amount ?? 0) || 0,
      remainingAfter: sObj.remainingAfter !== undefined ? Number(sObj.remainingAfter) || 0 : undefined,
      method: String(sObj.method ?? "UPI"),
      referenceId: sObj.referenceId ? String(sObj.referenceId) : undefined,
      completedAt: String(sObj.completedAt ?? sObj.createdAt ?? "Just now"),
    };
  });

  return {
    id: String(raw.id ?? raw._id ?? fallbackId),
    name: String(raw.name ?? "Group"),
    description: String(raw.description ?? "Shared group expenses"),
    type: normalizeGroupType(raw.type),
    customTypeLabel: raw.customTypeLabel ? String(raw.customTypeLabel) : undefined,
    currency: String(raw.currency ?? "INR"),
    simplifyDebts: raw.simplifyDebts !== false,
    members:
      members.length > 0
        ? members
        : [{ id: "you", name: "You", email: "", isCurrentUser: true, role: "ADMIN", netBalance: 0 }],
    expenses,
    completedSettlements,
  };
}

function formatINR(value: number, currency = "INR"): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function parseExpenseDate(dateStr: string): Date | null {
  const clean = dateStr.trim().toLowerCase();
  if (clean === "today" || clean === "just now") {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }
  if (clean === "yesterday") {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  }
  const parsed = new Date(dateStr);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}

export default function GroupDetailsPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const navigate = useNavigate();
  const resolvedGroupId = groupId || "";

  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [mobileTab, setMobileTab] = useState<MobileTab>("EXPENSES");

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const [group, setGroup] = useState<GroupDetailData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const groupExpenseVersionRef = useRef<string | null>(null);

  const fetchGroupDetail = useCallback(async (showLoading = true) => {
    if (!resolvedGroupId) {
      setLoadError("Missing group ID.");
      if (showLoading) setLoading(false);
      return;
    }

    if (showLoading) setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/groups/${resolvedGroupId}`, {
        headers: getAuthHeaders(),
        cache: "no-store",
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.message || "Failed to load group details.");

      const rawData =
        payload.data && typeof payload.data === "object"
          ? (payload.data as Record<string, unknown>)
          : (payload as Record<string, unknown>);
      const nextGroup = normalizeGroupDetail(rawData, resolvedGroupId);
      groupExpenseVersionRef.current = getExpenseVersionToken(nextGroup.expenses);
      setGroup(nextGroup);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : `Could not connect to backend at ${API_BASE_URL}.`;
      if (showLoading) setLoadError(message);
      else throw new Error(message);
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [resolvedGroupId]);

  useEffect(() => {
    fetchGroupDetail();
  }, [fetchGroupDetail]);

  useEffect(() => {
    if (!group || group.id !== resolvedGroupId) return;

    let active = true;
    let checking = false;
    const checkForExpenseUpdates = async () => {
      if (!active || checking || document.visibilityState !== "visible") return;
      checking = true;
      try {
        const response = await fetch(
          `${API_BASE_URL}/api/v1/groups/${encodeURIComponent(resolvedGroupId)}/expense-version`,
          { headers: getAuthHeaders(), cache: "no-store" }
        );
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.message || "Failed to check updates.");
        if (!active) return;

        const data =
          payload.data && typeof payload.data === "object"
            ? (payload.data as Record<string, unknown>)
            : {};
        const expenseCount = Number(data.count);
        const latestUpdatedAt = typeof data.latestUpdatedAt === "string" ? data.latestUpdatedAt : "";
        if (!Number.isInteger(expenseCount) || expenseCount < 0) {
          throw new Error("Invalid group update response.");
        }

        const nextVersion = `${expenseCount}:${latestUpdatedAt}`;
        if (groupExpenseVersionRef.current !== null && nextVersion !== groupExpenseVersionRef.current) {
          await fetchGroupDetail(false);
        } else if (groupExpenseVersionRef.current === null) {
          groupExpenseVersionRef.current = nextVersion;
        }
        if (active) setSyncError(null);
      } catch (err) {
        if (active) {
          setSyncError(
            err instanceof Error
              ? `Sync warning: ${err.message}`
              : "Could not sync latest updates. Retrying..."
          );
        }
      } finally {
        checking = false;
      }
    };

    const timer = window.setInterval(() => void checkForExpenseUpdates(), 5_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void checkForExpenseUpdates();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    void checkForExpenseUpdates();

    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [fetchGroupDetail, group?.id, resolvedGroupId]);

  // Filters & Sort
  const [filterModalOpen, setFilterModalOpen] = useState(false);
  const [expenseFilter, setExpenseFilter] = useState<"ALL" | "PENDING" | "COMPLETED">("ALL");
  const [paidByFilter, setPaidByFilter] = useState<string>("ALL");
  const [splitTypeFilter, setSplitTypeFilter] = useState<"ALL" | SplitMethod>("ALL");
  const [dateFilter, setDateFilter] = useState<DateFilterOption>("ALL");
  const [customFromDate, setCustomFromDate] = useState<string>("");
  const [customToDate, setCustomToDate] = useState<string>("");
  const [expenseSort, setExpenseSort] = useState<ExpenseSortOption>("RECENT");
  const [searchExpense, setSearchExpense] = useState("");

  const [draftStatus, setDraftStatus] = useState<"ALL" | "PENDING" | "COMPLETED">("ALL");
  const [draftPaidBy, setDraftPaidBy] = useState<string>("ALL");
  const [draftSplitType, setDraftSplitType] = useState<"ALL" | SplitMethod>("ALL");
  const [draftDateFilter, setDraftDateFilter] = useState<DateFilterOption>("ALL");
  const [draftFromDate, setDraftFromDate] = useState<string>("");
  const [draftToDate, setDraftToDate] = useState<string>("");
  const [draftSort, setDraftSort] = useState<ExpenseSortOption>("RECENT");

  const [copiedLink, setCopiedLink] = useState(false);
  const [alertBanner, setAlertBanner] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [celebrationToast, setCelebrationToast] = useState<SettlementToastData | null>(null);
  const [recentlySettledIds, setRecentlySettledIds] = useState<Record<string, boolean>>({});

  const [editingExpense, setEditingExpense] = useState<GroupExpenseItem | null>(null);
  const [membersModalOpen, setMembersModalOpen] = useState(false);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [generatingToken, setGeneratingToken] = useState(false);

  function triggerSuccessAnimation(data: Omit<SettlementToastData, "id">, highlightId?: string) {
    const toastId = Date.now();
    setCelebrationToast({ ...data, id: toastId });
    if (highlightId) {
      setRecentlySettledIds((prev) => ({ ...prev, [highlightId]: true }));
      window.setTimeout(() => {
        setRecentlySettledIds((prev) => {
          const next = { ...prev };
          delete next[highlightId];
          return next;
        });
      }, 2200);
    }
    window.setTimeout(() => {
      setCelebrationToast((current) => (current?.id === toastId ? null : current));
    }, 3000);
  }

  const membersList = group?.members ?? [];
  const expensesList = group?.expenses ?? [];
  const settlementsList = group?.completedSettlements ?? [];
  const currencyCode = group?.currency ?? "INR";
  const currentUserMember = membersList.find((member) => member.isCurrentUser);
  const currentUserMemberId = currentUserMember?.id;

  const isGroupCreator = useMemo(() => {
    const currentUserEmail = getCurrentUserEmail();
    return Boolean(
      currentUserEmail &&
        membersList.some(
          (member) => member.role === "ADMIN" && member.email.trim().toLowerCase() === currentUserEmail
        )
    );
  }, [membersList]);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (expenseFilter !== "ALL") count++;
    if (paidByFilter !== "ALL") count++;
    if (splitTypeFilter !== "ALL") count++;
    if (dateFilter !== "ALL") count++;
    if (expenseSort !== "RECENT") count++;
    return count;
  }, [expenseFilter, paidByFilter, splitTypeFilter, dateFilter, expenseSort]);

  function openFilterModal() {
    setDraftStatus(expenseFilter);
    setDraftPaidBy(paidByFilter);
    setDraftSplitType(splitTypeFilter);
    setDraftDateFilter(dateFilter);
    setDraftFromDate(customFromDate);
    setDraftToDate(customToDate);
    setDraftSort(expenseSort);
    setFilterModalOpen(true);
  }

  function applyFilterModal() {
    setExpenseFilter(draftStatus);
    setPaidByFilter(draftPaidBy);
    setSplitTypeFilter(draftSplitType);
    setDateFilter(draftDateFilter);
    setCustomFromDate(draftFromDate);
    setCustomToDate(draftToDate);
    setExpenseSort(draftSort);
    setFilterModalOpen(false);
  }

  function resetAllFilters() {
    setExpenseFilter("ALL");
    setPaidByFilter("ALL");
    setSplitTypeFilter("ALL");
    setDateFilter("ALL");
    setCustomFromDate("");
    setCustomToDate("");
    setExpenseSort("RECENT");
    setSearchExpense("");
    setDraftStatus("ALL");
    setDraftPaidBy("ALL");
    setDraftSplitType("ALL");
    setDraftDateFilter("ALL");
    setDraftFromDate("");
    setDraftToDate("");
    setDraftSort("RECENT");
    setFilterModalOpen(false);
  }

  const totalGroupSpend = useMemo(
    () => expensesList.reduce((sum, e) => sum + e.totalAmount, 0),
    [expensesList]
  );

  const myPersonalGroupSpend = useMemo(
    () => Math.round(expensesList.reduce((sum, e) => sum + (e.yourShare || 0), 0) * 100) / 100,
    [expensesList]
  );

  const myNetBalance = currentUserMember?.netBalance ?? 0;

  const totalGroupSettled = useMemo(
    () => settlementsList.reduce((sum, s) => sum + s.amount, 0),
    [settlementsList]
  );

  const memberSettlementStats = useMemo(() => {
    const map: Record<string, { paidOut: number; received: number }> = {};
    membersList.forEach((m) => {
      map[m.id] = { paidOut: 0, received: 0 };
    });
    settlementsList.forEach((cs) => {
      const fromMember = membersList.find((m) => m.id === cs.fromId || m.name === cs.from);
      const toMember = membersList.find((m) => m.id === cs.toId || m.name === cs.to);
      if (fromMember && map[fromMember.id]) {
        map[fromMember.id].paidOut = Math.round((map[fromMember.id].paidOut + cs.amount) * 100) / 100;
      }
      if (toMember && map[toMember.id]) {
        map[toMember.id].received = Math.round((map[toMember.id].received + cs.amount) * 100) / 100;
      }
    });
    return map;
  }, [membersList, settlementsList]);

  const pendingTransfers = useMemo(() => {
    const debtors = membersList
      .filter((m) => m.netBalance < -0.009)
      .map((m) => ({ id: m.id, name: m.name, amount: Math.abs(m.netBalance) }))
      .sort((a, b) => b.amount - a.amount);

    const creditors = membersList
      .filter((m) => m.netBalance > 0.009)
      .map((m) => ({ id: m.id, name: m.name, upiId: m.upiId, amount: m.netBalance }))
      .sort((a, b) => b.amount - a.amount);

    const list: Array<{
      id: string;
      fromId: string;
      fromName: string;
      toId: string;
      toName: string;
      toUpi?: string;
      amount: number;
    }> = [];

    let i = 0;
    let j = 0;
    while (i < debtors.length && j < creditors.length) {
      const pay = Math.min(debtors[i].amount, creditors[j].amount);
      if (pay > 0.009) {
        list.push({
          id: `${debtors[i].id}_${creditors[j].id}`,
          fromId: debtors[i].id,
          fromName: debtors[i].name,
          toId: creditors[j].id,
          toName: creditors[j].name,
          toUpi: creditors[j].upiId,
          amount: Math.round(pay * 100) / 100,
        });
      }
      debtors[i].amount -= pay;
      creditors[j].amount -= pay;
      if (debtors[i].amount < 0.01) i++;
      if (creditors[j].amount < 0.01) j++;
    }
    return list;
  }, [membersList]);

  const filteredExpenses = useMemo(() => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const sevenDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const fromBound = customFromDate ? new Date(`${customFromDate}T00:00:00`) : null;
    const toBound = customToDate ? new Date(`${customToDate}T23:59:59`) : null;

    const list = expensesList.filter((exp) => {
      const matchesStatus =
        expenseFilter === "ALL" ||
        (expenseFilter === "COMPLETED" && exp.isSettled) ||
        (expenseFilter === "PENDING" && !exp.isSettled);
      const matchesPayer =
        paidByFilter === "ALL" ||
        exp.paidById === paidByFilter ||
        exp.payers.some((p) => p.memberId === paidByFilter);
      const matchesSplit = splitTypeFilter === "ALL" || exp.splitType === splitTypeFilter;

      let matchesDate = true;
      if (dateFilter !== "ALL") {
        const expDate = parseExpenseDate(exp.date);
        if (!expDate) matchesDate = false;
        else if (dateFilter === "TODAY") matchesDate = expDate.getTime() === todayStart.getTime();
        else if (dateFilter === "LAST_7_DAYS") matchesDate = expDate >= sevenDaysAgo && expDate <= todayStart;
        else if (dateFilter === "THIS_MONTH") matchesDate = expDate >= monthStart && expDate <= todayStart;
        else if (dateFilter === "CUSTOM") {
          if (fromBound && expDate < fromBound) matchesDate = false;
          if (toBound && expDate > toBound) matchesDate = false;
        }
      }

      const q = searchExpense.trim().toLowerCase();
      const matchesQuery =
        !q ||
        exp.title.toLowerCase().includes(q) ||
        exp.category.toLowerCase().includes(q) ||
        exp.paidByName.toLowerCase().includes(q) ||
        (exp.notes && exp.notes.toLowerCase().includes(q));

      return matchesStatus && matchesPayer && matchesSplit && matchesDate && matchesQuery;
    });

    return [...list].sort((a, b) => {
      if (expenseSort === "AMOUNT_DESC") return b.totalAmount - a.totalAmount;
      if (expenseSort === "AMOUNT_ASC") return a.totalAmount - b.totalAmount;
      if (expenseSort === "MY_SHARE_DESC") return (b.yourShare || 0) - (a.yourShare || 0);
      // Default: latest datetime first
      return (b.timestamp ?? 0) - (a.timestamp ?? 0);
    });
  }, [
    expensesList,
    expenseFilter,
    paidByFilter,
    splitTypeFilter,
    dateFilter,
    customFromDate,
    customToDate,
    expenseSort,
    searchExpense,
  ]);

  async function handleToggleSimplifyDebts() {
    if (!group) return;
    const nextSimplify = !group.simplifyDebts;
    setGroup((prev) => (prev ? { ...prev, simplifyDebts: nextSimplify } : prev));
    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/groups/${group.id}`, {
        method: "PATCH",
        headers: getAuthHeaders(),
        body: JSON.stringify({ simplifyDebts: nextSimplify }),
      });
      if (!res.ok) await fetchGroupDetail(false);
    } catch {
      await fetchGroupDetail(false);
    }
  }

  async function applySettlement(params: {
    fromId: string;
    fromName: string;
    toId: string;
    toName: string;
    amount: number;
    method?: string;
    referenceId?: string;
  }): Promise<boolean> {
    if (!group) return false;
    const cleanAmount = Math.round(params.amount * 100) / 100;
    if (cleanAmount <= 0) {
      setAlertBanner({ type: "error", text: "Settlement amount must be greater than ₹0." });
      return false;
    }

    const previousSnapshot = group;
    const settledTimestamp = Date.now();
    const optimisticId = `optimistic_cs_${settledTimestamp}`;
    const methodLabel = params.method || "UPI";

    setGroup((curr) => {
      if (!curr) return curr;
      const updatedMembers = curr.members.map((m) => {
        if (m.id === params.fromId) {
          return { ...m, netBalance: Math.round((m.netBalance + cleanAmount) * 100) / 100 };
        }
        if (m.id === params.toId) {
          return { ...m, netBalance: Math.round((m.netBalance - cleanAmount) * 100) / 100 };
        }
        return m;
      });
      const debtorAfter = updatedMembers.find((m) => m.id === params.fromId);
      const remainingAfter = debtorAfter
        ? Math.max(0, Math.round(Math.abs(Math.min(0, debtorAfter.netBalance)) * 100) / 100)
        : 0;

      const newSettlement: CompletedSettlementItem = {
        id: optimisticId,
        fromId: params.fromId,
        from: params.fromName,
        toId: params.toId,
        to: params.toName,
        amount: cleanAmount,
        remainingAfter,
        method: methodLabel,
        referenceId: params.referenceId,
        completedAt: "Just now",
      };

      return {
        ...curr,
        members: updatedMembers,
        completedSettlements: [newSettlement, ...curr.completedSettlements],
      };
    });

    setNowMs(settledTimestamp);
    setAlertBanner(null);
    triggerSuccessAnimation(
      {
        headline: "Payment Settled!",
        amountLabel: formatINR(cleanAmount, currencyCode),
        subtext: `${params.fromName} paid ${params.toName} via ${methodLabel}`,
      },
      optimisticId
    );

    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/groups/${group.id}/settlements`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          fromMemberId: params.fromId,
          toMemberId: params.toId,
          amount: cleanAmount,
          paymentMethod: methodLabel,
          referenceId: params.referenceId || undefined,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.message || "Failed to record settlement.");
      window.dispatchEvent(new Event("splitmate:notifications-refresh"));
      void fetchGroupDetail(false).catch(() => {});
      return true;
    } catch (err) {
      setGroup(previousSnapshot);
      setCelebrationToast(null);
      setAlertBanner({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to record settlement.",
      });
      return false;
    }
  }

  async function handleToggleExpenseSettled(expense: GroupExpenseItem) {
    if (!group) return;
    const currentNow = Date.now();
    setNowMs(currentNow);

    if (expense.isSettled && expense.settledAt && currentNow - expense.settledAt >= REOPEN_WINDOW_MS) {
      setAlertBanner({
        type: "error",
        text: `Reopen window expired: "${expense.title}" was settled over 24 hours ago and is locked.`,
      });
      return;
    }

    const previousSnapshot = group;
    const markingSettled = !expense.isSettled;
    const paidByMe = expense.payers.reduce(
      (sum, p) => sum + (p.memberId === currentUserMemberId ? p.amount : 0),
      0
    );
    const netDiff = paidByMe - expense.yourShare;

    setGroup((curr) =>
      curr
        ? {
            ...curr,
            expenses: curr.expenses.map((item) =>
              item.id === expense.id
                ? { ...item, isSettled: markingSettled, settledAt: markingSettled ? currentNow : undefined }
                : item
            ),
          }
        : curr
    );

    if (markingSettled) {
      setAlertBanner(null);
      triggerSuccessAnimation(
        {
          headline: netDiff > 0.009 ? "Marked as Received!" : "Marked as Paid!",
          amountLabel: formatINR(Math.abs(netDiff) > 0.009 ? Math.abs(netDiff) : expense.yourShare, currencyCode),
          subtext: `"${expense.title}" • Reopen available for 24h`,
        },
        expense.id
      );
    }

    try {
      const res = await fetch(
        `${API_BASE_URL}/api/v1/groups/${group.id}/expenses/${expense.id}`,
        {
          method: "PATCH",
          headers: getAuthHeaders(),
          body: JSON.stringify({
            isSettled: markingSettled,
            settledAt: markingSettled ? currentNow : null,
          }),
        }
      );
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.message || "Failed to update transaction status.");
    } catch (err) {
      setGroup(previousSnapshot);
      setCelebrationToast(null);
      setAlertBanner({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to update transaction status.",
      });
    }
  }

  async function handleLeaveGroup() {
    if (!group) return;
    if (Math.abs(myNetBalance) > 0.01) {
      setAlertBanner({
        type: "error",
        text: `You cannot leave "${group.name}" with an unsettled balance (${formatINR(myNetBalance, currencyCode)}).`,
      });
      return;
    }

    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/groups/${group.id}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.message || "Failed to leave group.");
      navigate("/group");
    } catch (err) {
      setAlertBanner({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to leave group.",
      });
    }
  }

  async function handleGenerateShareToken() {
    if (!group) return;
    setGeneratingToken(true);
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/v1/groups/${encodeURIComponent(group.id)}/share-token`,
        {
          method: "POST",
          headers: getAuthHeaders(),
          body: JSON.stringify({ ttlHours: 24 }),
        }
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || "Failed to generate share link.");
      setShareToken(payload.data.token);
      setShareModalOpen(true);
    } catch (err) {
      setAlertBanner({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to generate share link.",
      });
    } finally {
      setGeneratingToken(false);
    }
  }

  if (loading) {
    return (
      <AppLayout title="Group Details" subtitle="Loading group data...">
        <div className="flex items-center justify-center rounded-2xl border border-slate-200 bg-white p-10 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center gap-2.5 text-sm font-semibold text-slate-700 dark:text-zinc-200">
            <Loader2 className="h-5 w-5 animate-spin text-indigo-600 dark:text-indigo-400" />
            <span>Loading group details...</span>
          </div>
        </div>
      </AppLayout>
    );
  }

  if (loadError || !group) {
    return (
      <AppLayout title="Group Details" subtitle="Unable to load group">
        <div className="rounded-2xl border border-rose-300 bg-rose-50 p-6 text-center dark:border-rose-800 dark:bg-rose-950/50">
          <AlertCircle className="mx-auto h-8 w-8 text-rose-600 dark:text-rose-400" />
          <h2 className="mt-2 font-display text-base font-bold text-rose-900 dark:text-rose-200">
            {loadError || "Group not found"}
          </h2>
          <div className="mt-4 flex items-center justify-center gap-3">
            <Link
              to="/group"
              className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-rose-300 bg-white px-4 text-xs font-bold text-rose-700 hover:bg-rose-100 dark:border-rose-700 dark:bg-zinc-900 dark:text-rose-300"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to Groups
            </Link>
            <button
              type="button"
              onClick={() => void fetchGroupDetail()}
              className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-rose-600 px-4 text-xs font-bold text-white hover:bg-rose-700 cursor-pointer"
            >
              Retry
            </button>
          </div>
        </div>
      </AppLayout>
    );
  }

  const totalActivityCount = expensesList.length + settlementsList.length;

  return (
    <AppLayout
      title={group.name}
      subtitle={group.description}
      headerActions={
        <div className="flex items-center gap-1.5 sm:gap-2">
          <Link
            to="/group"
            aria-label="All groups"
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-2.5 text-xs font-bold text-slate-800 transition hover:bg-slate-100 sm:px-3 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">All Groups</span>
          </Link>
          <Link
            to={`/groups/${group.id}/analytics`}
            state={{ group }}
            aria-label="Group insights"
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-2.5 text-xs font-bold text-slate-800 transition hover:bg-slate-100 sm:px-3 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
          >
            <BarChart3 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Insights</span>
          </Link>
          <button
            type="button"
            onClick={handleGenerateShareToken}
            disabled={generatingToken}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-2.5 text-xs font-bold text-slate-800 transition hover:bg-slate-100 sm:px-3 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700 cursor-pointer disabled:opacity-50"
            aria-label="Share group"
          >
            <Share2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Share</span>
          </button>
          <Link
            to={`/expenses?groupId=${group.id}`}
            aria-label="Add expense"
            className="hidden h-9 items-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 text-xs font-bold text-white shadow-xs transition hover:bg-indigo-700 sm:inline-flex"
          >
            <Plus className="h-4 w-4" />
            <span>Add Expense</span>
          </Link>
        </div>
      }
    >
      <style>{`
        @keyframes settlePopIn {
          0% { opacity: 0; transform: translateY(-16px) scale(0.94); }
          70% { opacity: 1; transform: translateY(2px) scale(1.015); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes shrinkToastProgress { from { width: 100%; } to { width: 0%; } }
        @keyframes settledCardFlash {
          0% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.45); }
          40% { box-shadow: 0 0 0 8px rgba(16, 185, 129, 0.16); }
          100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
        }
        .animate-settle-toast { animation: settlePopIn 0.35s cubic-bezier(0.22, 1, 0.36, 1) forwards; }
        .animate-toast-progress { animation: shrinkToastProgress 3s linear forwards; }
        .animate-settled-flash { animation: settledCardFlash 2.1s ease-out forwards; }
      `}</style>

      {celebrationToast && (
        <div
          key={celebrationToast.id}
          role="status"
          aria-live="polite"
          className="animate-settle-toast fixed top-16 right-3 left-3 z-50 mx-auto w-auto max-w-sm overflow-hidden rounded-2xl border border-emerald-400 bg-white shadow-2xl sm:top-20 sm:right-6 sm:left-auto dark:border-emerald-600 dark:bg-zinc-900"
        >
          <div className="flex items-center gap-3 p-3.5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">
              <Check className="h-5 w-5 stroke-[3]" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <p className="font-display text-sm font-extrabold text-emerald-700 dark:text-emerald-300">
                  {celebrationToast.headline}
                </p>
                {celebrationToast.amountLabel && (
                  <span className="rounded-lg bg-emerald-100 px-2 py-0.5 text-xs font-extrabold text-emerald-800 tabular-nums dark:bg-emerald-950 dark:text-emerald-200">
                    {celebrationToast.amountLabel}
                  </span>
                )}
              </div>
              <p className="mt-0.5 truncate text-xs text-slate-700 dark:text-zinc-200">
                {celebrationToast.subtext}
              </p>
            </div>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => setCelebrationToast(null)}
              className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 dark:text-zinc-400 dark:hover:bg-zinc-800 cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="h-1 w-full bg-emerald-100 dark:bg-emerald-950">
            <div className="animate-toast-progress h-full bg-emerald-500" />
          </div>
        </div>
      )}

      <div className="space-y-3.5 sm:space-y-5 pb-20 sm:pb-6">
        {syncError && (
          <div className="flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-xs font-semibold text-amber-900 dark:border-amber-700 dark:bg-amber-950/60 dark:text-amber-200">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{syncError}</span>
          </div>
        )}

        {alertBanner && (
          <div
            className={`flex items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-xs font-semibold ${
              alertBanner.type === "error"
                ? "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-700 dark:bg-rose-950/60 dark:text-rose-200"
                : "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-200"
            }`}
          >
            <div className="flex items-center gap-2">
              {alertBanner.type === "error" ? (
                <AlertCircle className="h-4 w-4 shrink-0" />
              ) : (
                <CheckCircle2 className="h-4 w-4 shrink-0" />
              )}
              <span>{alertBanner.text}</span>
            </div>
            <button onClick={() => setAlertBanner(null)} className="opacity-80 hover:opacity-100 cursor-pointer">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* COMPACT MOBILE-FRIENDLY GROUP SUMMARY */}
        <section className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-2xs sm:p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5 dark:border-zinc-800">
            <div className="flex items-center gap-1.5">
              <span className="inline-flex h-7 items-center gap-1 rounded-full bg-indigo-100 px-2.5 text-xs font-bold text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200">
                {group.type === "CUSTOM" && <Tag className="h-3 w-3" />}
                {group.type === "CUSTOM" && group.customTypeLabel ? group.customTypeLabel : group.type}
              </span>
              <span className="inline-flex h-7 items-center gap-1 rounded-full bg-slate-100 px-2.5 text-xs font-semibold text-slate-700 dark:bg-zinc-800 dark:text-zinc-200">
                <Users className="h-3.5 w-3.5" />
                {membersList.length}
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(`${window.location.origin}/join/${group.id}`);
                  setCopiedLink(true);
                  setTimeout(() => setCopiedLink(false), 2000);
                }}
                className="inline-flex h-7 items-center gap-1 rounded-full border border-slate-300 bg-slate-50 px-2.5 text-xs font-semibold text-slate-800 hover:bg-slate-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 cursor-pointer"
              >
                {copiedLink ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Link2 className="h-3.5 w-3.5" />}
                <span>{copiedLink ? "Copied" : "Invite"}</span>
              </button>

              <button
                type="button"
                onClick={handleToggleSimplifyDebts}
                className={`inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs font-semibold transition cursor-pointer ${
                  group.simplifyDebts
                    ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-200"
                    : "border-slate-300 bg-slate-50 text-slate-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                }`}
              >
                <Sparkles className="h-3.5 w-3.5" />
                <span>Simplify: {group.simplifyDebts ? "ON" : "OFF"}</span>
              </button>
            </div>
          </div>

          <div className="mt-3 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400">
                Your Net Position
              </p>
              {Math.abs(myNetBalance) < 0.01 ? (
                <div className="mt-1 flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-5 w-5" />
                  <span className="font-display text-xl font-extrabold sm:text-2xl">All settled up</span>
                </div>
              ) : myNetBalance > 0 ? (
                <div className="mt-0.5">
                  <p className="font-display text-2xl font-black text-emerald-600 tabular-nums sm:text-3xl dark:text-emerald-400">
                    +{formatINR(myNetBalance, currencyCode)}
                  </p>
                  <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                    Friends owe you in this group
                  </p>
                </div>
              ) : (
                <div className="mt-0.5">
                  <p className="font-display text-2xl font-black text-rose-600 tabular-nums sm:text-3xl dark:text-rose-400">
                    {formatINR(Math.abs(myNetBalance), currencyCode)}
                  </p>
                  <p className="text-xs font-semibold text-rose-700 dark:text-rose-300">
                    Total you need to pay back
                  </p>
                </div>
              )}
            </div>

            <div className="grid grid-cols-3 divide-x divide-slate-200 rounded-xl border border-slate-200 bg-slate-50 py-2 dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-950 sm:min-w-[330px]">
              <div className="px-2.5 text-center">
                <p className="text-[11px] font-bold uppercase text-slate-500 dark:text-zinc-400">Total</p>
                <p className="mt-0.5 truncate font-display text-xs font-extrabold text-slate-900 tabular-nums sm:text-sm dark:text-white">
                  {formatINR(totalGroupSpend, currencyCode)}
                </p>
              </div>
              <div className="px-2.5 text-center">
                <p className="text-[11px] font-bold uppercase text-slate-500 dark:text-zinc-400">Your Share</p>
                <p className="mt-0.5 truncate font-display text-xs font-extrabold text-indigo-600 tabular-nums sm:text-sm dark:text-indigo-400">
                  {formatINR(myPersonalGroupSpend, currencyCode)}
                </p>
              </div>
              <div className="px-2.5 text-center">
                <p className="text-[11px] font-bold uppercase text-slate-500 dark:text-zinc-400">Settled</p>
                <p className="mt-0.5 truncate font-display text-xs font-extrabold text-emerald-600 tabular-nums sm:text-sm dark:text-emerald-400">
                  {formatINR(totalGroupSettled, currencyCode)}
                </p>
              </div>
            </div>
          </div>

          {/* Mobile Primary CTA Buttons */}
          <div className="mt-3 grid grid-cols-2 gap-2 sm:hidden">
            <Link
              to={`/expenses?groupId=${group.id}`}
              className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-3 text-xs font-bold text-white shadow-xs active:scale-[0.99]"
            >
              <Plus className="h-4 w-4" />
              Add Expense
            </Link>
            <button
              type="button"
              onClick={() => setMobileTab("SETTLE")}
              className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border border-emerald-400 bg-emerald-600 px-3 text-xs font-bold text-white active:scale-[0.99] dark:border-emerald-700 cursor-pointer"
            >
              <HandCoins className="h-4 w-4" />
              Settle ({pendingTransfers.length})
            </button>
          </div>
        </section>

        {/* 3-TAB MOBILE NAVIGATION (Transactions / Settle / Members) */}
        <nav
          aria-label="Group sections"
          className="sticky top-14 z-20 grid grid-cols-3 gap-1 rounded-xl border border-slate-200 bg-slate-100 p-1 backdrop-blur-md lg:hidden dark:border-zinc-800 dark:bg-zinc-900"
        >
          {[
            { id: "EXPENSES" as const, label: `Transactions (${totalActivityCount})`, icon: Receipt },
            { id: "SETTLE" as const, label: `Settle (${pendingTransfers.length})`, icon: Handshake },
            { id: "MEMBERS" as const, label: `Members (${membersList.length})`, icon: Users },
          ].map(({ id, label, icon: Icon }) => {
            const active = mobileTab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setMobileTab(id)}
                className={`flex h-10 items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-bold transition cursor-pointer ${
                  active
                    ? "bg-white text-indigo-600 shadow-xs dark:bg-zinc-800 dark:text-white"
                    : "text-slate-600 hover:text-slate-900 dark:text-zinc-300 dark:hover:text-white"
                }`}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{label}</span>
              </button>
            );
          })}
        </nav>

        {/* 12-COLUMN WORKSPACE */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:gap-6">
          <GroupBillsSection
            groupId={group.id}
            mobileTab={mobileTab}
            currencyCode={currencyCode}
            currentUserMemberId={currentUserMemberId}
            expensesList={expensesList}
            filteredExpenses={filteredExpenses}
            settlementsList={settlementsList}
            expenseFilter={expenseFilter}
            expenseSort={expenseSort}
            searchExpense={searchExpense}
            activeFilterCount={activeFilterCount}
            nowMs={nowMs}
            reopenWindowMs={REOPEN_WINDOW_MS}
            recentlySettledIds={recentlySettledIds}
            formatINR={formatINR}
            onSearchChange={setSearchExpense}
            onOpenFilterModal={openFilterModal}
            onResetFilters={resetAllFilters}
            onEditExpense={setEditingExpense}
            onToggleExpenseSettled={handleToggleExpenseSettled}
          />

          {/* RIGHT 5 COLS: SETTLEMENT + MEMBERS */}
          <div className="space-y-4 lg:col-span-5">
            <GroupSettlementSection
              mobileTab={mobileTab}
              currencyCode={currencyCode}
              currentUserMemberId={currentUserMemberId}
              membersList={membersList}
              pendingTransfers={pendingTransfers}
              formatINR={formatINR}
              onError={(text) => setAlertBanner({ type: "error", text })}
              onApplySettlement={applySettlement}
            />

            {/* MEMBERS */}
            <div className={`${mobileTab === "MEMBERS" ? "block" : "hidden"} space-y-3 lg:block`}>
              <div className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-2xs sm:p-5 dark:border-zinc-800 dark:bg-zinc-900">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                      <Users className="h-4 w-4" />
                    </span>
                    <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
                      Members ({membersList.length})
                    </h2>
                  </div>
                  {isGroupCreator && (
                    <button
                      type="button"
                      onClick={() => setMembersModalOpen(true)}
                      className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl bg-indigo-600 px-3 text-xs font-bold text-white hover:bg-indigo-700 cursor-pointer"
                    >
                      <UserPlus className="h-3.5 w-3.5" />
                      <span>Manage</span>
                    </button>
                  )}
                </div>

                <div className="mt-3 divide-y divide-slate-100 dark:divide-zinc-800">
                  {membersList.map((m) => {
                    const stats = memberSettlementStats[m.id] ?? { paidOut: 0, received: 0 };
                    return (
                      <div key={m.id} className="flex items-center justify-between gap-2 py-2.5">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate text-sm font-bold text-slate-900 dark:text-white">
                              {m.isCurrentUser ? `${m.name} (You)` : m.name}
                            </span>
                            {m.role === "ADMIN" && <Shield className="h-3.5 w-3.5 shrink-0 text-indigo-500" />}
                          </div>
                          <p className="truncate text-xs text-slate-500 dark:text-zinc-400">{m.email}</p>

                          {(stats.paidOut > 0 || stats.received > 0) && (
                            <div className="mt-1 flex flex-wrap gap-1.5">
                              {stats.paidOut > 0 && (
                                <span className="inline-flex items-center gap-1 rounded-md bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-800 tabular-nums dark:bg-emerald-950 dark:text-emerald-200">
                                  Paid {formatINR(stats.paidOut, currencyCode)}
                                </span>
                              )}
                              {stats.received > 0 && (
                                <span className="inline-flex items-center gap-1 rounded-md bg-indigo-100 px-2 py-0.5 text-[11px] font-bold text-indigo-800 tabular-nums dark:bg-indigo-950 dark:text-indigo-200">
                                  Got {formatINR(stats.received, currencyCode)}
                                </span>
                              )}
                            </div>
                          )}
                        </div>

                        <div className="shrink-0 text-right">
                          <span
                            className={`text-xs font-extrabold tabular-nums sm:text-sm ${
                              m.netBalance > 0.009
                                ? "text-emerald-600 dark:text-emerald-400"
                                : m.netBalance < -0.009
                                  ? "text-rose-600 dark:text-rose-400"
                                  : "text-slate-600 dark:text-zinc-300"
                            }`}
                          >
                            {m.netBalance > 0.009
                              ? `+${formatINR(m.netBalance, currencyCode)}`
                              : m.netBalance < -0.009
                                ? `-${formatINR(Math.abs(m.netBalance), currencyCode)}`
                                : "Settled"}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleLeaveGroup}
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-rose-300 bg-rose-50 px-3.5 text-xs font-bold text-rose-700 hover:bg-rose-100 dark:border-rose-800 dark:bg-rose-950/60 dark:text-rose-300 dark:hover:bg-rose-950 cursor-pointer"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Leave Group
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* FILTER & SORT MODAL */}
      {filterModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/60 p-0 backdrop-blur-xs sm:items-center sm:p-4">
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-3xl border border-slate-200 bg-white p-5 shadow-2xl sm:rounded-3xl dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3.5 dark:border-zinc-800">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                  <SlidersHorizontal className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">
                    Filter &amp; Sort Transactions
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-zinc-400">Refine activity in {group.name}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setFilterModalOpen(false)}
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:text-zinc-400 dark:hover:bg-zinc-800 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-zinc-300">
                  Status
                </label>
                <div className="mt-1.5 grid grid-cols-3 gap-2">
                  {[
                    { id: "ALL" as const, label: "All" },
                    { id: "PENDING" as const, label: "Unsettled" },
                    { id: "COMPLETED" as const, label: "Settled" },
                  ].map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setDraftStatus(item.id)}
                      className={`h-9 rounded-xl border text-xs font-bold transition cursor-pointer ${
                        draftStatus === item.id
                          ? "border-indigo-600 bg-indigo-600 text-white"
                          : "border-slate-300 bg-slate-50 text-slate-800 hover:bg-slate-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-zinc-300">
                  <Calendar className="h-3.5 w-3.5 text-indigo-500" />
                  Date Range
                </label>
                <div className="relative mt-1.5">
                  <select
                    value={draftDateFilter}
                    onChange={(e) => setDraftDateFilter(e.target.value as DateFilterOption)}
                    className="h-10 w-full appearance-none rounded-xl border border-slate-300 bg-slate-50 pr-9 pl-3.5 text-xs font-bold text-slate-900 outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white cursor-pointer"
                  >
                    <option value="ALL">All Dates</option>
                    <option value="TODAY">Today</option>
                    <option value="LAST_7_DAYS">Last 7 Days</option>
                    <option value="THIS_MONTH">This Month</option>
                    <option value="CUSTOM">Custom Range</option>
                  </select>
                  <ChevronDown className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-slate-500 dark:text-zinc-400" />
                </div>

                {draftDateFilter === "CUSTOM" && (
                  <div className="mt-2.5 grid grid-cols-2 gap-2.5 rounded-xl border border-indigo-200 bg-indigo-50/50 p-3 dark:border-indigo-800 dark:bg-indigo-950/30">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-200">From</label>
                      <input
                        type="date"
                        value={draftFromDate}
                        onChange={(e) => setDraftFromDate(e.target.value)}
                        className="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-bold text-slate-900 outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:[color-scheme:dark]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-200">To</label>
                      <input
                        type="date"
                        value={draftToDate}
                        onChange={(e) => setDraftToDate(e.target.value)}
                        className="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-bold text-slate-900 outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:[color-scheme:dark]"
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-zinc-300">
                    <Filter className="h-3 w-3 text-indigo-500" />
                    Paid By
                  </label>
                  <div className="relative mt-1.5">
                    <select
                      value={draftPaidBy}
                      onChange={(e) => setDraftPaidBy(e.target.value)}
                      className="h-10 w-full appearance-none rounded-xl border border-slate-300 bg-slate-50 pr-9 pl-3 text-xs font-bold text-slate-900 outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white cursor-pointer"
                    >
                      <option value="ALL">Everyone</option>
                      {membersList.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-slate-500 dark:text-zinc-400" />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-zinc-300">
                    Split Type
                  </label>
                  <div className="relative mt-1.5">
                    <select
                      value={draftSplitType}
                      onChange={(e) => setDraftSplitType(e.target.value as "ALL" | SplitMethod)}
                      className="h-10 w-full appearance-none rounded-xl border border-slate-300 bg-slate-50 pr-9 pl-3 text-xs font-bold text-slate-900 outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white cursor-pointer"
                    >
                      <option value="ALL">All Types</option>
                      <option value="EQUAL">Equal</option>
                      <option value="EXACT">Exact Amount</option>
                      <option value="PERCENTAGE">Percentage (%)</option>
                      <option value="SHARES">Shares</option>
                    </select>
                    <ChevronDown className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-slate-500 dark:text-zinc-400" />
                  </div>
                </div>
              </div>

              <div>
                <label className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-zinc-300">
                  <ArrowUpDown className="h-3.5 w-3.5 text-indigo-500" />
                  Sort By
                </label>
                <div className="relative mt-1.5">
                  <select
                    value={draftSort}
                    onChange={(e) => setDraftSort(e.target.value as ExpenseSortOption)}
                    className="h-10 w-full appearance-none rounded-xl border border-slate-300 bg-slate-50 pr-9 pl-3.5 text-xs font-bold text-slate-900 outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white cursor-pointer"
                  >
                    <option value="RECENT">Latest Date &amp; Time First</option>
                    <option value="AMOUNT_DESC">Amount: High to Low</option>
                    <option value="AMOUNT_ASC">Amount: Low to High</option>
                    <option value="MY_SHARE_DESC">Your Share: High to Low</option>
                  </select>
                  <ChevronDown className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-slate-500 dark:text-zinc-400" />
                </div>
              </div>
            </div>

            <div className="mt-5 flex items-center justify-between gap-2.5 border-t border-slate-100 pt-4 dark:border-zinc-800">
              <button
                type="button"
                onClick={resetAllFilters}
                className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-4 text-xs font-bold text-slate-800 hover:bg-slate-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700 cursor-pointer"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reset
              </button>
              <button
                type="button"
                onClick={applyFilterModal}
                className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-5 text-xs font-bold text-white shadow-xs transition hover:bg-indigo-700 cursor-pointer"
              >
                <Check className="h-4 w-4" />
                Apply
              </button>
            </div>
          </div>
        </div>
      )}

      {/* LAZY-LOADED MODALS */}
      <Suspense fallback={null}>
        {isGroupCreator && group && membersModalOpen && (
          <GroupMembersModal
            open={membersModalOpen}
            groupId={group.id}
            groupName={group.name}
            members={membersList}
            onClose={() => setMembersModalOpen(false)}
            onMembersChanged={() => fetchGroupDetail(false)}
          />
        )}

        {group && editingExpense && (
          <EditExpenseModal
            open={Boolean(editingExpense)}
            groupId={group.id}
            expense={editingExpense}
            members={membersList}
            currencyCode={currencyCode}
            onClose={() => setEditingExpense(null)}
            onUpdated={() => fetchGroupDetail(false)}
          />
        )}

        {shareModalOpen && (
          <ShareModal
            groupId={group?.id || ""}
            isOpen={shareModalOpen}
            setIsOpen={setShareModalOpen}
            token={shareToken ?? undefined}
          />
        )}
      </Suspense>
    </AppLayout>
  );
}