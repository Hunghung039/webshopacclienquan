const db = require('../../config/db');

exports.getLobby = async (req, res) => {
    try {
        await db.query("UPDATE lq_rooms SET status = 'expired' WHERE created_at < NOW() - INTERVAL 30 MINUTE AND status = 'active'");

        const [rooms] = await db.query(`
            SELECT r.*, u.username, u.reputation_score, u.is_booster 
            FROM lq_rooms r JOIN users u ON r.user_id = u.id
            WHERE r.status = 'active'
            ORDER BY CASE WHEN r.current_players >= 4 THEN 1 ELSE 2 END ASC, u.is_booster DESC, r.created_at DESC
        `);

        let unlockedIds = [];
        if (req.user) {
            const [unlocks] = await db.query("SELECT room_id FROM lq_room_unlocks WHERE user_id = ?", [req.user.id]);
            unlockedIds = unlocks.map(u => u.room_id);
        }

        res.render(`themes/${req.theme || 'default'}/matchmaking/lobby`, {
            title: 'Trạm Ghép Đội LQM - Tìm Team Auto Win',
            user: req.user,
            rooms: rooms,
            unlockedIds: unlockedIds
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Lỗi tải Sảnh Ghép Đội");
    }
};

exports.createRoom = async (req, res) => {
    try {
        const { room_code, play_mode, rank_tier, missing_roles, tags, current_players, type, price } = req.body;
        
        if (!req.user) return res.json({ success: false, message: 'Bạn chưa đăng nhập!' });
        const userId = req.user.id;
        const io = req.app.get('socketio'); 

        // 1. Kiểm tra quyền tạo phòng VIP
        if (type === 'vip' && req.user.is_booster != 1) {
            return res.json({ success: false, message: 'Chỉ có Cao Thủ (Idol) mới được tạo phòng VIP thu tiền!' });
        }

        // 2. Chống Spam: Chỉ 1 phòng 1 lúc
        const [existing] = await db.query("SELECT id FROM lq_rooms WHERE user_id = ? AND status = 'active'", [userId]);
        if (existing.length > 0) return res.json({ success: false, message: 'Sếp đang có 1 phòng chưa kết thúc. Vui lòng chờ 30p để tạo lại!' });

        // 3. Xử lý dữ liệu mảng thành chuỗi
        const missingRolesStr = Array.isArray(missing_roles) ? missing_roles.join(', ') : (missing_roles || 'Team');
        const tagsStr = Array.isArray(tags) ? tags.join(', ') : (tags || '');
        const roomPrice = type === 'vip' ? (parseInt(price) || 10000) : 0;

        // 4. Lưu vào Database
        const [result] = await db.query(
            "INSERT INTO lq_rooms (user_id, room_code, play_mode, rank_tier, missing_roles, tags, current_players, type, price) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [userId, room_code, play_mode, rank_tier || 'Tự do', missingRolesStr, tagsStr, parseInt(current_players) || 1, type || 'free', roomPrice]
        );
        
        // --- THÊM CHỦ PHÒNG VÀO DANH SÁCH THÀNH VIÊN NGAY SAU KHI TẠO PHÒNG ---
        // (Đây là logic cần thiết cho chức năng Phòng Ảo 5 người vừa được bổ sung)
        await db.query("INSERT INTO lq_room_members (room_id, user_id) VALUES (?, ?)", [result.insertId, userId]);
        // ----------------------------------------------------------------------

        // 5. Tính năng Gacha Thưởng
        let rewardMsg = "";
        const rand = Math.random();
        if (rand <= 0.3) { 
            const rewards = [10, 20, 150]; 
            const dropAmount = rewards[Math.floor(Math.random() * rewards.length)];
            
            // Fix lỗi sập Database do thiếu old_balance và new_balance
            const [userRows] = await db.query("SELECT money FROM users WHERE id = ?", [userId]);
            const oldBalance = userRows[0].money || 0;
            const newBalance = oldBalance + dropAmount;

            await db.query("UPDATE users SET money = ? WHERE id = ?", [newBalance, userId]);
            await db.query("INSERT INTO transaction_logs (user_id, type, amount, old_balance, new_balance, description) VALUES (?, 'event_reward', ?, ?, ?, ?)", 
                [userId, dropAmount, oldBalance, newBalance, 'Gacha thưởng: Tạo thẻ gọi đội']
            );
            rewardMsg = ` Nổ hũ: +${dropAmount}đ vào ví Web!`;
        }

        // 6. Phát tín hiệu Real-time cho mọi người
        const [newRooms] = await db.query(`SELECT r.*, u.username, u.reputation_score, u.is_booster FROM lq_rooms r JOIN users u ON r.user_id = u.id WHERE r.id = ?`, [result.insertId]);
        const roomData = newRooms[0];
        
        const broadcastData = { ...roomData };
        if (broadcastData.type === 'vip') broadcastData.room_code = '***'; 

        if (io) io.emit('lq_new_room', broadcastData); 

        // Trả kết quả thành công
        res.json({ success: true, message: 'Đã phát tín hiệu gọi Team!' + rewardMsg, room: roomData });

    } catch (err) {
        console.error("LỖI SQL TẠO PHÒNG:", err);
        // Trả thẳng lỗi Database ra màn hình để sếp dễ bắt bệnh
        res.json({ success: false, message: 'Lỗi Database: ' + err.message });
    }
};