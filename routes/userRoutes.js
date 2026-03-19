const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { ensureAuthenticated } = require('../middleware/authMiddleware');

// [GET] Xem trang cá nhân (Được bảo vệ)
// Đường dẫn thực tế sẽ là: /user/profile
router.get('/profile', ensureAuthenticated, userController.getProfile);

module.exports = router;