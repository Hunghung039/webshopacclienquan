// middleware/authMiddleware.js

// =========================================================================
// 1. KIỂM TRA ĐĂNG NHẬP (Bảo vệ API & Web) + CHẶN NICK BỊ KHÓA
// =========================================================================
exports.ensureAuthenticated = (req, res, next) => {
    if (req.isAuthenticated()) {
        // [BẢO MẬT TẦNG 1]: Kiểm tra xem tài khoản có đang bị Admin khóa không?
        // Nếu bị khóa, lập tức hủy session, thu hồi cookie và đá văng ra ngoài.
        if (req.user && (req.user.is_banned === 1 || req.user.is_banned === true)) {
            return req.logout(function(err) {
                if (err) return next(err);
                req.session.destroy(() => {
                    const msg = encodeURIComponent('Tài khoản của bạn đã bị khóa do vi phạm chính sách!');
                    return res.redirect(`/auth/login?message=${msg}&type=error`);
                });
            });
        }

        // [BẢO MẬT TẦNG 2]: Chống lỗi "Nút Back" của trình duyệt (Cache Bypass)
        // Bắt buộc trình duyệt không được lưu cache các trang yêu cầu đăng nhập
        res.set('Cache-Control', 'no-cache, private, no-store, must-revalidate, max-stale=0, post-check=0, pre-check=0');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');

        return next(); // Đã đăng nhập và an toàn -> Cho phép đi tiếp
    }
    
    // KIỂM TRA: Nếu là yêu cầu từ Fetch API (AJAX / Tool)
    const isApiRequest = req.originalUrl.startsWith('/api/') || 
                         req.xhr || 
                         (req.headers.accept && req.headers.accept.includes('application/json'));

    if (isApiRequest) {
        return res.status(401).json({ 
            success: false, 
            message: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại!',
            requireLogin: true 
        });
    }

    // KIỂM TRA: Nếu là truy cập trang web thông thường
    // Lưu lại đường dẫn cũ để đăng nhập xong khách được đưa lại đúng chỗ đó
    req.session.returnTo = req.originalUrl;
    
    const msg = encodeURIComponent('Vui lòng đăng nhập để tiếp tục!');
    res.redirect(`/auth/login?message=${msg}&type=error`);
};

// =========================================================================
// 2. KIỂM TRA QUYỀN ADMIN (Bảo mật tuyệt đối - Bất khả xâm phạm)
// =========================================================================
const checkAdminRole = (req, res, next) => {
    // 1. Thỏa mãn 3 điều kiện thép: Đã đăng nhập + Có thông tin User + Đúng chuẩn chữ 'admin'
    if (req.isAuthenticated() && req.user && req.user.role === 'admin') {
        // Áp dụng chống Cache cho khu vực Admin (Tránh lộ data khi Admin rời máy)
        res.set('Cache-Control', 'no-cache, private, no-store, must-revalidate');
        return next(); 
    }
    
    // 2. GHI LOG CẢNH BÁO HACKER/USER TÒ MÒ ĐỂ SẾP NẮM ĐƯỢC IP KẺ GIAN
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    console.warn(`[BÁO ĐỘNG ĐỎ] Truy cập trái phép Admin Panel! ID User: ${req.user ? req.user.id : 'Khách lạ'} - IP: ${clientIp} - URL: ${req.originalUrl}`);

    // 3. XỬ LÝ NẾU LÀ YÊU CẦU TỪ API (Ví dụ hacker dùng Postman bắn API)
    const isApiRequest = req.originalUrl.startsWith('/api/') || req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'));
    if (isApiRequest) {
        return res.status(403).json({
            success: false,
            message: 'Khu vực cấm: Bàn tay đen tối của bạn đã bị ghi hình!'
        });
    }
    
    // 4. XỬ LÝ NẾU LÀ TRUY CẬP TỪ TRÌNH DUYỆT (Nghệ thuật giấu link)
    // Trả về trang 404 để "giả vờ" như đường dẫn Admin này không hề tồn tại trên đời.
    const theme = req.theme || 'default';
    return res.status(404).render(`themes/${theme}/404`, { 
        title: '404 - Không tìm thấy trang', // Giấu nhẹm đi, không ghi là Khu vực cấm nữa
        user: req.user || null 
    });
};

// Xuất hàm này ra dưới cả 2 tên để đề phòng các file Route cũ của sếp gọi nhầm tên vẫn chạy mượt
exports.isAdmin = checkAdminRole;
exports.ensureAdmin = checkAdminRole;

// =========================================================================
// 3. CHẶN NGƯỜI ĐÃ ĐĂNG NHẬP VÀO LẠI LOGIN/REGISTER
// =========================================================================
exports.forwardAuthenticated = (req, res, next) => {
    if (!req.isAuthenticated()) {
        return next(); // Chưa đăng nhập -> Cho vào trang Login/Register
    }
    // Đã đăng nhập rồi thì đẩy thẳng về trang chủ (Hoặc trang họ vừa định vào)
    res.redirect('/');      
};