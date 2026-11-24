const { z } = require('zod');

const memberSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(254),
  upiId: z.string().trim().max(100).optional(),
  role: z.enum(['ADMIN', 'MEMBER']).optional().default('MEMBER'),
});

const addGroupMemberSchema = z.object({
  email: z.string().trim().email().max(254),
});

const createGroupSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).optional().default(''),
  type: z.string().trim().min(1).max(40).optional().default('OTHER'),
  customTypeLabel: z.string().trim().max(80).optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional().default('INR'),
  simplifyDebts: z.boolean().optional().default(true),
  members: z.array(memberSchema).max(100).optional().default([]),
});

const updateGroupSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(2000).optional(),
  type: z.string().trim().min(1).max(40).optional(),
  customTypeLabel: z.string().trim().max(80).optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  simplifyDebts: z.boolean().optional(),
});

const payerSchema = z.object({
  memberId: z.string().min(1),
  amount: z.number().finite().positive().max(100000000),
});

const expenseSchema = z.object({
  title: z.string().trim().min(1).max(160),
  amount: z.number().finite().positive().max(100000000),
  category: z.string().trim().min(1).max(80).optional().default('Other'),
  paidByMemberId: z.string().min(1).optional(),
  payers: z.array(payerSchema).min(1).max(100).optional(),
  splitType: z.string().trim().min(1).max(40).optional().default('EQUAL'),
  paymentMethod: z.string().trim().min(1).max(40).optional().default('OTHER'),
  date: z.string().refine((value) => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const parsed = new Date(`${value}T00:00:00.000Z`);
      return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
    }
    return !Number.isNaN(Date.parse(value));
  }).optional(),
  notes: z.string().trim().max(2000).optional().default(''),
  splits: z.array(z.object({
    memberId: z.string().min(1),
    amount: z.number().finite().min(0).max(100000000),
  })).min(1).max(100).optional(),
}).refine((expense) => Boolean(expense.paidByMemberId || expense.payers?.length), {
  message: 'Specify at least one payer.',
  path: ['payers'],
});

const expenseStatusSchema = z.object({
  isSettled: z.boolean(),
  settledAt: z.union([
    z.number().int().positive(),
    z.string().datetime(),
    z.null(),
  ]).optional(),
});

// Partial update schema for editing an expense.
// Unlike expenseSchema, this does NOT require payers or paidByMemberId,
// since the server can update individual fields without needing the full allocation data.
const expenseUpdateSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  amount: z.number().finite().positive().max(100000000).optional(),
  category: z.string().trim().min(1).max(80).optional().default('Other'),
  paidByMemberId: z.string().min(1).optional(),
  payers: z.array(z.object({
    memberId: z.string().min(1),
    amount: z.number().finite().positive().max(100000000),
  })).optional(),
  splitType: z.string().trim().min(1).max(40).optional().default('EQUAL'),
  paymentMethod: z.string().trim().min(1).max(40).optional().default('OTHER'),
  date: z.string().refine((value) => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const parsed = new Date(`${value}T00:00:00.000Z`);
      return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
    }
    return !Number.isNaN(Date.parse(value));
  }).optional(),
  notes: z.string().trim().max(2000).optional(),
  splits: z.array(z.object({
    memberId: z.string().min(1),
    amount: z.number().finite().min(0).max(100000000),
  })).optional(),
}).refine(
  (data) => {
    // At least one field must be provided for an update
    return Object.keys(data).length > 0;
  },
  { message: 'At least one field must be provided for the update.', path: ['_root'] }
);

const settlementSchema = z.object({
  fromMemberId: z.string().min(1),
  toMemberId: z.string().min(1),
  amount: z.number().finite().positive().max(100000000),
  paymentMethod: z.string().trim().min(1).max(40).optional().default('OTHER'),
  referenceId: z.string().trim().max(160).optional(),
});

const shareTokenSchema = z.object({
  ttlHours: z.number().int().positive().min(1).max(48).default(24),
});

const commentSchema = z.object({
  expenseId: z.string().min(1),
  author: z.string().trim().min(1).max(120),
  text: z.string().trim().min(1).max(2000),
});

const authRegisterSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(8).max(128),
  name: z.string().trim().min(1).max(120),
  upiId: z.string().trim().max(100).optional(),
});

const authLoginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1),
});

const authRequestOtpSchema = z.object({
  email: z.string().trim().email().max(254),
  purpose: z.enum(['register', 'login', 'reset-password']).optional().default('login'),
});

const authVerifyOtpSchema = z.object({
  email: z.string().trim().email().max(254),
  otp: z.string().length(6).regex(/^\d{6}$/),
  purpose: z.enum(['register', 'login', 'reset-password']).optional().default('login'),
  name: z.string().trim().min(1).max(120).optional(),
  password: z.string().min(8).max(128).optional(),
  upiId: z.string().trim().max(100).optional(),
});

const authResetPasswordSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(8).max(128),
  confirmPassword: z.string().min(8).max(128),
}).refine(data => data.password === data.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
});

const profileUpdateSchema = z.object({
  fullName: z.string().trim().min(1).max(120).optional(),
  email: z.string().trim().email().max(254).optional(),
  username: z.string().trim().min(1).max(120).optional(),
  phone: z.string().trim().max(50).optional(),
  defaultCurrency: z.string().regex(/^[A-Z]{3}$/).optional(),
  upiId: z.string().trim().max(100).optional(),
});

function validateBody(schema) {
  return (req, res, next) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      const { ApiError } = require('../utils/errors');
      throw ApiError.badRequest('Invalid request body.', parsed.error.flatten());
    }
    req.body = parsed.data;
    next();
  };
}

module.exports = {
  memberSchema,
  addGroupMemberSchema,
  createGroupSchema,
  updateGroupSchema,
  expenseSchema,
  expenseUpdateSchema,
  settlementSchema,
  shareTokenSchema,
  commentSchema,
  authRegisterSchema,
  authLoginSchema,
  authRequestOtpSchema,
  authVerifyOtpSchema,
  authResetPasswordSchema,
  validateBody,
};