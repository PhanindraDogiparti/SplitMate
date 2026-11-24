# Fix for Edit Expenses Not Working

## Root Cause

The `expenseUpdateSchema` in `server/src/validators/schemas.js` was using `z.union([expenseSchema, expenseStatusSchema])`. The `expenseSchema` has a Zod refine check requiring either `paidByMemberId` or `payers` to be present:

```javascript
.refine((expense) => Boolean(expense.paidByMemberId || expense.payers?.length), {
  message: 'Specify at least one payer.',
  path: ['payers'],
});
```

When the client sends a partial update for editing an expense (changing title, amount, category, splitType, paymentMethod, date, notes), it doesn't include `payers`, so the Zod validation fails with `"payers: Specify at least one payer."`

## Fix

Replaced the `expenseUpdateSchema` with a new standalone object schema that:

1. Makes all fields optional using `.optional()`
2. Keeps default values for `category` and `splitType`
3. Adds a refine check ensuring at least one field is provided for an update
4. Removes the requirement that `payers` must be present

The new schema allows partial updates from the client to validate successfully without requiring the full `payers` array.

## Changed File

- `server/src/validators/schemas.js` - Replaced `expenseUpdateSchema` with a partial update schema