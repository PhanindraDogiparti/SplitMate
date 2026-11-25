import React, { useState } from "react";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  Handshake,
  X,
} from "lucide-react";

export interface SettlementMember {
  id: string;
  name: string;
  upiId?: string;
  netBalance: number;
}

export interface PendingTransferItem {
  id: string;
  fromId: string;
  fromName: string;
  toId: string;
  toName: string;
  toUpi?: string;
  amount: number;
}

export interface CompletedSettlementItem {
  id: string;
  fromId?: string;
  from: string;
  toId?: string;
  to: string;
  amount: number;
  remainingAfter?: number;
  method: string;
  referenceId?: string;
  completedAt: string;
}

interface GroupSettlementSectionProps {
  mobileTab: "SETTLE" | "EXPENSES" | "MEMBERS";
  currencyCode: string;
  currentUserMemberId?: string;
  membersList: SettlementMember[];
  pendingTransfers: PendingTransferItem[];
  formatINR: (value: number, currency?: string) => string;
  onError: (message: string) => void;
  onApplySettlement: (params: {
    fromId: string;
    fromName: string;
    toId: string;
    toName: string;
    amount: number;
    method?: string;
    referenceId?: string;
  }) => Promise<boolean>;
}

export default function GroupSettlementSection({
  mobileTab,
  currencyCode,
  currentUserMemberId,
  membersList,
  pendingTransfers,
  formatINR,
  onError,
  onApplySettlement,
}: GroupSettlementSectionProps) {
  const [copiedUpi, setCopiedUpi] = useState<string | null>(null);
  const [customPayTransferId, setCustomPayTransferId] = useState<string | null>(null);
  const [customPayAmount, setCustomPayAmount] = useState<string>("");
  const [customPayMethod, setCustomPayMethod] = useState<string>("UPI");

  const [showCustomSettleForm, setShowCustomSettleForm] = useState(false);
  const [manualFromId, setManualFromId] = useState("");
  const [manualToId, setManualToId] = useState("");
  const [manualAmount, setManualAmount] = useState("");
  const [manualMethod, setManualMethod] = useState("UPI");
  const [manualRefId, setManualRefId] = useState("");

  async function handleConfirmCustomTransfer(tr: PendingTransferItem) {
    const entered = parseFloat(customPayAmount);
    if (!Number.isFinite(entered) || entered <= 0) {
      onError("Enter a valid amount to settle.");
      return;
    }
    if (Math.round(entered * 100) > Math.round(tr.amount * 100)) {
      onError(`Amount cannot exceed ${formatINR(tr.amount, currencyCode)}.`);
      return;
    }

    const ok = await onApplySettlement({
      fromId: tr.fromId,
      fromName: tr.fromName,
      toId: tr.toId,
      toName: tr.toName,
      amount: entered,
      method: customPayMethod,
    });

    if (ok) {
      setCustomPayTransferId(null);
      setCustomPayAmount("");
    }
  }

  async function handleManualSettlementSubmit(e: React.FormEvent) {
    e.preventDefault();
    const numeric = parseFloat(manualAmount);
    const receiverId =
      manualToId || membersList.find((m) => m.netBalance > 0.009)?.id || "";
    if (!manualFromId || !receiverId || manualFromId === receiverId) {
      onError("Select two different members.");
      return;
    }
    if (!Number.isFinite(numeric) || numeric <= 0) {
      onError("Enter a valid positive settlement amount.");
      return;
    }

    const fromMember = membersList.find((m) => m.id === manualFromId);
    const toMember = membersList.find((m) => m.id === receiverId);
    if (!fromMember || !toMember) return;
    if (fromMember.netBalance >= 0 || toMember.netBalance <= 0) {
      onError("Choose a member who owes and a member who is owed.");
      return;
    }
    const maxSettlement = Math.min(-fromMember.netBalance, toMember.netBalance);
    if (Math.round(numeric * 100) > Math.round(maxSettlement * 100)) {
      onError(`Amount cannot exceed ${formatINR(maxSettlement, currencyCode)}.`);
      return;
    }

    const succeeded = await onApplySettlement({
      fromId: fromMember.id,
      fromName: fromMember.name,
      toId: toMember.id,
      toName: toMember.name,
      amount: numeric,
      method: manualMethod,
      referenceId: manualRefId.trim() || undefined,
    });

    if (succeeded) {
      setManualAmount("");
      setManualRefId("");
      setShowCustomSettleForm(false);
    }
  }

  return (
    <div
      className={`${
        mobileTab === "SETTLE" ? "block" : "hidden"
      } rounded-2xl border border-slate-200 bg-white p-3.5 shadow-2xs sm:p-5 lg:block dark:border-zinc-800 dark:bg-zinc-900`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Handshake className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
          <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
            Who Owes Whom
          </h2>
        </div>

        <button
          type="button"
          onClick={() => {
            if (showCustomSettleForm) {
              setShowCustomSettleForm(false);
              return;
            }
            const firstDebtor = membersList.find((m) => m.netBalance < -0.009);
            const firstCreditor = membersList.find((m) => m.netBalance > 0.009);
            const fromId =
              firstDebtor?.id ?? currentUserMemberId ?? membersList[0]?.id ?? "";
            const toId =
              firstCreditor?.id ??
              membersList.find((m) => m.id !== fromId)?.id ??
              "";
            setManualFromId(fromId);
            setManualToId(toId);
            setShowCustomSettleForm(true);
          }}
          className="rounded-lg bg-indigo-50 px-2.5 py-1 text-xs font-bold text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-950 dark:text-indigo-300 dark:hover:bg-indigo-900 cursor-pointer"
        >
          {showCustomSettleForm ? "Close" : "+ Custom"}
        </button>
      </div>

      {showCustomSettleForm && (
        <form
          onSubmit={handleManualSettlementSubmit}
          className="mt-3 space-y-3 rounded-2xl border border-indigo-200 bg-indigo-50/50 p-3 dark:border-indigo-800/70 dark:bg-indigo-950/30"
        >
          <p className="text-xs font-bold text-indigo-800 dark:text-indigo-200">
            Record Custom / Partial Payment
          </p>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-200">
                From
              </label>
              <div className="relative mt-1">
                <select
                  value={manualFromId}
                  onChange={(e) => {
                    const nextFromId = e.target.value;
                    setManualFromId(nextFromId);
                    if (nextFromId === manualToId) {
                      setManualToId(
                        membersList.find(
                          (m) => m.netBalance > 0.009 && m.id !== nextFromId,
                        )?.id ?? "",
                      );
                    }
                  }}
                  className="h-10 w-full appearance-none rounded-xl border border-slate-300 bg-white pr-7 pl-2.5 text-xs font-bold text-slate-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
                >
                  {membersList
                    .filter((m) => m.netBalance < -0.009)
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                </select>
                <ChevronDown className="pointer-events-none absolute top-1/2 right-2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500 dark:text-zinc-400" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-200">
                To
              </label>
              <div className="relative mt-1">
                <select
                  value={manualToId}
                  onChange={(e) => setManualToId(e.target.value)}
                  className="h-10 w-full appearance-none rounded-xl border border-slate-300 bg-white pr-7 pl-2.5 text-xs font-bold text-slate-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
                >
                  {membersList
                    .filter((m) => m.netBalance > 0.009)
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                </select>
                <ChevronDown className="pointer-events-none absolute top-1/2 right-2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500 dark:text-zinc-400" />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-200">
                Amount ({currencyCode})
              </label>
              <input
                required
                type="number"
                step="0.01"
                min="0.01"
                placeholder="500.00"
                value={manualAmount}
                onChange={(e) => setManualAmount(e.target.value)}
                className="mt-1 h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-xs font-bold text-slate-900 tabular-nums outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-200">
                Method
              </label>
              <div className="relative mt-1">
                <select
                  value={manualMethod}
                  onChange={(e) => setManualMethod(e.target.value)}
                  className="h-10 w-full appearance-none rounded-xl border border-slate-300 bg-white pr-7 pl-2.5 text-xs font-bold text-slate-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
                >
                  <option value="UPI">UPI</option>
                  <option value="Cash">Cash</option>
                  <option value="Bank Transfer">Bank Transfer</option>
                </select>
                <ChevronDown className="pointer-events-none absolute top-1/2 right-2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500 dark:text-zinc-400" />
              </div>
            </div>
          </div>

          <input
            placeholder="Optional UPI / Transaction Ref ID"
            value={manualRefId}
            onChange={(e) => setManualRefId(e.target.value)}
            className="h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-xs font-medium text-slate-900 placeholder:text-slate-400 outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder:text-zinc-500"
          />

          <button
            type="submit"
            className="flex h-10 w-full items-center justify-center gap-1.5 rounded-xl bg-emerald-600 text-xs font-bold text-white hover:bg-emerald-700 cursor-pointer"
          >
            <CheckCircle2 className="h-4 w-4" />
            Record Payment
          </button>
        </form>
      )}

      {pendingTransfers.length === 0 ? (
        <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50/80 p-5 text-center dark:border-emerald-800/60 dark:bg-emerald-950/35">
          <CheckCircle2 className="mx-auto h-7 w-7 text-emerald-600 dark:text-emerald-400" />
          <p className="mt-2 text-sm font-bold text-emerald-900 dark:text-emerald-200">
            Everyone is settled up!
          </p>
          <p className="mt-0.5 text-xs text-emerald-700 dark:text-emerald-300">
            No pending payments between members.
          </p>
        </div>
      ) : (
        <div className="mt-3 space-y-2.5">
          {pendingTransfers.map((tr) => {
            const isCustomOpen = customPayTransferId === tr.id;
            const halfAmount = Math.round((tr.amount / 2) * 100) / 100;
            const involvesMe =
              tr.fromId === currentUserMemberId || tr.toId === currentUserMemberId;
            const iAmCreditor = tr.toId === currentUserMemberId;

            return (
              <div
                key={tr.id}
                className={`rounded-2xl border p-3 ${
                  involvesMe
                    ? "border-indigo-300/90 bg-indigo-50/40 dark:border-indigo-700/70 dark:bg-indigo-950/30"
                    : "border-slate-200 bg-slate-50/80 dark:border-zinc-800 dark:bg-zinc-950/70"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5 text-xs font-bold text-slate-900 sm:text-sm dark:text-white">
                    <span>{tr.fromId === currentUserMemberId ? "You" : tr.fromName}</span>
                    <ArrowRight className="h-3.5 w-3.5 text-slate-500 dark:text-zinc-400" />
                    <span>{tr.toId === currentUserMemberId ? "You" : tr.toName}</span>
                  </div>
                  <span
                    className={`font-display text-sm font-black tabular-nums sm:text-base ${
                      tr.fromId === currentUserMemberId
                        ? "text-rose-600 dark:text-rose-400"
                        : "text-emerald-600 dark:text-emerald-400"
                    }`}
                  >
                    {formatINR(tr.amount, currencyCode)}
                  </span>
                </div>

                {tr.toUpi && (
                  <div className="mt-2 flex items-center justify-between rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
                    <span className="truncate">UPI: {tr.toUpi}</span>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard?.writeText(tr.toUpi!);
                        setCopiedUpi(tr.id);
                        setTimeout(() => setCopiedUpi(null), 2000);
                      }}
                      className="ml-2 inline-flex shrink-0 items-center gap-1 font-bold text-indigo-600 dark:text-indigo-400 cursor-pointer"
                    >
                      <Copy className="h-3.5 w-3.5" />
                      {copiedUpi === tr.id ? "Copied" : "Copy"}
                    </button>
                  </div>
                )}

                {!isCustomOpen ? (
                  <div className="mt-2.5 grid grid-cols-12 gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        void onApplySettlement({
                          fromId: tr.fromId,
                          fromName: tr.fromName,
                          toId: tr.toId,
                          toName: tr.toName,
                          amount: tr.amount,
                          method: "UPI",
                        })
                      }
                      className={`col-span-7 flex h-10 items-center justify-center gap-1.5 rounded-xl px-3 text-xs font-bold text-white transition active:scale-[0.99] cursor-pointer ${
                        iAmCreditor
                          ? "bg-indigo-600 hover:bg-indigo-700"
                          : "bg-emerald-600 hover:bg-emerald-700"
                      }`}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {iAmCreditor ? "Mark Received" : "Settle Full"}
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setCustomPayTransferId(tr.id);
                        setCustomPayAmount(String(halfAmount));
                      }}
                      className="col-span-5 flex h-10 items-center justify-center rounded-xl border border-slate-300 bg-white px-2.5 text-xs font-bold text-slate-800 transition hover:bg-slate-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700 cursor-pointer"
                    >
                      Custom ₹
                    </button>
                  </div>
                ) : (
                  <div className="mt-2.5 space-y-2.5 rounded-xl border border-indigo-300 bg-white p-3 dark:border-indigo-700 dark:bg-zinc-900">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-800 dark:text-zinc-100">
                        Enter partial or full amount
                      </span>
                      <button
                        type="button"
                        onClick={() => setCustomPayTransferId(null)}
                        className="text-slate-500 hover:text-slate-700 dark:text-zinc-400 cursor-pointer"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>

                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => setCustomPayAmount(String(halfAmount))}
                        className="rounded-lg border border-slate-300 bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-800 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 cursor-pointer"
                      >
                        Half ({formatINR(halfAmount, currencyCode)})
                      </button>
                      <button
                        type="button"
                        onClick={() => setCustomPayAmount(String(tr.amount))}
                        className="rounded-lg border border-slate-300 bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-800 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 cursor-pointer"
                      >
                        Full ({formatINR(tr.amount, currencyCode)})
                      </button>
                    </div>

                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-xs font-bold text-slate-500 dark:text-zinc-400">
                          ₹
                        </span>
                        <input
                          type="number"
                          step="0.01"
                          min="0.01"
                          max={tr.amount}
                          value={customPayAmount}
                          onChange={(e) => setCustomPayAmount(e.target.value)}
                          className="h-9 w-full rounded-lg border border-slate-300 bg-slate-50 pr-2.5 pl-6 text-xs font-bold text-slate-900 tabular-nums outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-white"
                        />
                      </div>

                      <div className="relative">
                        <select
                          value={customPayMethod}
                          onChange={(e) => setCustomPayMethod(e.target.value)}
                          className="h-9 appearance-none rounded-lg border border-slate-300 bg-slate-50 pr-7 pl-2.5 text-xs font-bold text-slate-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-white"
                        >
                          <option value="UPI">UPI</option>
                          <option value="Cash">Cash</option>
                          <option value="Bank Transfer">Bank</option>
                        </select>
                        <ChevronDown className="pointer-events-none absolute top-1/2 right-2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500 dark:text-zinc-400" />
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => void handleConfirmCustomTransfer(tr)}
                      className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-600 text-xs font-bold text-white hover:bg-emerald-700 cursor-pointer"
                    >
                      <Check className="h-3.5 w-3.5" />
                      Confirm{" "}
                      {customPayAmount
                        ? formatINR(parseFloat(customPayAmount) || 0, currencyCode)
                        : "Payment"}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}