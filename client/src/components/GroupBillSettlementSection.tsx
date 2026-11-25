import React, { useState } from "react";
import { Link } from "react-router-dom";
import {
  Car,
  CheckCircle2,
  ChevronDown,
  Clock,
  Film,
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
  notes?: string;
  isSettled: boolean;
  settledAt?: number;
  updatedAt?: string;
}

interface GroupBillsSectionProps {
  groupId: string;
  mobileTab: "SETTLE" | "EXPENSES" | "HISTORY" | "MEMBERS";
  currencyCode: string;
  currentUserMemberId?: string;
  expensesList: GroupExpenseItem[];
  filteredExpenses: GroupExpenseItem[];
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

const EXPENSE_CATEGORY_ICONS: Record<string, LucideIcon> = {
  Food: Utensils,
  Hotel,
  Transportation: Car,
  Shopping: ShoppingBag,
  Internet: Wifi,
  Electricity: Lightbulb,
  Entertainment: Film,
};

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

  return (
    <div
      className={`${
        mobileTab === "EXPENSES" ? "block" : "hidden"
      } space-y-4 lg:col-span-7 lg:block`}
    >
      <div className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-2xs sm:p-6 dark:border-zinc-800 dark:bg-zinc-900">
        {/* Header */}
        <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-3.5 dark:border-zinc-800">
          <div>
            <h2 className="font-display text-base font-bold text-slate-900 sm:text-lg dark:text-white">
              Transactions ({filteredExpenses.length})
            </h2>
            <p className="text-[11px] text-slate-500 sm:text-xs dark:text-zinc-400">
              Tap any transaction to view shares &amp; actions
            </p>
          </div>

          <div className="flex items-center gap-1.5">
            {(activeFilterCount > 0 || searchExpense.trim() !== "") && (
              <button
                type="button"
                onClick={onResetFilters}
                className="inline-flex h-9 items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 px-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 cursor-pointer"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Reset</span>
              </button>
            )}

            <button
              type="button"
              onClick={onOpenFilterModal}
              className={`inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold transition cursor-pointer ${
                activeFilterCount > 0
                  ? "border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300"
                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200"
              }`}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              <span>Filter</span>
              {activeFilterCount > 0 && (
                <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-indigo-600 px-1 text-[10px] font-bold text-white">
                  {activeFilterCount}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="relative mt-3.5">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search by title, payer, or notes..."
            value={searchExpense}
            onChange={(e) => onSearchChange(e.target.value)}
            className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pr-3.5 pl-10 text-xs outline-none transition focus:border-indigo-500 focus:bg-white dark:border-zinc-800 dark:bg-zinc-950 dark:text-white dark:focus:bg-zinc-900"
          />
        </div>

        {/* Empty State vs List */}
        {filteredExpenses.length === 0 ? (
          <div className="mt-5 rounded-2xl border border-dashed border-slate-200 p-8 text-center dark:border-zinc-800">
            <Receipt className="mx-auto h-8 w-8 text-slate-400" />
            <p className="mt-2 text-sm font-semibold text-slate-700 dark:text-zinc-300">
              {expensesList.length === 0
                ? "No transactions in this group yet"
                : "No transactions match your filter"}
            </p>
            {activeFilterCount > 0 || searchExpense.trim() !== "" ? (
              <button
                type="button"
                onClick={onResetFilters}
                className="mt-3 inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-indigo-600 hover:bg-slate-50 dark:border-zinc-700 dark:text-indigo-400 cursor-pointer"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reset Filters
              </button>
            ) : (
              <Link
                to={`/expenses?groupId=${groupId}`}
                className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700"
              >
                <Plus className="h-3.5 w-3.5" />
                Add First Expense
              </Link>
            )}
          </div>
        ) : (
          <div className="mt-3.5 space-y-2.5">
            {filteredExpenses.map((exp) => {
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

              // Contextual settlement button label
              const settleActionLabel = hasLent
                ? "Mark as Received"
                : owes
                  ? "Mark as Paid"
                  : "Mark Settled";

              return (
                <div
                  key={exp.id}
                  className={`overflow-hidden rounded-2xl border transition ${
                    isFlashing ? "animate-settled-flash" : ""
                  } ${
                    exp.isSettled
                      ? "border-slate-200/70 bg-slate-50/70 dark:border-zinc-800/80 dark:bg-zinc-950/50"
                      : isExpanded
                        ? "border-indigo-300 bg-white shadow-sm dark:border-indigo-800/70 dark:bg-zinc-900"
                        : "border-slate-200 bg-white hover:border-slate-300 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700"
                  }`}
                >
                  {/* COMPACT CLICKABLE SUMMARY ROW */}
                  <button
                    type="button"
                    onClick={() => setExpandedId(isExpanded ? null : exp.id)}
                    aria-expanded={isExpanded}
                    className="flex w-full items-center justify-between gap-3 p-3.5 text-left sm:p-4 cursor-pointer"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <span
                        aria-hidden="true"
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400"
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
                            <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-400">
                              <CheckCircle2 className="h-2.5 w-2.5" />
                              Settled
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 truncate text-[11px] text-slate-500 dark:text-zinc-400">
                          {exp.paidById === currentUserMemberId ? "You" : exp.paidByName} paid{" "}
                          <span className="font-semibold text-slate-700 dark:text-zinc-300">
                            {formatINR(exp.totalAmount, currencyCode)}
                          </span>{" "}
                          • {exp.date}
                        </p>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2.5">
                      <div className="text-right">
                        <p
                          className={`text-xs font-extrabold tabular-nums sm:text-sm ${
                            exp.isSettled
                              ? "text-slate-400"
                              : hasLent
                                ? "text-emerald-600 dark:text-emerald-400"
                                : owes
                                  ? "text-rose-600 dark:text-rose-400"
                                  : "text-slate-500 dark:text-zinc-400"
                          }`}
                        >
                          {hasLent
                            ? `+${formatINR(netDiff, currencyCode)}`
                            : owes
                              ? `-${formatINR(Math.abs(netDiff), currencyCode)}`
                              : "Settled"}
                        </p>
                        <p className="text-[10px] font-medium text-slate-400">
                          {hasLent ? "to receive" : owes ? "to pay" : "no balance"}
                        </p>
                      </div>

                      <ChevronDown
                        className={`h-4 w-4 text-slate-400 transition-transform duration-200 ${
                          isExpanded ? "rotate-180 text-indigo-600 dark:text-indigo-400" : ""
                        }`}
                      />
                    </div>
                  </button>

                  {/* EXPANDED DETAILS DRAWER (Shares, Payers, Notes & Actions) */}
                  {isExpanded && (
                    <div className="space-y-3 border-t border-slate-100 bg-slate-50/70 px-3.5 py-3.5 sm:px-4 dark:border-zinc-800 dark:bg-zinc-950/50">
                      {/* Meta & Payers */}
                      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-zinc-400">
                        <span>
                          Split: <strong className="text-slate-700 dark:text-zinc-200">{exp.splitType}</strong> • Via{" "}
                          <strong className="text-slate-700 dark:text-zinc-200">{exp.paymentMethod}</strong>
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
                        <p className="rounded-xl bg-white px-3 py-2 text-xs italic text-slate-600 dark:bg-zinc-900 dark:text-zinc-300">
                          &ldquo;{exp.notes}&rdquo;
                        </p>
                      )}

                      {/* Per-Person Share Breakdown */}
                      {activeSplits.length > 0 && (
                        <div className="rounded-xl border border-slate-200/80 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
                          <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                            Share Breakdown ({activeSplits.length} people)
                          </p>
                          <div className="divide-y divide-slate-100 dark:divide-zinc-800">
                            {activeSplits.map((split) => {
                              const isMe = split.memberId === currentUserMemberId;
                              return (
                                <div
                                  key={split.memberId}
                                  className="flex items-center justify-between py-1.5 text-xs"
                                >
                                  <span
                                    className={
                                      isMe
                                        ? "font-bold text-indigo-600 dark:text-indigo-400"
                                        : "font-medium text-slate-700 dark:text-zinc-300"
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

                      {/* Action Buttons */}
                      <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                        {!exp.isSettled ? (
                          <>
                            <button
                              type="button"
                              onClick={() => onEditExpense(exp)}
                              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 cursor-pointer"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => onToggleExpenseSettled(exp)}
                              className={`inline-flex h-9 items-center gap-1.5 rounded-xl px-3.5 text-xs font-bold text-white shadow-2xs transition cursor-pointer ${
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
                            className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-amber-50 px-3 text-xs font-semibold text-amber-700 hover:bg-amber-100 dark:bg-amber-950/60 dark:text-amber-300 cursor-pointer"
                          >
                            <Clock className="h-3.5 w-3.5" />
                            Reopen ({reopenInfo.timeLeft} left)
                          </button>
                        ) : (
                          <span className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-100 px-3 text-[11px] font-semibold text-slate-400 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-500">
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