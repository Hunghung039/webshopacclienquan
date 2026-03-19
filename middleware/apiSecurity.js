const rateLimit = require('express-rate-limit');
const db = require('../config/db');

// Hàm ghi log vào DB khi có kẻ spam
const logSecurityEvent = async (req, limitOptions) => {
    try {
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        const endpoint = req.originalUrl;
        
        // Ghi vào bảng security_logs
        await db.query(`
            INSERT INTO security_logs (ip_address, endpoint, request_count) 
            VALUES (?, ?, ?)`, 
            [ip, endpoint, limitOptions.max]
        );
        console.warn(`[SECURITY] Đã chặn IP ${ip} spam vào ${endpoint}`);
    } catch (err) {
        console.error("Lỗi ghi log bảo mật:", err);
    }
};

// 1. BỘ LỌC CHO CALLBACK NẠP THẺ (Nghiêm ngặt)
// Đối tác nạp thẻ thường gọi 1-2 lần/giây là cùng. Nếu quá nhanh -> CHẶN.
exports.callbackLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // Trong vòng 1 phút
    max: 60, // Tối đa 60 request (Trung bình 1s/request)
    message: { 
        status: 'error', 
        message: 'Too many requests, please try again later.' 
    },
    standardHeaders: true, 
    legacyHeaders: false,
    handler: (req, res, next, options) => {
        logSecurityEvent(req, options);
        res.status(options.statusCode).json(options.message);
    }
});

// 2. BỘ LỌC CHO MUA ACC / SỰ KIỆN (Tránh spam click mua)
exports.orderLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // Trong vòng 1 phút
    max: 20, // Tối đa 20 lần bấm mua (Người thường không ai bấm nhanh thế)
    message: { 
        status: 'error', 
        message: 'Bạn thao tác quá nhanh! Vui lòng đợi một chút.' 
    },
    handler: (req, res, next, options) => {
        // Không cần ghi DB cho user thường, chỉ cần chặn thôi
        res.status(options.statusCode).json(options.message);
    }
});

// 3. BỘ LỌC ĐĂNG NHẬP/ĐĂNG KÝ (Tránh Brute Force Pass)
exports.authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 phút
    max: 10, // Sai quá 10 lần thì khóa IP 15 phút
    message: "Bạn thử đăng nhập sai quá nhiều lần. Vui lòng quay lại sau 15 phút!"
});
// ============================================================
// BẢO VỆ CALLBACK NẠP THẺ (CHỈ CHO PHÉP IP CỦA DOITHE1S)
// ============================================================
exports.verifyCallbackIP = (req, res, next) => {
    // 1. DANH SÁCH IP ĐƯỢC PHÉP VÀO (WHITELIST)
    const allowedIPs = [
        '14.225.212.166',  // IP của máy chủ Doithe1s (Sếp vừa thấy trên Log)
        // Nếu Doithe1s có cung cấp thêm IP nào khác, sếp cứ phẩy rồi thêm vào đây
        '127.0.0.1',       // Cho phép test nội bộ
        '::1'              // IPv6 localhost
    ];

    // 2. Lấy IP thực của Request (Xuyên qua Nginx/Cloudflare nếu có)
    let clientIp = req.headers['x-forwarded-for'] || req.connection.remoteAddress || req.ip;

    // Lọc IP nếu qua nhiều lớp Proxy
    if (clientIp && clientIp.includes(',')) {
        clientIp = clientIp.split(',')[0].trim();
    }
    
    // Xóa tiền tố IPv6 (::ffff:) để so sánh cho chuẩn xác
    if (clientIp && clientIp.startsWith('::ffff:')) {
        clientIp = clientIp.replace('::ffff:', '');
    }

    // 3. Kiểm tra xem IP có nằm trong Danh sách trắng không
    if (allowedIPs.includes(clientIp)) {
        next(); // Nếu đúng IP Doithe1s -> Cho phép vào Controller xử lý cộng tiền
    } else {
        // Nếu IP lạ -> Bắn cảnh báo và đá văng
        console.log(`[CẢNH BÁO BẢO MẬT] IP lạ cố tình gọi Callback Nạp Thẻ: ${clientIp}`);
        return res.status(403).json({ status: 'error', message: "Forbidden: IP không có quyền truy cập!" });
    }
};