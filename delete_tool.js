require('dotenv').config();
const db = require('./config/db');

async function runDeleteAll() {
    try {
        console.log("🔥 BẮT ĐẦU CHIẾN DỊCH DỌN DẸP SẠCH SẼ TÀI KHOẢN CỦA TOOL...");

        // 1. Quét tìm toàn bộ ID của các Acc do Tool tạo ra (Kể cả đã bán hay chưa)
        console.log("⏳ Đang dò tìm mục tiêu (acc_username = 'LHadmin')...");
        const [targetAccounts] = await db.query("SELECT id FROM products WHERE acc_username = 'LHadmin'");

        if (targetAccounts.length === 0) {
            console.log("✅ Hệ thống đã sạch bóng! Không còn tài khoản nào của Tool.");
            process.exit(0);
        }

        // Tách lấy danh sách các ID
        const accountIds = targetAccounts.map(acc => acc.id);
        console.log(`🎯 Phát hiện ${accountIds.length} tài khoản cần tiêu diệt.`);

        // 2. XÓA LỊCH SỬ ĐƠN HÀNG TRƯỚC (Rất quan trọng: Để tránh lỗi dính khóa dữ liệu)
        console.log("🧹 Đang dọn dẹp lịch sử hóa đơn của các Acc đã bán...");
        const [deleteOrders] = await db.query(
            "DELETE FROM acc_orders WHERE product_id IN (?)",
            [accountIds]
        );
        console.log(`✅ Đã xóa ${deleteOrders.affectedRows} biên lai lịch sử bị dính líu.`);

        // 3. XÓA TẬN GỐC ACC TRONG KHO
        console.log("💥 Đang nổ mìn xóa sạch kho Acc...");
        const [deleteProducts] = await db.query("DELETE FROM products WHERE acc_username = 'LHadmin'");

        console.log(`🎉 HOÀN TẤT TUYỆT ĐỐI! Đã bốc hơi ${deleteProducts.affectedRows} tài khoản ra khỏi hệ thống!`);
        process.exit(0);

    } catch (error) {
        console.error("❌ BÁO ĐỘNG LỖI:", error);
        process.exit(1);
    }
}

// Kích hoạt
runDeleteAll();