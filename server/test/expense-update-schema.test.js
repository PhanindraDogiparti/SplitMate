const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  expenseSchema,
  expenseUpdateSchema,
} = require('../src/validators/schemas');

test('expense status updates accept numeric timestamps without adding expense fields', () => {
  const statusUpdate = { isSettled: true, settledAt: Date.now() };
  const result = expenseUpdateSchema.safeParse(statusUpdate);

  assert.equal(result.success, true);
  assert.deepEqual(result.data, statusUpdate);
});

test('expense status updates allow reopening with a null timestamp', () => {
  const statusUpdate = { isSettled: false, settledAt: null };
  const result = expenseUpdateSchema.safeParse(statusUpdate);

  assert.equal(result.success, true);
  assert.deepEqual(result.data, statusUpdate);
});

test('expense schemas accept one payer and reject multiple payers', () => {
  const payer = { memberId: 'member-1', amount: 10 };
  const expense = {
    title: 'Dinner',
    amount: 10,
    payers: [payer],
  };

  assert.equal(expenseSchema.safeParse(expense).success, true);
  assert.equal(expenseSchema.safeParse({
    ...expense,
    payers: [payer, { memberId: 'member-2', amount: 0.01 }],
  }).success, false);
  assert.equal(expenseUpdateSchema.safeParse({ payers: [payer] }).success, true);
  assert.equal(expenseUpdateSchema.safeParse({
    payers: [payer, { memberId: 'member-2', amount: 0.01 }],
  }).success, false);
});
