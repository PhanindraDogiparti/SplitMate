const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { test } = require('node:test');

const databasePath = path.join(os.tmpdir(), `splitmate-api-${crypto.randomUUID()}.db`);
process.env.TURSO_DATABASE_URL = `file:${databasePath}`;
process.env.TURSO_AUTH_TOKEN = '';
process.env.CLIENT_WEB_URL = 'http://localhost:5173';
process.env.NODE_ENV = 'development';

const notificationService = require('../src/services/notification.service');
const invitationEmails = [];
notificationService.sendGroupInvitationEmail = async (invitation) => {
  invitationEmails.push(invitation);
  return { success: true };
};

const emailService = require('../src/services/email.service');
emailService.sendWelcomeEmail = async () => ({ success: true });

const app = require('../src/app');
const { getClient, closeDatabase } = require('../src/config/database');
const authService = require('../src/services/auth.service');

test('creates groups, records expenses, and settles balances', async (t) => {
  await app.locals.initializeDatabase();
  const server = app.listen(0);
  await once(server, 'listening');
  const address = server.address();

  let authToken = null;

  const request = (endpoint, options = {}) => fetch(
    `http://127.0.0.1:${address.port}/api/v1${endpoint}`,
    {
      ...options,
      headers: {
        'content-type': 'application/json',
        ...(authToken ? { 'authorization': `Bearer ${authToken}` } : {}),
        ...options.headers,
      },
    },
  );

  t.after(async () => {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await closeDatabase();
    for (const suffix of ['', '-shm', '-wal']) {
      fs.rmSync(`${databasePath}${suffix}`, { force: true });
    }
  });

  const health = await request('/health');
  assert.equal(health.status, 200);
  assert.equal((await health.json()).status, 'ok');

  const corsPreflight = await request('/groups', {
    method: 'OPTIONS',
    headers: {
      origin: 'http://localhost:5174',
      'access-control-request-method': 'GET',
      'access-control-request-headers': 'authorization,content-type',
    },
  });
  assert.equal(corsPreflight.status, 204);
  assert.equal(corsPreflight.headers.get('access-control-allow-origin'), 'http://localhost:5174');

  // Register and login to get auth token
  const registerResponse = await request('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      email: 'test@example.com',
      password: 'password123',
      name: 'Test User',
    }),
  });
  assert.equal(registerResponse.status, 201);
  const registerData = await registerResponse.json();
  authToken = registerData.data.token;

  const validAuthToken = authToken;
  authToken = 'invalid-token';
  const invalidTokenResponse = await request('/groups');
  assert.equal(invalidTokenResponse.status, 401);
  assert.match((await invalidTokenResponse.json()).message, /invalid token/i);
  authToken = validAuthToken;
  const healthAfterInvalidToken = await request('/health');
  assert.equal(healthAfterInvalidToken.status, 200);

  const unregisteredInvite = await request('/groups', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Unregistered invite test',
      members: [{ name: 'Not Registered', email: 'not-registered@example.com' }],
    }),
  });
  assert.equal(unregisteredInvite.status, 400);
  assert.match((await unregisteredInvite.json()).message, /register first/i);

  await authService.registerUser({
    email: 'alex@example.com',
    password: 'password123',
    name: 'Alex',
  });
  await authService.registerUser({
    email: 'sam@example.com',
    password: 'password123',
    name: 'Sam',
  });
  await authService.registerUser({
    email: 'pat@example.com',
    password: 'password123',
    name: 'Pat',
  });

  const groupResponse = await request('/groups', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Weekend trip',
      members: [
        { name: 'Alex', email: 'alex@example.com' },
        { name: 'Sam', email: 'sam@example.com' },
      ],
    }),
  });
  assert.equal(groupResponse.status, 201);
  const group = (await groupResponse.json()).data;
  const alex = group.members.find((member) => member.name === 'Alex');
  const sam = group.members.find((member) => member.name === 'Sam');
  const owner = group.members.find((member) => member.role === 'ADMIN');
  assert.ok(alex);
  assert.ok(sam);
  assert.ok(owner);

  const creatorToken = authToken;
  const alexToken = (await authService.loginUser({
    email: 'alex@example.com',
    password: 'password123',
  })).token;
  authToken = alexToken;
  const memberAddAttempt = await request(`/groups/${group.id}/members`, {
    method: 'POST',
    body: JSON.stringify({ name: 'Sam', email: 'sam@example.com' }),
  });
  assert.equal(memberAddAttempt.status, 403);
  const memberRemoveAttempt = await request(`/groups/${group.id}/members/${sam.id}`, {
    method: 'DELETE',
  });
  assert.equal(memberRemoveAttempt.status, 403);
  authToken = creatorToken;

  const groupsResponse = await request('/groups');
  assert.equal(groupsResponse.status, 200);
  const listedGroup = (await groupsResponse.json()).data.find((item) => item.id === group.id);
  assert.ok(listedGroup);
  assert.equal(listedGroup.members.length, 3);

  authToken = null;
  const unauthenticatedFriendsResponse = await request('/friends');
  assert.equal(unauthenticatedFriendsResponse.status, 401);
  authToken = creatorToken;
  const friendsResponse = await request('/friends');
  assert.equal(friendsResponse.status, 200);
  const friends = (await friendsResponse.json()).data.friends;
  assert.ok(friends.some((friend) => friend.email === 'alex@example.com'));
  assert.ok(friends.some((friend) => friend.email === 'sam@example.com'));

  const addedMemberResponse = await request(`/groups/${group.id}/members`, {
    method: 'POST',
    body: JSON.stringify({ email: 'pat@example.com' }),
  });
  assert.equal(addedMemberResponse.status, 201);
  const addedMember = (await addedMemberResponse.json()).data;
  assert.equal(addedMember.name, 'Pat');
  assert.ok(invitationEmails.some(
    (invitation) => invitation.to === 'pat@example.com' && invitation.groupId === group.id,
  ));
  const removedMemberResponse = await request(
    `/groups/${group.id}/members/${addedMember.id}`,
    { method: 'DELETE' },
  );
  assert.equal(removedMemberResponse.status, 200);

  const invalidExpense = await request(`/groups/${group.id}/expenses`, {
    method: 'POST',
    body: JSON.stringify({
      title: 'Dinner',
      amount: 3.01,
      paidByMemberId: alex.id,
      splits: [
        { memberId: alex.id, amount: 1 },
        { memberId: sam.id, amount: 2 },
      ],
    }),
  });
  assert.equal(invalidExpense.status, 400);

  const multiplePayerExpense = await request(`/groups/${group.id}/expenses`, {
    method: 'POST',
    body: JSON.stringify({
      title: 'Dinner',
      amount: 3.01,
      payers: [
        { memberId: alex.id, amount: 2.01 },
        { memberId: owner.id, amount: 1 },
      ],
    }),
  });
  assert.equal(multiplePayerExpense.status, 400);

  const expenseResponse = await request(`/groups/${group.id}/expenses`, {
    method: 'POST',
    body: JSON.stringify({
      title: 'Dinner',
      amount: 3.01,
      paidByMemberId: alex.id,
      splits: [
        { memberId: alex.id, amount: 2.01 },
        { memberId: sam.id, amount: 1 },
      ],
    }),
  });
  assert.equal(expenseResponse.status, 201);
  const expense = (await expenseResponse.json()).data;
  assert.equal(expense.totalAmount, 3.01);
  assert.equal(expense.payers.length, 1);

  const editedExpenseResponse = await request(
    `/groups/${group.id}/expenses/${expense.id}`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        title: 'Updated dinner',
        amount: 3.01,
        category: 'Food',
        date: '2025-01-15',
        paidByMemberId: alex.id,
        splits: [
          { memberId: alex.id, amount: 2.01 },
          { memberId: sam.id, amount: 1 },
        ],
      }),
    },
  );
  assert.equal(editedExpenseResponse.status, 200);
  assert.equal((await editedExpenseResponse.json()).data.title, 'Updated dinner');

  const markedExpenseResponse = await request(
    `/groups/${group.id}/expenses/${expense.id}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ isSettled: true, settledAt: Date.now() }),
    },
  );
  assert.equal(markedExpenseResponse.status, 200);
  assert.equal((await markedExpenseResponse.json()).data.isSettled, true);

  const reopenedExpenseResponse = await request(
    `/groups/${group.id}/expenses/${expense.id}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ isSettled: false, settledAt: null }),
    },
  );
  assert.equal(reopenedExpenseResponse.status, 200);
  assert.equal((await reopenedExpenseResponse.json()).data.isSettled, false);

  const settlementResponse = await request(`/groups/${group.id}/settlements`, {
    method: 'POST',
    body: JSON.stringify({
      fromMemberId: sam.id,
      toMemberId: alex.id,
      amount: 0.75,
      paymentMethod: 'UPI',
    }),
  });
  assert.equal(settlementResponse.status, 201);

  const groupDetails = await request(`/groups/${group.id}`);
  const details = (await groupDetails.json()).data;
  assert.equal(details.members.find((member) => member.id === owner.id).netBalance, 0);
  assert.equal(details.members.find((member) => member.id === alex.id).netBalance, 0.25);
  assert.equal(details.members.find((member) => member.id === sam.id).netBalance, -0.25);
  assert.equal(details.settlements[0].fromMemberId, sam.id);
  assert.equal(details.settlements[0].toMemberId, alex.id);
  assert.equal(details.expenses[0].splits.length, 2);
  assert.equal(details.settlements.length, 1);

  authToken = alexToken;
  const notificationsResponse = await request('/notifications');
  assert.equal(notificationsResponse.status, 200);
  const notifications = (await notificationsResponse.json()).data;
  assert.ok(notifications.some((item) => item.type === 'EXPENSE_UPDATED'));
  assert.ok(notifications.some((item) => item.type === 'SETTLEMENT'));

  const transactionsResponse = await request('/transactions');
  assert.equal(transactionsResponse.status, 200);
  const transactions = (await transactionsResponse.json()).data;
  assert.ok(transactions.some((item) => item.id === expense.id && item.kind === 'EXPENSE'));
  assert.ok(transactions.some((item) => item.kind === 'SETTLEMENT'));
  const expenseTransaction = transactions.find((item) => item.id === expense.id);
  assert.equal(expenseTransaction.totalAmount, 3.01);
  assert.equal(expenseTransaction.yourShare, 2.01);
  assert.equal(expenseTransaction.paidByYouAmount, 3.01);
  assert.equal(expenseTransaction.paidByYou, true);

  authToken = creatorToken;

  const refreshedGroupsResponse = await request('/groups');
  assert.equal(refreshedGroupsResponse.status, 200);
  const refreshedGroup = (await refreshedGroupsResponse.json()).data.find(
    (item) => item.id === group.id,
  );
  assert.equal(refreshedGroup.totalSpend, 3.01);
  assert.equal(refreshedGroup.myTotalShare, 0);
  assert.equal(refreshedGroup.netBalance, 0);

  const excessiveSettlement = await request(`/groups/${group.id}/settlements`, {
    method: 'POST',
    body: JSON.stringify({
      fromMemberId: sam.id,
      toMemberId: alex.id,
      amount: 0.76,
    }),
  });
  assert.equal(excessiveSettlement.status, 409);

  const shareTokenResponse = await request(`/groups/${group.id}/share-token`, {
    method: 'POST',
    body: JSON.stringify({ ttlHours: 24 }),
  });
  assert.equal(shareTokenResponse.status, 201);
  const shareToken = (await shareTokenResponse.json()).data.token;
  assert.ok(shareToken);

  await authService.registerUser({
    email: 'guest@example.com',
    password: 'password123',
    name: 'Guest',
  });
  authToken = (await authService.loginUser({
    email: 'guest@example.com',
    password: 'password123',
  })).token;
  const joinResponse = await request('/groups/join', {
    method: 'POST',
    body: JSON.stringify({ token: shareToken }),
  });
  assert.equal(joinResponse.status, 201);
  const joinedMember = (await joinResponse.json()).data;
  assert.equal(joinedMember.email, 'guest@example.com');
  assert.equal(joinedMember.groupId, group.id);
});
