import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Car,
  CheckCircle2,
  ChevronDown,
  Clock,
  Film,
  HandCoins,
  Hotel,
  Lightbulb,
  Lock,
  Pencil,
  Plus,
  Receipt,
  RotateCcw,
  Search,
  ShoppingBag,
  SlidersHorizontal,
  Utensils,
  Wifi,
  type LucideIcon,
} from "lucide-react";
import type { CompletedSettlementItem } from "./GroupSettlementSection";

export type SplitMethod = "EQUAL" | "EXACT" | "PERCENTAGE" | "SHARES";

export interface ExpenseAllocationItem {
  memberId: string;
  memberName: string;
  amount: number;
}

export interface GroupExpenseItem {
  id: string;
  title: string;
  category: string;
  paidById: string;
  paidByName: string;
  totalAmount: number;
  yourShare: number;
  payers: ExpenseAllocationItem[];
  splits: ExpenseAllocationItem[];
  splitType: SplitMethod;
  paymentMethod: string;
  date: string;
  createdAt?: string;
  timestamp?: number;
  notes?: string;
  isSettled: boolean;
  settledAt?: number;
  updatedAt?: string;
}

interface GroupBillsSectionProps {
  groupId: string;
  mobileTab: "SETTLE" | "EXPENSES" | "MEMBERS";
  currencyCode: string;
  currentUserMemberId?: string;
  expensesList: GroupExpenseItem[];
  filteredExpenses: GroupExpenseItem[];
  settlementsList: CompletedSettlementItem[];
  expenseFilter: "ALL" | "PENDING" | "COMPLETED";
  expenseSort: "RECENT" | "AMOUNT_DESC" | "AMOUNT_ASC" | "MY_SHARE_DESC";
  searchExpense: string;
  activeFilterCount: number;
  nowMs: number;
  reopenWindowMs: number;
  recentlySettledIds: Record<string, boolean>;
  formatINR: (value: number, currency?: string) => string;
  onSearchChange: (value: string) => void;
  onOpenFilterModal: () => void;
  onResetFilters: () => void;
  onEditExpense: (expense: GroupExpenseItem) => void;
  onToggleExpenseSettled: (expense: GroupExpenseItem) => void;
}

type UnifiedFeedEntry =
  | { kind: "BILL"; sortTime: number; sortAmount: number; expense: GroupExpenseItem }
  | { kind: "SETTLEMENT"; sortTime: number; sortAmount: number; settlement: CompletedSettlementItem };

const EXPENSE_CATEGORY_ICONS: Record<string, LucideIcon> = {
  Food: Utensils,
  Hotel,
  Transportation: Car,
  Shopping: ShoppingBag,
  Internet: Wifi,
  Electricity: Lightbulb,
  Entertainment: Film,
};

function parseTimestamp(value?: string | number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (!value) return 0;
  const clean = String(value).trim().toLowerCase();
  if (clean === "just now") return Date.now();
  if (clean === "today") {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    return d.getTime();
  }
  if (clean === "yesterday") {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    d.setHours(12, 0, 0, 0);
    return d.getTime();
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function getReopenStatus(exp: GroupExpenseItem, nowMs: number, reopenWindowMs: number) {
  if (!exp.isSettled || !exp.settledAt) {
    return { canReopen: true, timeLeft: "24h" };
  }
  const elapsed = nowMs - exp.settledAt;
  if (elapsed >= reopenWindowMs) {
    return { canReopen: false, timeLeft: "" };
  }
  const minutesLeft = Math.max(1, Math.ceil((reopenWindowMs - elapsed) / 60000));
  const hoursLeft = Math.floor(minutesLeft / 60);
  const remainingMinutes = minutesLeft % 60;
  const timeLeft =
    hoursLeft > 0 ? `${hoursLeft}h ${remainingMinutes}m` : `${remainingMinutes}m`;
  return { canReopen: true, timeLeft };
}

export default function GroupBillsSection({
  groupId,
  mobileTab,
  currencyCode,
  currentUserMemberId,
  expensesList,
  filteredExpenses,
  settlementsList,
  expenseFilter,
  expenseSort,
  searchExpense,
  activeFilterCount,
  nowMs,
  reopenWindowMs,
  recentlySettledIds,
  formatINR,
  onSearchChange,
  onOpenFilterModal,
  onResetFilters,
  onEditExpense,
  onToggleExpenseSettled,
}: GroupBillsSectionProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [entryTypeFilter, setEntryTypeFilter] = useState<"ALL" | "BILLS" | "SETTLEMENTS">("ALL");

  // Hide completed settlements when "Unsettled" (PENDING) status filter is active
  const filteredSettlements = useMemo(() => {
    if (expenseFilter === "PENDING") return [];
    const q = searchExpense.trim().toLowerCase();
    if (!q) return settlementsList;
    return settlementsList.filter(
      (s) =>
        s.from.toLowerCase().includes(q) ||
        s.to.toLowerCase().includes(q) ||
        s.method.toLowerCase().includes(q) ||
        (s.referenceId && s.referenceId.toLowerCase().includes(q))
    );
  }, [settlementsList, expenseFilter, searchExpense]);

  const showBills = entryTypeFilter === "ALL" || entryTypeFilter === "BILLS";
  const showSettlements =
    expenseFilter !== "PENDING" &&
    (entryTypeFilter === "ALL" || entryTypeFilter === "SETTLEMENTS");

  // Unified chronological datetime-sorted feed of bills and settlements
  const unifiedFeed = useMemo<UnifiedFeedEntry[]>(() => {
    const entries: UnifiedFeedEntry[] = [];

    if (showBills) {
      filteredExpenses.forEach((expense) => {
        const sortTime =
          expense.timestamp ??
          (parseTimestamp(expense.createdAt) ||
            parseTimestamp(expense.date) ||
            parseTimestamp(expense.updatedAt));
        entries.push({
          kind: "BILL",
          sortTime,
          sortAmount: expense.totalAmount,
          expense,
        });
      });
    }

    if (showSettlements) {
      filteredSettlements.forEach((settlement) => {
        entries.push({
          kind: "SETTLEMENT",
          sortTime: parseTimestamp(settlement.completedAt),
          sortAmount: settlement.amount,
          settlement,
        });
      });
    }

    return entries.sort((a, b) => {
      if (expenseSort === "AMOUNT_DESC") return b.sortAmount - a.sortAmount;
      if (expenseSort === "AMOUNT_ASC") return a.sortAmount - b.sortAmount;
      return b.sortTime - a.sortTime; // Default: newest datetime first
    });
  }, [showBills, showSettlements, filteredExpenses, filteredSettlements, expenseSort]);

  const visibleCount = unifiedFeed.length;

  return (
    <div
      className={`${
        mobileTab === "EXPENSES" ? "block" : "hidden"
      } space-y-3 lg:col-span-7 lg:block`}
    >
      <div className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-2xs sm:p-5 dark:border-zinc-800 dark:bg-zinc-900">
        {/* Header */}
        <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-3 dark:border-zinc-800">
          <div>
            <h2 className="font-display text-base font-bold text-slate-900 sm:text-lg dark:text-white">
              Transactions ({visibleCount})
            </h2>
            <p className="text-xs text-slate-600 dark:text-zinc-300">
              Latest first • Tap any bill for shares
            </p>
          </div>

          <div className="flex items-center gap-1.5">
            {(activeFilterCount > 0 || searchExpense.trim() !== "" || entryTypeFilter !== "ALL") && (
              <button
                type="button"
                onClick={() => {
                  setEntryTypeFilter("ALL");
                  onResetFilters();
                }}
                className="inline-flex h-9 items-center gap-1 rounded-xl border border-slate-300 bg-slate-100 px-2.5 text-xs font-semibold text-slate-800 hover:bg-slate-200 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 cursor-pointer"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Reset</span>
              </button>
            )}

            <button
              type="button"
              onClick={onOpenFilterModal}
              className={`inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold transition cursor-pointer ${
                activeFilterCount > 0
                  ? "border-indigo-500 bg-indigo-600 text-white"
                  : "border-slate-300 bg-white text-slate-800 hover:bg-slate-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
              }`}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              <span>Filter</span>
              {activeFilterCount > 0 && (
                <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-white px-1 text-[11px] font-bold text-indigo-600">
                  {activeFilterCount}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Quick Pills: All / Bills / Settled */}
        <div className="mt-3 flex items-center gap-1.5">
          {[
            { id: "ALL" as const, label: `All (${filteredExpenses.length + filteredSettlements.length})` },
            { id: "BILLS" as const, label: `Bills (${filteredExpenses.length})` },
            { id: "SETTLEMENTS" as const, label: `Settled (${filteredSettlements.length})` },
          ].map((pill) => (
            <button
              key={pill.id}
              type="button"
              onClick={() => setEntryTypeFilter(pill.id)}
              className={`h-8 rounded-lg px-3 text-xs font-bold transition cursor-pointer ${
                entryTypeFilter === pill.id
                  ? "bg-indigo-600 text-white"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
              }`}
            >
              {pill.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative mt-3">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-zinc-400" />
          <input
            type="text"
            placeholder="Search bills, payers, or settlements..."
            value={searchExpense}
            onChange={(e) => onSearchChange(e.target.value)}
            className="h-10 w-full rounded-xl border border-slate-300 bg-slate-50 pr-3 pl-9 text-xs font-medium text-slate-900 placeholder:text-slate-400 outline-none focus:border-indigo-500 focus:bg-white dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:bg-zinc-900"
          />
        </div>

        {/* Empty State vs Chronological Feed */}
        {visibleCount === 0 ? (
          <div className="mt-4 rounded-2xl border border-dashed border-slate-300 p-6 text-center dark:border-zinc-700">
            <Receipt className="mx-auto h-8 w-8 text-slate-400 dark:text-zinc-500" />
            <p className="mt-2 text-sm font-semibold text-slate-800 dark:text-zinc-200">
              {expensesList.length === 0 && settlementsList.length === 0
                ? "No transactions in this group yet"
                : "No transactions match your filter"}
            </p>
            {expensesList.length === 0 && settlementsList.length === 0 && (
              <Link
                to={`/expenses?groupId=${groupId}`}
                className="mt-3 inline-flex h-10 items-center gap-1.5 rounded-xl bg-indigo-600 px-4 text-xs font-bold text-white hover:bg-indigo-700"
              >
                <Plus className="h-4 w-4" />
                Add First Expense
              </Link>
            )}
          </div>
        ) : (
          <div className="mt-3.5 space-y-2.5">
            {unifiedFeed.map((item) => {
              if (item.kind === "SETTLEMENT") {
                const cs = item.settlement;
                const isFlashing = Boolean(recentlySettledIds[cs.id]);
                return (
                  <div
                    key={`settlement-${cs.id}`}
                    className={`flex items-center justify-between gap-2.5 rounded-2xl border border-emerald-300/80 bg-emerald-50/70 p-3 sm:p-3.5 dark:border-emerald-700/60 dark:bg-emerald-950/35 ${
                      isFlashing ? "animate-settled-flash" : ""
                    }`}
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-2.5">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white">
                        <HandCoins className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1 text-xs font-bold text-slate-900 sm:text-sm dark:text-white">
                          <span>{cs.fromId === currentUserMemberId ? "You" : cs.from}</span>
                          <ArrowRight className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                          <span>{cs.toId === currentUserMemberId ? "You" : cs.to}</span>
                        </div>
                        <p className="mt-0.5 text-xs text-slate-600 dark:text-zinc-300">
                          Settlement via {cs.method} • {cs.completedAt}
                          {cs.referenceId ? ` • Ref ${cs.referenceId}` : ""}
                        </p>
                      </div>
                    </div>

                    <div className="shrink-0 text-right">
                      <p className="text-sm font-extrabold tabular-nums text-emerald-700 dark:text-emerald-300">
                        {formatINR(cs.amount, currencyCode)}
                      </p>
                      <span className="inline-block rounded-md bg-emerald-600/15 px-1.5 py-0.5 text-[11px] font-bold text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200">
                        Settled
                      </span>
                    </div>
                  </div>
                );
              }

              const exp = item.expense;
              const amountPaidByMe = exp.payers.reduce(
                (sum, payer) =>
                  sum + (payer.memberId === currentUserMemberId ? payer.amount : 0),
                0
              );
              const CategoryIcon = EXPENSE_CATEGORY_ICONS[exp.category] ?? Receipt;
              const netDiff = amountPaidByMe - exp.yourShare;
              const hasLent = netDiff > 0.009;
              const owes = netDiff < -0.009;
              const isExpanded = expandedId === exp.id;
              const reopenInfo = getReopenStatus(exp, nowMs, reopenWindowMs);
              const isFlashing = Boolean(recentlySettledIds[exp.id]);
              const activeSplits = exp.splits.filter((s) => Number(s.amount) > 0.001);

              const settleActionLabel = hasLent
                ? "Mark as Received"
                : owes
                  ? "Mark as Paid"
                  : "Mark Settled";

              return (
                <div
                  key={`bill-${exp.id}`}
                  className={`overflow-hidden rounded-2xl border transition ${
                    isFlashing ? "animate-settled-flash" : ""
                  } ${
                    exp.isSettled
                      ? "border-slate-200 bg-slate-50 dark:border-zinc-800 dark:bg-zinc-950/60"
                      : isExpanded
                        ? "border-indigo-400 bg-white shadow-sm dark:border-indigo-600 dark:bg-zinc-900"
                        : "border-slate-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
                  }`}
                >
                  {/* Compact Clickable Summary Row */}
                  <button
                    type="button"
                    onClick={() => setExpandedId(isExpanded ? null : exp.id)}
                    aria-expanded={isExpanded}
                    className="flex w-full items-center justify-between gap-2.5 p-3 text-left sm:p-4 cursor-pointer"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-2.5">
                      <span
                        aria-hidden="true"
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
                      >
                        <CategoryIcon className="h-4 w-4" />
                      </span>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <h3
                            className={`truncate text-sm font-bold ${
                              exp.isSettled
                                ? "text-slate-500 line-through dark:text-zinc-400"
                                : "text-slate-900 dark:text-white"
                            }`}
                          >
                            {exp.title}
                          </h3>
                          {exp.isSettled && (
                            <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                              <CheckCircle2 className="h-3 w-3" />
                              Done
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 truncate text-xs text-slate-600 dark:text-zinc-300">
                          {exp.paidById === currentUserMemberId ? "You" : exp.paidByName} paid{" "}
                          <span className="font-bold text-slate-900 dark:text-zinc-100">
                            {formatINR(exp.totalAmount, currencyCode)}
                          </span>{" "}
                          • {exp.date}
                        </p>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <div className="text-right">
                        <p
                          className={`text-sm font-extrabold tabular-nums ${
                            exp.isSettled
                              ? "text-slate-500 dark:text-zinc-400"
                              : hasLent
                                ? "text-emerald-600 dark:text-emerald-400"
                                : owes
                                  ? "text-rose-600 dark:text-rose-400"
                                  : "text-slate-600 dark:text-zinc-300"
                          }`}
                        >
                          {hasLent
                            ? `+${formatINR(netDiff, currencyCode)}`
                            : owes
                              ? `-${formatINR(Math.abs(netDiff), currencyCode)}`
                              : "Settled"}
                        </p>
                        <p className="text-[11px] font-medium text-slate-500 dark:text-zinc-400">
                          {hasLent ? "to receive" : owes ? "to pay" : "no balance"}
                        </p>
                      </div>

                      <ChevronDown
                        className={`h-4 w-4 text-slate-500 transition-transform duration-200 dark:text-zinc-400 ${
                          isExpanded ? "rotate-180 text-indigo-600 dark:text-indigo-400" : ""
                        }`}
                      />
                    </div>
                  </button>

                  {/* Expanded Details Drawer */}
                  {isExpanded && (
                    <div className="space-y-3 border-t border-slate-200 bg-slate-50 p-3 sm:p-4 dark:border-zinc-800 dark:bg-zinc-950">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-700 dark:text-zinc-300">
                        <span>
                          Split: <strong className="text-slate-900 dark:text-white">{exp.splitType}</strong> • Via{" "}
                          <strong className="text-slate-900 dark:text-white">{exp.paymentMethod}</strong>
                        </span>
                        {exp.payers.length > 1 && (
                          <span>
                            Payers:{" "}
                            {exp.payers
                              .map(
                                (p) =>
                                  `${p.memberId === currentUserMemberId ? "You" : p.memberName} (${formatINR(p.amount, currencyCode)})`
                              )
                              .join(", ")}
                          </span>
                        )}
                      </div>

                      {exp.notes && (
                        <p className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs italic text-slate-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
                          &ldquo;{exp.notes}&rdquo;
                        </p>
                      )}

                      {activeSplits.length > 0 && (
                        <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
                          <p className="mb-1.5 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400">
                            Share Breakdown ({activeSplits.length})
                          </p>
                          <div className="divide-y divide-slate-100 dark:divide-zinc-800">
                            {activeSplits.map((split) => {
                              const isMe = split.memberId === currentUserMemberId;
                              return (
                                <div
                                  key={split.memberId}
                                  className="flex items-center justify-between py-1.5 text-xs sm:text-sm"
                                >
                                  <span
                                    className={
                                      isMe
                                        ? "font-bold text-indigo-600 dark:text-indigo-400"
                                        : "font-medium text-slate-800 dark:text-zinc-200"
                                    }
                                  >
                                    {isMe ? `${split.memberName} (You)` : split.memberName}
                                  </span>
                                  <span className="font-bold tabular-nums text-slate-900 dark:text-white">
                                    {formatINR(split.amount, currencyCode)}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* High-Contrast Action Buttons */}
                      <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                        {!exp.isSettled ? (
                          <>
                            <button
                              type="button"
                              onClick={() => onEditExpense(exp)}
                              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 text-xs font-bold text-slate-800 hover:bg-slate-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700 cursor-pointer"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => onToggleExpenseSettled(exp)}
                              className={`inline-flex h-9 items-center gap-1.5 rounded-xl px-3.5 text-xs font-bold text-white shadow-xs transition cursor-pointer ${
                                hasLent
                                  ? "bg-indigo-600 hover:bg-indigo-700"
                                  : "bg-emerald-600 hover:bg-emerald-700"
                              }`}
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              {settleActionLabel}
                            </button>
                          </>
                        ) : reopenInfo.canReopen ? (
                          <button
                            type="button"
                            onClick={() => onToggleExpenseSettled(exp)}
                            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-amber-300 bg-amber-100 px-3.5 text-xs font-bold text-amber-900 hover:bg-amber-200 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200 dark:hover:bg-amber-900 cursor-pointer"
                          >
                            <Clock className="h-3.5 w-3.5" />
                            Reopen ({reopenInfo.timeLeft} left)
                          </button>
                        ) : (
                          <span className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-300 bg-slate-100 px-3 text-xs font-semibold text-slate-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                            <Lock className="h-3.5 w-3.5" />
                            Locked after 24h
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}