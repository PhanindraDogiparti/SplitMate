const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { validateBody } = require('../validators/schemas');
const {
  authRegisterSchema,
  authLoginSchema,
  authRequestOtpSchema,
  authVerifyOtpSchema,
  authResetPasswordSchema,
  profileUpdateSchema,
} = require('../validators/schemas');
const authController = require('../controllers/auth.controller');

const router = express.Router();

router.post('/register', validateBody(authRegisterSchema), authController.register);
router.post('/login', validateBody(authLoginSchema), authController.login);
router.post('/request-otp', validateBody(authRequestOtpSchema), authController.requestOtp);
router.post('/verify-otp', validateBody(authVerifyOtpSchema), authController.verifyOtp);
router.post('/reset-password', validateBody(authResetPasswordSchema), authController.resetPassword);
router.patch('/profile', authenticateToken, validateBody(profileUpdateSchema), authController.saveProfile);

router.get('/me', authenticateToken, authController.me);
router.patch('/me', authenticateToken, authController.updateProfile);
router.patch('/me/password', authenticateToken, authController.changePassword);

module.exports = router;