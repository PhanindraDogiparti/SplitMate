const { ApiError, asyncHandler } = require('../utils/errors');
const authService = require('../services/auth.service');
const emailService = require('../services/email.service');

const register = asyncHandler(async (req, res) => {
  const { email, password, name, upiId } = req.body;
  const result = await authService.registerUser({ email, password, name, upiId });

  // Send welcome email
  await emailService.sendWelcomeEmail({ to: email, name });

  res.status(201).json({
    success: true,
    data: result,
  });
});

const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const result = await authService.loginUser({ email, password });

  res.json({
    success: true,
    data: result,
  });
});

const me = asyncHandler(async (req, res) => {
  const user = await authService.getUserById(req.user.id);

  res.json({
    success: true,
    data: {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        upiId: user.upi_id,
        avatarUrl: user.avatar_url,
      },
    },
  });
});

const updateProfile = asyncHandler(async (req, res) => {
  const user = await authService.updateUserProfile(req.user.id, req.body);

  res.json({
    success: true,
    data: {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        upiId: user.upi_id,
        avatarUrl: user.avatar_url,
      },
    },
  });
});

const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  await authService.changePassword(req.user.id, currentPassword, newPassword);

  res.json({
    success: true,
    message: 'Password changed successfully',
  });
});

const requestOtp = asyncHandler(async (req, res) => {
  const { email, purpose } = req.body;
  const result = await authService.requestOTP({ email, purpose });

  const otpResult = await emailService.sendOTPEmail({
    to: email,
    otp: result.otp,
    purpose,
  });
  if (!otpResult.success) {
    throw new ApiError(503, 'Unable to send the OTP email. Check the SMTP configuration and try again.');
  }

  res.json({
    success: true,
    message: result.message,
  });
});

const saveProfile = asyncHandler(async (req, res) => {
  const result = await authService.updateUserProfile(req.user.id, req.body);

  res.json({
    success: true,
    data: {
      user: {
        id: result.id,
        email: result.email,
        name: result.name,
        upiId: result.upi_id,
        avatarUrl: result.avatar_url,
      },
    },
  });
});

const verifyOtp = asyncHandler(async (req, res) => {
  const { email, otp, purpose, name, password, upiId } = req.body;
  const result = await authService.verifyOTPAndAuth({ email, otp, purpose, name, password, upiId });

  res.json({
    success: true,
    data: result,
  });
});

const resetPassword = asyncHandler(async (req, res) => {
  const { email, otp, password } = req.body;
  const result = await authService.resetPasswordWithOTP({ email, otp, password });

  res.json({
    success: true,
    data: result,
  });
});

module.exports = {
  register,
  login,
  me,
  updateProfile,
  saveProfile,
  changePassword,
  requestOtp,
  verifyOtp,
  resetPassword,
};