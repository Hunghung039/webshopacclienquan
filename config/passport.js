const LocalStrategy = require('passport-local').Strategy;
const GoogleStrategy = require('passport-google-oauth20').Strategy; // Khai báo thư viện Google
const bcrypt = require('bcryptjs');
const db = require('./db'); 

module.exports = function(passport) {
    
    // ============================================================
    // 1. ĐĂNG NHẬP THƯỜNG (BẰNG USERNAME / PASSWORD)
    // ============================================================
    passport.use(new LocalStrategy({ 
        usernameField: 'username',
        passwordField: 'password',
        passReqToCallback: true // Bật tùy chọn này để dùng 'req' (tiện cho việc lưu log IP)
    }, async (req, username, password, done) => {
        try {
            // 1. Tìm user trong Database
            const [rows] = await db.query("SELECT * FROM users WHERE username = ?", [username]);
            
            // Kiểm tra xem có tìm thấy user không
            if (!rows || rows.length === 0) {
                return done(null, false, { message: 'Tài khoản không tồn tại!' });
            }
            
            const user = rows[0];

            // 2. Kiểm tra trạng thái Khóa (Ban)
            if (user.is_banned == 1) {
                return done(null, false, { message: `Tài khoản bị khóa! Lý do: ${user.ban_reason || 'Vi phạm quy định'}` });
            }

            // 3. [QUAN TRỌNG] Tránh lỗi khi user Google (không có pass) cố tình đăng nhập bằng form thường
            if (!user.password) {
                return done(null, false, { message: 'Tài khoản này được liên kết với Google. Vui lòng bấm Đăng nhập bằng Google!' });
            }

            // 4. So khớp mật khẩu đã băm (Hash)
            const isMatch = await bcrypt.compare(password, user.password);
            if (isMatch) {
                return done(null, user); // Đăng nhập thành công
            } else {
                return done(null, false, { message: 'Sai mật khẩu!' });
            }
        } catch (err) {
            console.error("[PASSPORT ERROR] Lỗi đăng nhập:", err);
            return done(err);
        }
    }));

    // ============================================================
    // 2. ĐĂNG NHẬP BẰNG GOOGLE OAUTH 2.0
    // ============================================================
    passport.use(new GoogleStrategy({
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: "/auth/google/callback", // Phải trùng 100% với trên Google Console
        passReqToCallback: true
    },
    async (req, accessToken, refreshToken, profile, done) => {
        try {
            const googleId = profile.id;
            const email = profile.emails && profile.emails.length > 0 ? profile.emails[0].value : null;
            
            if (!email) {
                return done(null, false, { message: 'Không thể lấy Email từ tài khoản Google của bạn!' });
            }

            // 1. Kiểm tra xem Google ID này đã tồn tại trong DB chưa
            const [users] = await db.query("SELECT * FROM users WHERE google_id = ?", [googleId]);
            
            if (users.length > 0) {
                const user = users[0];
                // Chặn Ban tài khoản
                if (user.is_banned == 1) {
                    return done(null, false, { message: `Tài khoản bị khóa! Lý do: ${user.ban_reason || 'Vi phạm quy định'}` });
                }
                return done(null, user); // Đăng nhập ngay
            }

            // 2. Kiểm tra xem Email đã được đăng ký bằng tay bao giờ chưa
            const [emailUsers] = await db.query("SELECT * FROM users WHERE email = ?", [email]);
            
            if (emailUsers.length > 0) {
                const user = emailUsers[0];
                // Chặn Ban tài khoản
                if (user.is_banned == 1) {
                    return done(null, false, { message: `Tài khoản bị khóa! Lý do: ${user.ban_reason || 'Vi phạm quy định'}` });
                }
                // Có email rồi -> Cập nhật (Liên kết) thêm google_id vào tài khoản đó
                await db.query("UPDATE users SET google_id = ? WHERE id = ?", [googleId, user.id]);
                return done(null, user);
            }

            // 3. NẾU LÀ NGƯỜI MỚI TINH -> TẠO TÀI KHOẢN MỚI
            // Tạo một username tự động từ email (VD: tranvan_1234)
            const baseName = email.split('@')[0].replace(/[^a-zA-Z0-9]/g, ''); 
            const randomString = Math.floor(1000 + Math.random() * 9000);
            const newUsername = `${baseName}_${randomString}`;

            // Lưu vào DB (Không lưu password)
            const [result] = await db.query(
                "INSERT INTO users (username, email, google_id, role, money) VALUES (?, ?, ?, 'user', 0)",
                [newUsername, email, googleId]
            );

            // Truy xuất lại user vừa tạo để Session nhận diện
            const [newUser] = await db.query("SELECT * FROM users WHERE id = ?", [result.insertId]);
            return done(null, newUser[0]);

        } catch (err) {
            console.error("[PASSPORT ERROR] Lỗi xác thực Google:", err);
            return done(err, false);
        }
    }));


    // ============================================================
    // 3. QUẢN LÝ SESSION (DÙNG CHUNG CHO CẢ LOCAL VÀ GOOGLE)
    // ============================================================
    
    // Lưu ID user vào Session khi đăng nhập thành công
    passport.serializeUser((user, done) => {
        done(null, user.id);
    });

    // Giải mã ID từ Session thành thông tin User mỗi khi load trang
    passport.deserializeUser(async (id, done) => {
        try {
            const [rows] = await db.query("SELECT * FROM users WHERE id = ?", [id]);
            
            if (rows && rows.length > 0) {
                const user = rows[0];
                
                // Kiểm tra live: Nếu Admin vừa bấm BAN, user đang online sẽ bị đá văng ngay lập tức
                if (user.is_banned == 1) {
                    return done(null, false); 
                }
                
                return done(null, user);
            } else {
                return done(null, false);
            }
        } catch (err) {
            console.error("[PASSPORT ERROR] Lỗi tải thông tin user:", err);
            return done(err, null);
        }
    });
};