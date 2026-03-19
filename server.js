require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const { Server } = require("socket.io");
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const passport = require('passport');
const flash = require('connect-flash');
const cookieParser = require('cookie-parser');
const csrf = require('csurf');
const siteSettingsMiddleware = require('./middleware/siteSettings');
const db = require('./config/db');

// Nạp cấu hình chiến lược đăng nhập
require('./config/passport')(passport); 

// ============================================================
// 1. KHỞI TẠO APP & SERVER
// ============================================================
const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Cấu hình tin tưởng Proxy Nginx (Rất quan trọng khi chạy trên VPS thực)
app.set('trust proxy', 1);

// ============================================================
// 2. CẤU HÌNH SESSION & BẢO MẬT COOKIE (CHUẨN PRODUCTION)
// ============================================================
const sessionStore = new MySQLStore({
    clearExpired: true, 
    checkExpirationInterval: 900000, 
    expiration: 86400000 * 7 
}, db);

app.use(session({
    key: 'shop_genz_session', 
    secret: process.env.SESSION_SECRET || 'shop_genz_secret_key_2026',
    store: sessionStore, 
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 1000 * 60 * 60 * 24 * 7, 
        secure: process.env.NODE_ENV === 'production', 
        httpOnly: true, 
        sameSite: 'lax' 
    }
}));

app.use(flash());
app.use(passport.initialize());
app.use(passport.session());

// ============================================================
// 3. CẤU HÌNH VIEW ENGINE
// ============================================================
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ============================================================
// 4. MIDDLEWARE CƠ BẢN & BẢO MẬT TẦNG CAO (CSRF, DDoS)
// ============================================================
app.use(compression()); 

// Cấu hình Helmet nới lỏng để load được ảnh từ các nguồn ngoài (CDN)
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
})); 

app.use(express.json({ limit: '5mb' })); 
app.use(express.urlencoded({ extended: true, limit: '5mb' })); 
app.use(express.static(path.join(__dirname, 'public'))); 

// [BẢO MẬT]: KÍCH HOẠT CSRF CHỐNG LỪA ĐẢO NHẤP CHUỘT
app.use(cookieParser());
const csrfProtection = csrf({ cookie: true });

// Áp dụng CSRF cho toàn web, NGOẠI TRỪ các API Callback (Webhook) nhận tiền hoặc API Public
app.use((req, res, next) => {
    // Các đường dẫn cần bỏ qua kiểm tra CSRF (Nhận callback từ đối tác nạp thẻ / API load dữ liệu nền)
    const webhookRoutes = ['/api/recharge/callback', '/api/payment/webhook', '/api/public/recent-logs']; 
    if (webhookRoutes.includes(req.path)) {
        return next(); 
    }
    csrfProtection(req, res, next);
});

// Chuyển mã Token ra toàn bộ các trang giao diện (EJS)
app.use((req, res, next) => {
    if (req.csrfToken) {
        res.locals.csrfToken = req.csrfToken();
    }
    next();
});

// --- Global Rate Limit (Chống Spam/DDoS toàn trang) ---
const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, 
    max: 800, 
    message: "Hệ thống đang quá tải request, vui lòng thử lại sau 15 phút!",
    standardHeaders: true,
    legacyHeaders: false,
});
app.use(globalLimiter);

// --- Auth Rate Limit (Chống Brute Force mật khẩu) ---
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, 
    max: 20, 
    message: "Phát hiện đăng nhập bất thường. Vui lòng thử lại sau 15 phút!"
});
app.use('/auth', authLimiter);

app.use((req, res, next) => {
    res.locals.success_msg = req.flash('success_msg');
    res.locals.error_msg = req.flash('error_msg');
    res.locals.error = req.flash('error'); 
    res.locals.user = req.user || null;    
    next();
});

// Gắn socket.io vào app để có thể gọi ở các controller khác (Báo real-time)
app.set('socketio', io);

// ============================================================
// 5. CUSTOM MIDDLEWARE (THEME & SETTINGS)
// ============================================================
app.use(async (req, res, next) => {
    try {
        const [themeRows] = await db.query("SELECT site_value FROM settings WHERE site_key = 'current_theme'");
        const themeName = themeRows.length > 0 ? themeRows[0].site_value : 'default';
        req.theme = themeName; 
        res.locals.currentTheme = themeName;
        next();
    } catch (err) {
        req.theme = 'default';
        res.locals.currentTheme = 'default';
        next();
    }
});

app.use(siteSettingsMiddleware);

app.use((req, res, next) => {
    res.locals.originalUrl = req.originalUrl;
    res.locals.currentUrl = req.originalUrl;
    next();
});

// ============================================================
// 6. ĐỊNH TUYẾN (ROUTES) KHAI BÁO CÁC TÍNH NĂNG
// ============================================================
app.use('/', require('./routes/productRoutes'));      
app.use('/auth', require('./routes/authRoutes'));     
app.use('/user', require('./routes/userRoutes'));     
app.use('/admin', require('./routes/adminRoutes'));   
app.use('/ghep-doi', require('./routes/matchmakingRoutes'));

app.use('/api/order', require('./routes/orderRoutes'));       
app.use('/api/event', require('./routes/eventRoutes'));       
app.use('/api/recharge', require('./routes/rechargeRoutes')); 
app.use('/tin-tuc', require('./routes/blogRoutes'));

// Thêm Route cho Public API (VD: Lấy logs cho thông báo góc màn hình)
try {
    const apiRoutes = require('./routes/apiRoutes');
    app.use('/api/public', apiRoutes);
} catch (e) {
    // Bỏ qua nếu file apiRoutes chưa được tạo (Để tránh crash server)
    console.log("ℹ️ Đang chờ file apiRoutes.js được cập nhật.");
}

app.get('/robots.txt', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'robots.txt'));
});

// ============================================================
// 7. SITEMAP SEO TỰ ĐỘNG - UPDATE TOÀN BỘ CÁC TRANG MỚI
// ============================================================
app.get('/sitemap.xml', async (req, res) => {
    try {
        const [products] = await db.query("SELECT slug, created_at FROM products WHERE status = 'available'");
        const [articles] = await db.query("SELECT slug, created_at FROM articles WHERE status = 'published'");
        const [seoPages] = await db.query("SELECT slug FROM seo_pages");
        
        const domain = process.env.BASE_URL || `https://${req.get('host')}`;

        res.header('Content-Type', 'application/xml');
        let xml = `<?xml version="1.0" encoding="UTF-8"?>
        <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
            <url><loc>${domain}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>
            <url><loc>${domain}/tai-khoan</loc><changefreq>daily</changefreq><priority>1.0</priority></url>
            
            <url><loc>${domain}/cay-thue</loc><changefreq>weekly</changefreq><priority>0.9</priority></url>
            <url><loc>${domain}/thue-acc</loc><changefreq>hourly</changefreq><priority>0.9</priority></url>
            <url><loc>${domain}/gieo-que</loc><changefreq>daily</changefreq><priority>0.9</priority></url>
            <url><loc>${domain}/chung-suc</loc><changefreq>daily</changefreq><priority>0.9</priority></url>
            <url><loc>${domain}/minigame</loc><changefreq>daily</changefreq><priority>0.9</priority></url>
            
            <url><loc>${domain}/tui-mu</loc><changefreq>hourly</changefreq><priority>0.9</priority></url>
            <url><loc>${domain}/san-acc-1d</loc><changefreq>hourly</changefreq><priority>0.9</priority></url>
            <url><loc>${domain}/kho-vip</loc><changefreq>daily</changefreq><priority>0.8</priority></url>
            <url><loc>${domain}/mua-the</loc><changefreq>daily</changefreq><priority>0.8</priority></url>
            <url><loc>${domain}/check-uy-tin</loc><changefreq>daily</changefreq><priority>0.8</priority></url>
            
            <url><loc>${domain}/tin-tuc</loc><changefreq>daily</changefreq><priority>0.8</priority></url>
            <url><loc>${domain}/chinh-sach</loc><changefreq>monthly</changefreq><priority>0.7</priority></url>
            <url><loc>${domain}/huong-dan</loc><changefreq>monthly</changefreq><priority>0.7</priority></url>
            
            <url><loc>${domain}/auth/login</loc><changefreq>monthly</changefreq><priority>0.6</priority></url>
            <url><loc>${domain}/auth/register</loc><changefreq>monthly</changefreq><priority>0.6</priority></url>`;
        
        seoPages.forEach(page => {
            xml += `\n    <url><loc>${domain}/shop/${page.slug}</loc><changefreq>weekly</changefreq><priority>0.9</priority></url>`;
        });
        
        products.forEach(p => {
            xml += `\n    <url>
                <loc>${domain}/chi-tiet/${p.slug}</loc>
                <lastmod>${new Date(p.created_at).toISOString()}</lastmod>
                <changefreq>weekly</changefreq>
                <priority>0.8</priority>
            </url>`;
        });

        articles.forEach(a => {
            xml += `\n    <url>
                <loc>${domain}/tin-tuc/${a.slug}</loc>
                <lastmod>${new Date(a.created_at).toISOString()}</lastmod>
                <changefreq>weekly</changefreq>
                <priority>0.8</priority>
            </url>`;
        });
        
        xml += `\n</urlset>`;
        res.send(xml);
    } catch (err) {
        console.error("Sitemap Error:", err);
        res.status(500).end();
    }
});

// ============================================================
// 8. XỬ LÝ LỖI TOÀN CỤC (404 & 500)
// ============================================================
app.use((req, res) => {
    const theme = req.theme || 'default';
    res.status(404).render(`themes/${theme}/404`, { 
        title: "404 - Không tìm thấy trang",
        user: req.user || null 
    });
});

app.use((err, req, res, next) => {
    // Nếu lỗi do người dùng click bậy gây sai Token CSRF
    if (err.code === 'EBADCSRFTOKEN') {
        return res.status(403).json({ success: false, message: "Lỗi bảo mật Form (Hết hạn Token). Vui lòng F5 tải lại trang để thực hiện thao tác!" });
    }
    console.error("Lỗi Hệ Thống Đặc Trọng:", err.stack); 
    const theme = req.theme || 'default';
    res.status(500).render(`themes/${theme}/404`, { 
        title: "500 - Lỗi hệ thống",
        user: req.user || null 
    });
});

// ============================================================
// 9. KHỞI CHẠY SERVER & KẾT NỐI SOCKET
// ============================================================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`=============================================`);
    console.log(`🚀 SHOP GEN Z - SERVER STARTED ON VPS`);
    console.log(`👉 Homepage: http://localhost:${PORT}`);
    console.log(`🔧 Admin:    http://localhost:${PORT}/admin`);
    console.log(`🛡️  Bảo Mật CSRF & Rate Limit: ĐÃ KÍCH HOẠT`);
    console.log(`=============================================`);
});

// Lắng nghe sự kiện kết nối của Socket.io
io.on('connection', (socket) => {
    // Cho phép client tự join vào phòng cá nhân của họ (dựa trên User ID)
    socket.on('join-user-room', (userId) => {
        if(userId) {
            socket.join(`user_room_${userId}`);
            console.log(`[Socket] User ${userId} đã join vào phòng nhận thông báo.`);
        }
    });
});