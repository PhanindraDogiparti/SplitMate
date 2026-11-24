# Fix Summary: Edit Expenses Not Working

## Two Issues Fixed

### Issue 1: Zod Schema Validation (Server)
**File:** `server/src/validators/schemas.js`

**Problem:** `expenseUpdateSchema` used `z.union([expenseSchema, expenseStatusSchema])` which required `payers` array via a refine check. Partial updates from the client (title, amount, category, etc.) without `payers` failed validation.

**Fix:** Replaced with a partial update schema making all fields optional, with a refine check ensuring at least one field is provided.

### Issue 2: Split Redistribution (Client)  
**File:** `client/src/components/EditExpenseModal.tsx`

**Problem:** `onSplitInput` only called `applySplits` for PERCENTAGE/SHARES modes. In EQUAL mode, typing individual amounts didn't update other members' shares.

**Fix:** Added EQUAL case in `onSplitInput` that redistributes total equally among included members on every amount change.

## Verification
Both schemas were tested with node to confirm partial updates now validate correctly, and the component now properly redistributes splits in EQUAL mode.