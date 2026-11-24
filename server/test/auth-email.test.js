const assert = require('node:assert/strict');
const { test } = require('node:test');
const authController = require('../src/controllers/auth.controller');
const authService = require('../src/services/auth.service');
const emailService = require('../src/services/email.service');

test('OTP request only succeeds when the generated code is delivered', async (t) => {
  const originalRequestOTP = authService.requestOTP;
  const originalSendOTPEmail = emailService.sendOTPEmail;
  t.after(() => {
    authService.requestOTP = originalRequestOTP;
    emailService.sendOTPEmail = originalSendOTPEmail;
  });

  authService.requestOTP = async () => ({
    success: true,
    message: 'OTP sent to email',
    otp: '482915',
  });

  let deliveredOtp;
  emailService.sendOTPEmail = async ({ otp }) => {
    deliveredOtp = otp;
    return { success: true };
  };

  let responseBody;
  await authController.requestOtp(
    { body: { email: 'person@example.com', purpose: 'register' } },
    { json(body) { responseBody = body; } },
    (error) => { throw error; },
  );
  assert.equal(deliveredOtp, '482915');
  assert.deepEqual(responseBody, { success: true, message: 'OTP sent to email' });
  assert.equal(Object.hasOwn(responseBody, 'otp'), false);

  emailService.sendOTPEmail = async () => ({
    success: false,
    error: 'SMTP authentication rejected',
  });
  let deliveryError;
  await authController.requestOtp(
    { body: { email: 'person@example.com', purpose: 'register' } },
    { json() { assert.fail('Failed delivery must not return success.'); } },
    (error) => { deliveryError = error; },
  );
  assert.equal(deliveryError.status, 503);
  assert.match(deliveryError.message, /SMTP configuration/);
});
