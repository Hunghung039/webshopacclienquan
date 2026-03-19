const db = require('../config/db');

// Hàm tính thời gian trôi qua (VD: "5 phút trước", "Vài giây trước")
function timeSince(date) {
    const seconds = Math.floor((new Date() - date) / 1000);
    
    let interval = seconds / 86400;
    if (interval > 1) return Math.floor(interval) + " ngày trước";
    
    interval = seconds / 3600;
    if (interval > 1) return Math.floor(interval) + " giờ trước";
    
    interval = seconds / 60;
    if (interval > 1) return Math.floor(interval) + " phút trước";
    
    return "Vài giây trước";
}

exports.getRecentPublicLogs = async (req, res) => {
    try {
        // Lấy 20 hoạt động mới nhất (Bỏ qua giao dịch của Admin để tránh lộ thông tin nội bộ)
        // Gộp bảng transaction_logs (mua hàng, nạp tiền) và bảng users (đăng ký mới)
        const query = `
            (
                SELECT 
                    u.username, 
                    t.description AS action_text, 
                    t.created_at
                FROM transaction_logs t
                JOIN users u ON t.user_id = u.id
                WHERE u.role != 'admin' AND t.type NOT IN ('admin_add', 'admin_adjust')
            )
            UNION ALL
            (
                SELECT 
                    username, 
                    'đăng ký tài khoản thành công' AS action_text, 
                    created_at
                FROM users
                WHERE role != 'admin'
            )
            ORDER BY created_at DESC
            LIMIT 20
        `;

        const [results] = await db.query(query);

        // Format lại dữ liệu trước khi gửi cho Frontend
        const formattedLogs = results.map(row => {
            // Chuyển chữ cái đầu của hành động thành chữ thường cho nối câu tự nhiên
            // VD: "Mua nick #12" -> "vừa mua nick #12"
            let rawText = row.action_text || '';
            let actionText = "vừa " + rawText.charAt(0).toLowerCase() + rawText.slice(1);

            return {
                user: row.username,
                action: actionText,
                time: timeSince(new Date(row.created_at))
            };
        });

        return res.json({
            success: true,
            logs: formattedLogs
        });

    } catch (error) {
        console.error("Lỗi lấy Public Logs:", error);
        return res.json({ success: false, logs: [] });
    }
};