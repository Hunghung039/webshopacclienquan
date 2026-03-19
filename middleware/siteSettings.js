const db = require('../config/db');

module.exports = async (req, res, next) => {
    try {
        // Lấy toàn bộ settings từ DB
        const [rows] = await db.query("SELECT * FROM settings");
        
        // Chuyển đổi từ mảng sang Object: { site_title: '...', logo: '...' }
        const settings = {};
        rows.forEach(row => {
            settings[row.site_key] = row.site_value;
        });

        // Gắn vào locals để View EJS nào cũng dùng được
        res.locals.settings = settings;
        
        // Nếu DB chưa có logo, đặt logo mặc định để không lỗi ảnh
        if (!res.locals.settings.site_logo) {
            res.locals.settings.site_logo = 'https://via.placeholder.com/150x50?text=LOGO';
        }

        next();
    } catch (err) {
        console.error("Lỗi load settings:", err);
        // Nếu lỗi DB, vẫn cho web chạy với object rỗng để không crash
        res.locals.settings = {}; 
        next();
    }
};