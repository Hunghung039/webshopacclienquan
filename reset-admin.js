require('dotenv').config();
const db = require('./config/db');
const bcrypt = require('bcryptjs');

async function resetSystem() {
    try {
        console.log("🧹 Đang kích hoạt giao thức dọn dẹp Database...");

        // 1. Tạm tắt kiểm tra khóa ngoại để tránh lỗi khi xóa
        await db.query("SET FOREIGN_KEY_CHECKS = 0;");

        // 2. Xóa sạch mọi tài khoản cũ (Và các rác liên quan nếu muốn)
        await db.query("TRUNCATE TABLE users;"); 
        
        console.log("✅ Đã xóa trắng toàn bộ tài khoản cũ!");

        // 3. TẠO TÀI KHOẢN ADMIN MỚI BẢO MẬT CAO
        // Sếp HÃY THAY ĐỔI thông tin ở 2 dòng dưới đây trước khi chạy nhé!
        const adminUsername = 'SuperAdmin_2026'; // Đừng dùng tên 'admin' dễ bị đoán
        const adminPassword = 'MatKhauSieuKho@123'; // Đặt pass dài và khó vào

        // Băm mật khẩu ra rác để hacker có chôm được DB cũng không đọc được
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(adminPassword, salt);

        // 4. Nhồi Admin mới vào
        await db.query(
            "INSERT INTO users (username, password, role, money) VALUES (?, ?, 'admin', 999999999)", 
            [adminUsername, hashedPassword]
        );

        // Bật lại khóa ngoại
        await db.query("SET FOREIGN_KEY_CHECKS = 1;");

        console.log(`🎉 BÙM! Khởi tạo thành công.`);
        console.log(`👉 Tên đăng nhập Admin: ${adminUsername}`);
        console.log(`👉 Mật khẩu: ${adminPassword}`);
        console.log("⚠️ XONG RỒI THÌ XÓA FILE NÀY ĐI NHÉ SẾP!");
        
        process.exit(0);
    } catch (err) {
        console.error("❌ Lỗi:", err);
        process.exit(1);
    }
}

resetSystem();