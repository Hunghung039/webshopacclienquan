const express = require('express');
const router = express.Router();
const rechargeController = require('../controllers/rechargeController');
const { ensureAuthenticated } = require('../middleware/authMiddleware');
const { callbackLimiter, verifyCallbackIP } = require('../middleware/apiSecurity');

// Kiểm tra nhanh phòng trường hợp controller bị lỗi
if (!rechargeController.submitCard) {
    console.error("LỖI: rechargeController.submitCard bị undefined. Hãy kiểm tra lại file Controller!");
}

// 1. Route Gửi thẻ (Yêu cầu khách hàng đăng nhập)
router.post('/submit', ensureAuthenticated, rechargeController.submitCard);

// 2. Route Callback (API của Doithe1s gọi ngầm vào web, KHÔNG CẦN đăng nhập)
// Bắt buộc đi qua 2 khiên: IP Whitelist (Chỉ cho IP Doithe1s vào) + Rate Limit (Chống DDoS)
router.post('/callback', verifyCallbackIP, callbackLimiter, rechargeController.handleCallback);

module.exports = router;