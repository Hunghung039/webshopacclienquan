const db = require('../../config/db');

exports.unlockRoom = async (req, res) => {
    const { room_id } = req.body;
    const userId = req.user.id;
    const io = req.app.get('socketio');

    const conn = await db.getConnection();
    await conn.beginTransaction();

    try {
        const [rooms] = await conn.query("SELECT * FROM lq_rooms WHERE id = ? FOR UPDATE", [room_id]);
        if (rooms.length === 0) throw new Error("Phòng không tồn tại!");
        const room = rooms[0];

        if (room.status !== 'active' || room.current_players >= 5) throw new Error("Phòng này đã đầy hoặc bị hủy!");
        if (room.type !== 'vip') throw new Error("Đây là phòng miễn phí, cứ copy ID chơi thôi!");
        if (room.user_id === userId) throw new Error("Sếp không thể tự mua phòng của chính mình!");

        const [check] = await conn.query("SELECT id FROM lq_room_unlocks WHERE room_id = ? AND user_id = ?", [room_id, userId]);
        if (check.length > 0) return res.json({ success: true, room_code: room.room_code });

        // TÍNH TOÁN & GHI LOG TIỀN CHUẨN XÁC
        const [payerRows] = await conn.query("SELECT money FROM users WHERE id = ? FOR UPDATE", [userId]);
        const payerOldBalance = payerRows[0].money;
        if (payerOldBalance < room.price) throw new Error("Tài khoản không đủ tiền. Vui lòng nạp thêm!");

        const payerNewBalance = payerOldBalance - room.price;
        const boosterMoney = Math.floor(room.price * 0.7); // 70%

        const [boosterRows] = await conn.query("SELECT money FROM users WHERE id = ? FOR UPDATE", [room.user_id]);
        const boosterOldBalance = boosterRows[0].money;
        const boosterNewBalance = boosterOldBalance + boosterMoney;

        // Trừ tiền khách - Cộng tiền Thợ kéo
        await conn.query("UPDATE users SET money = ? WHERE id = ?", [payerNewBalance, userId]);
        await conn.query("UPDATE users SET money = ? WHERE id = ?", [boosterNewBalance, room.user_id]);

        await conn.query("INSERT INTO transaction_logs (user_id, type, amount, old_balance, new_balance, description) VALUES (?, 'pay_room', ?, ?, ?, ?)", [userId, -room.price, payerOldBalance, payerNewBalance, `Thuê Cao thủ (Phòng #${room.id})`]);
        await conn.query("INSERT INTO transaction_logs (user_id, type, amount, old_balance, new_balance, description) VALUES (?, 'earn_room', ?, ?, ?, ?)", [room.user_id, boosterMoney, boosterOldBalance, boosterNewBalance, `Hoa hồng kéo rank (70% từ Phòng #${room.id})`]);

        await conn.query("INSERT INTO lq_room_unlocks (room_id, user_id, booster_id, price_paid) VALUES (?, ?, ?, ?)", [room.id, userId, room.user_id, room.price]);
        
        const newPlayers = room.current_players + 1;
        const newStatus = newPlayers >= 5 ? 'full' : 'active';
        await conn.query("UPDATE lq_rooms SET current_players = ?, status = ? WHERE id = ?", [newPlayers, newStatus, room.id]);

        await conn.commit();

        if (io) io.emit('lq_update_room', { id: room.id, current_players: newPlayers, status: newStatus });

        res.json({ success: true, room_code: room.room_code, message: "Mở khóa thành công! Copy mã và vào game ngay." });

    } catch (err) {
        await conn.rollback();
        res.json({ success: false, message: err.message });
    } finally {
        conn.release();
    }
};