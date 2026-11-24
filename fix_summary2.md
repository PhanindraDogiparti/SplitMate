# Fix for Edit Expense Splits Not Updating

## Root Cause

The `onSplitInput` function in `EditExpenseModal.tsx` only called `applySplits` for PERCENTAGE or SHARES modes, but **not** for EQUAL mode. This meant when users typed individual amounts in EQUAL mode, the other splits didn't update to maintain the total amount.

### Specific Issue

In the original code (lines 349-362), the `onSplitInput` function had:
```javascript
if (field === "percent" && splitType === "PERCENTAGE") {
  return applySplits(currentCents, "PERCENTAGE", updated);
}
if (field === "shares" && splitType === "SHARES") {
  return applySplits(currentCents, "SHARES", updated);
}
return updated;  // <-- No redistribution for EQUAL mode!
```

When a user typed an amount in EQUAL mode, the function just returned the updated row without calling `applySplits`, so other members' amounts stayed unchanged.

### Fix Applied

Added an `EQUAL` case in `onSplitInput` that calls `applySplits(currentCents, "EQUAL", updated)` to redistribute the total amount equally among all included members whenever any split amount is modified.

The `onAmountChange` handler was already correctly calling `applySplits(cents, splitType, prev)` which handles EQUAL mode properly, and `onEqualAll` was already present for quick equal splitting.

## Files Modified

- `client/src/components/EditExpenseModal.tsx` - Added EQUAL mode handling in `onSplitInput` function