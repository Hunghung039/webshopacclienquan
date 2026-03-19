const passport = require('passport');
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { maskName } = require('../utils/helpers');

// 1. HIỂN THỊ TRANG LOGIN
exports.getLoginPage = (req, res) => {
    const currentTheme = req.theme || 'default';
    if (req.isAuthenticated()) return res.redirect('/user/profile');
    res.render(`themes/${currentTheme}/login`, { title: 'Đăng Nhập / Đăng Ký' });
};

// 2. XỬ LÝ ĐĂNG KÝ (FIX: TỰ ĐỘNG ĐĂNG NHẬP SAU KHI TẠO)
exports.register = async (req, res) => {
    const { username, email, password, confirm_password } = req.body;

    // 1. LẤY IP THẬT CỦA KHÁCH HÀNG
    let clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
    if (clientIp && clientIp.includes(',')) {
        clientIp = clientIp.split(',')[0].trim(); 
    }

    try {
        // 2. CHẶN GIỚI HẠN IP (TỐI ĐA 3 TÀI KHOẢN)
        if (clientIp) {
            const [ipCheck] = await db.query("SELECT COUNT(id) as total FROM users WHERE register_ip = ?", [clientIp]);
            if (ipCheck[0].total >= 3) {
                req.flash('error_msg', 'Hệ thống từ chối: Mỗi địa chỉ IP chỉ được tạo tối đa 3 tài khoản!');
                return res.redirect('/auth/login'); 
            }
        }

        // 3. KIỂM TRA MẬT KHẨU
        if (password !== confirm_password) {
            req.flash('error_msg', 'Mật khẩu xác nhận không khớp!');
            return res.redirect('/auth/login'); 
        }

        if (password.length < 6) {
            req.flash('error_msg', 'Mật khẩu phải có ít nhất 6 ký tự!');
            return res.redirect('/auth/login');
        }

        // ==================================================
        // ĐÃ FIX LỖI TẠI ĐÂY: TÁCH RIÊNG KIỂM TRA TRÙNG LẶP
        // ==================================================
        
        // 3.1 - Kiểm tra Tên đăng nhập (Bắt buộc)
        const [existingUsername] = await db.query("SELECT id FROM users WHERE username = ?", [username]);
        if (existingUsername.length > 0) {
            req.flash('error_msg', 'Tên đăng nhập đã tồn tại! Vui lòng chọn tên khác.');
            return res.redirect('/auth/login'); 
        }

        // 3.2 - CHỈ kiểm tra Email NẾU người dùng có nhập dữ liệu vào ô Email
        if (email && email.trim() !== '') {
            const [existingEmail] = await db.query("SELECT id FROM users WHERE email = ?", [email]);
            if (existingEmail.length > 0) {
                req.flash('error_msg', 'Email này đã được sử dụng!');
                return res.redirect('/auth/login'); 
            }
        }

        // ==================================================

        // 4. MÃ HÓA MẬT KHẨU VÀ LƯU VÀO DATABASE
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const [result] = await db.query(
            "INSERT INTO users (username, email, password, role, money, register_ip) VALUES (?, ?, ?, 'user', 0, ?)",
            [username, email, hashedPassword, clientIp]
        );

        // 5. TỰ ĐỘNG ĐĂNG NHẬP SAU KHI ĐĂNG KÝ
        const [newUsers] = await db.query("SELECT * FROM users WHERE id = ?", [result.insertId]);
        const newUser = newUsers[0];

        req.login(newUser, function(err) {
            if (err) {
                console.error("Lỗi Auto-Login:", err);
                req.flash('error_msg', 'Đăng ký thành công nhưng tự động đăng nhập thất bại. Vui lòng đăng nhập tay!');
                return res.redirect('/auth/login');
            }
            
            // Thành công -> Bắn về trang chủ
            req.flash('success_msg', 'Đăng ký tài khoản thành công! Chào mừng sếp đến với Shop.');
            return res.redirect('/'); 
        });

    } catch (err) {
        console.error("Lỗi hệ thống khi đăng ký:", err);
        req.flash('error_msg', 'Lỗi hệ thống! Liên hệ Admin.');
        res.redirect('/auth/login'); 
    }
};
// 3. XỬ LÝ ĐĂNG NHẬP (FIX: BẮT LỖI TỪ PASSPORT ĐỂ HIỂN THỊ)
exports.login = (req, res, next) => {
    passport.authenticate('local', (err, user, info) => {
        if (err) return next(err);
        
        // NẾU SAI TÀI KHOẢN HOẶC BỊ BAN -> TRẢ VỀ URL KÈM LỖI
        if (!user) {
            const msg = info ? info.message : 'Đăng nhập thất bại';
            return res.redirect(`/auth/login?message=${encodeURIComponent(msg)}&type=error`);
        }

        // NẾU ĐÚNG -> ĐĂNG NHẬP VÀ CHUYỂN HƯỚNG
        req.logIn(user, (err) => {
            if (err) return next(err);
            
            // Bắn socket thông báo có người vừa online cho xôm
            const io = req.app.get('socketio');
            if (io) {
                io.emit('broadcast-activity', {
                    user: maskName(user.username),
                    action: 'vừa đăng nhập thành công',
                    time: 'Vừa xong'
                });
            }

            // Trả khách về trang họ đang xem dở (nếu có), không thì về profile
            const redirectUrl = req.session.returnTo || '/user/profile';
            delete req.session.returnTo;
            
            return res.redirect(`${redirectUrl}?message=Đăng nhập thành công!&type=success`);
        });
    })(req, res, next);
};

// 4. LOGOUT
exports.logout = (req, res, next) => {
    req.logout(function(err) {
        if (err) { return next(err); }
        res.redirect('/?message=Đã đăng xuất!&type=success');
    });
};