// routes/authRoutes.js
const express = require('express');
const router = express.Router();
const passport = require('passport');
const authController = require('../controllers/authController');
const { forwardAuthenticated } = require('../middleware/authMiddleware');

// --- 1. LOCAL AUTH (Đăng nhập thường) ---

// [GET] Hiển thị trang đăng nhập (BẠN ĐÃ THIẾU DÒNG NÀY)
router.get('/login', forwardAuthenticated, authController.getLoginPage);

// [POST] Xử lý đăng ký
router.post('/register', authController.register);

// [POST] Xử lý đăng nhập (Đã chuyển qua controller xử lý chuyên sâu)
router.post('/login', authController.login);

// --- 2. GOOGLE AUTH (Đăng nhập Google) ---
// Bấm nút Google thì bay vào route này để chuyển hướng sang trang Google
router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

// ============================================================
// XỬ LÝ KẾT QUẢ TỪ GOOGLE TRẢ VỀ (CALLBACK)
// ============================================================
router.get('/google/callback', function(req, res, next) {
    passport.authenticate('google', function(err, user, info) {
        // 1. Bắt mượt mà lỗi TokenError (Do F5 hoặc bấm đúp chuột)
        if (err) {
            if (err.name === 'TokenError') {
                console.warn("[OAUTH WARNING] Bỏ qua lỗi TokenError do request đúp từ trình duyệt.");
                return res.redirect('/auth/login?message=Phiên đăng nhập hết hạn hoặc bị lỗi mạng. Vui lòng thử lại!&type=error');
            }
            // Nếu là lỗi hệ thống khác thì đẩy ra màn hình 500
            return next(err); 
        }

        // 2. Đăng nhập thất bại (Ví dụ: Email không hợp lệ)
        if (!user) {
            return res.redirect('/auth/login?message=Không thể đăng nhập bằng Google lúc này!&type=error');
        }

        // 3. Đăng nhập thành công -> Tạo Session
        req.logIn(user, function(err) {
            if (err) { 
                return next(err); 
            }
            // Thành công -> Bắn về trang chủ kèm Toast thông báo xanh lá
            return res.redirect('/?message=Đăng nhập thành công! Chào mừng trở lại.&type=success');
        });
    })(req, res, next);
});
// --- 3. LOGOUT ---
// [GET] Đăng xuất
router.get('/logout', authController.logout);

module.exports = router;