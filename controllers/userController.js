// controllers/userController.js
const db = require('../config/db');
const cryptoHelper = require('../utils/cryptoHelper');

exports.getProfile = async (req, res) => {
    try {
        const theme = req.theme || 'default';
        const userId = req.user.id;

        // 1. Lấy thông tin User mới nhất
        const [users] = await db.query("SELECT * FROM users WHERE id = ?", [userId]);
        const user = users[0];

        // 2. Lịch sử Mua Acc (Join với bảng products để lấy ảnh và tên acc)
        const [accOrders] = await db.query(`
            SELECT p.title, p.image_url, p.acc_username, p.acc_password, p.price_new, o.created_at, o.id as order_id
            FROM acc_orders o 
            JOIN products p ON o.product_id = p.id 
            WHERE o.user_id = ? 
            ORDER BY o.created_at DESC`, [userId]);

        // GIẢI MÃ MẬT KHẨU ACC CHO KHÁCH XEM
        accOrders.forEach(order => {
            if (order.acc_password) {
                try {
                    order.acc_password = cryptoHelper.decrypt(order.acc_password);
                } catch (error) {
                    // Giữ nguyên nếu là acc cũ chưa mã hóa
                }
            }
        });

        // 3. Lịch sử Sự kiện (Chung sức/Hảo vận cũ)
        const [eventOrders] = await db.query(`
            SELECT * FROM event_orders 
            WHERE user_id = ? 
            ORDER BY created_at DESC`, [userId]);

        // 4. Lịch sử Nạp thẻ
        const [cardHistory] = await db.query(`
            SELECT * FROM card_requests 
            WHERE user_id = ? 
            ORDER BY created_at DESC LIMIT 20`, [userId]);

        // 5. Biến động số dư (Dòng tiền)
        const [transactions] = await db.query(`
            SELECT * FROM transaction_logs 
            WHERE user_id = ? 
            ORDER BY created_at DESC LIMIT 50`, [userId]);

        // ==========================================
        // 6. [TÍNH NĂNG MỚI]: LẤY LỊCH SỬ HOẠT ĐỘNG TỔNG HỢP
        // ==========================================
        const [activityLogs] = await db.query(`
            SELECT * FROM user_activity_logs 
            WHERE user_id = ? 
            ORDER BY created_at DESC LIMIT 100`, [userId]);

        // 7. Tính cấp độ VIP (100k = 1 cấp)
        let vipLevel = 0; 
        if(user.money > 100000) vipLevel = 1;
        if(user.money > 500000) vipLevel = 2;
        if(user.money > 2000000) vipLevel = 3;

        res.render(`themes/${theme}/profile`, {
            title: `Hồ sơ cá nhân - ${user.username}`,
            user: user,
            accOrders: accOrders,
            eventOrders: eventOrders,
            cardHistory: cardHistory,
            transactions: transactions,
            activityLogs: activityLogs, // Ném data lịch sử mới ra ngoài view
            vipLevel: vipLevel
        });

    } catch (err) {
        console.error("Lỗi tải trang cá nhân:", err);
        res.status(500).send("Lỗi máy chủ");
    }
};