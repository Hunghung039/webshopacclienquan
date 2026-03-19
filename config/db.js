// config/db.js
require('dotenv').config();
const mysql = require('mysql2');

// Tạo Connection Pool (Hồ kết nối) để chịu tải cao
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'shop_genz',
    
    // --- Cấu hình nâng cao ---
    waitForConnections: true,
    connectionLimit: 10, // Số lượng kết nối tối đa cùng lúc
    queueLimit: 0,
    enableKeepAlive: true,       // Giữ kết nối sống, tránh bị timeout
    keepAliveInitialDelay: 0,
    timezone: '+07:00'           // Chỉnh múi giờ Việt Nam cho chuẩn
});

// Xuất ra dạng Promise để dùng async/await (Code hiện đại)
const db = pool.promise();

// Test kết nối ngay khi chạy server
db.getConnection()
    .then(conn => {
        console.log("✅ [DATABASE] Kết nối MySQL thành công!");
        conn.release(); // Trả kết nối về hồ ngay sau khi test
    })
    .catch(err => {
        console.error("❌ [DATABASE] Lỗi kết nối:", err.code);
        console.error("   -> Kiểm tra lại file .env hoặc XAMPP/MySQL đã bật chưa?");
    });

module.exports = db;