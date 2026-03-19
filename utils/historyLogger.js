// utils/historyLogger.js
const db = require('../config/db');

/**
 * Hàm ghi lại toàn bộ lịch sử hoạt động của khách hàng
 * @param {Number} userId - ID của khách hàng
 * @param {String} module - Nhóm dịch vụ (XIN_XAM, TUI_MU, MUA_ACC, MUA_THE...)
 * @param {String} actionName - Tên hành động cụ thể
 * @param {Number} priceSpent - Số tiền khách bỏ ra
 * @param {String} rewardResult - Phần thưởng/Mã code khách nhận được
 * @param {Object} connection - (Tùy chọn) Truyền connection vào nếu đang dùng Transaction (beginTransaction)
 */
exports.logUserHistory = async (userId, module, actionName, priceSpent, rewardResult, connection = null) => {
    try {
        const query = `
            INSERT INTO user_activity_logs (user_id, module, action_name, price_spent, reward_result) 
            VALUES (?, ?, ?, ?, ?)
        `;
        const params = [userId, module, actionName, priceSpent, rewardResult];
        
        // Nếu Controller đang dùng Transaction bảo mật, bắt buộc phải dùng connection đó để đồng bộ
        if (connection) {
            await connection.query(query, params);
        } else {
            await db.query(query, params);
        }
    } catch (error) {
        console.error(`[LỖI GHI LỊCH SỬ] Module ${module}:`, error);
    }
};