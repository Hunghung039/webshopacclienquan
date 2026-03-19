const db = require('../../config/db');

// 1. NGƯỜI CHƠI XIN VÀO PHÒNG
exports.joinRoom = async (req, res) => {
    const { room_id } = req.body;
    const userId = req.user.id;
    const io = req.app.get('socketio');

    const conn = await db.getConnection();
    await conn.beginTransaction();

    try {
        // Khóa dòng row để tránh 2 người cùng click 1 lúc làm lố số lượng
        const [rooms] = await conn.query("SELECT * FROM lq_rooms WHERE id = ? FOR UPDATE", [room_id]);
        if (rooms.length === 0) throw new Error("Phòng không tồn tại hoặc đã bị xóa!");
        const room = rooms[0];

        if (room.status === 'reported') throw new Error("Phòng này đã bị báo cáo là phòng ảo!");
        if (room.status === 'full' || room.current_players >= 5) throw new Error("Phòng đã đủ 5 người, vui lòng chọn phòng khác!");

        // Kiểm tra xem đã trong phòng chưa
        const [check] = await conn.query("SELECT id FROM lq_room_members WHERE room_id = ? AND user_id = ?", [room_id, userId]);
        
        let newPlayersCount = room.current_players;

        // Nếu chưa có thì thêm vào
        if (check.length === 0) {
            await conn.query("INSERT INTO lq_room_members (room_id, user_id) VALUES (?, ?)", [room_id, userId]);
            newPlayersCount += 1;
            
            // Nếu đủ 5 người -> Khóa phòng
            const newStatus = newPlayersCount >= 5 ? 'full' : 'active';
            await conn.query("UPDATE lq_rooms SET current_players = ?, status = ? WHERE id = ?", [newPlayersCount, newStatus, room_id]);
        }

        // Lấy danh sách thành viên hiện tại để trả về Frontend vẽ 5 ô
        const [members] = await conn.query(`
            SELECT u.id, u.username, u.is_booster 
            FROM lq_room_members rm JOIN users u ON rm.user_id = u.id 
            WHERE rm.room_id = ? ORDER BY rm.joined_at ASC
        `, [room_id]);

        await conn.commit();

        // Bắn tín hiệu chốt cửa hoặc nhảy số cho những người đang ở Sảnh
        if (io) io.emit('lq_update_room', { id: room.id, current_players: newPlayersCount, status: newPlayersCount >= 5 ? 'full' : 'active' });
        
        // Bắn tín hiệu cho những người ĐANG Ở TRONG PHÒNG CÙNG NHAU
        if (io) io.to(`lq_room_${room_id}`).emit('lq_room_member_joined', { members, room_code: room.room_code });

        res.json({ success: true, room_code: room.room_code, members: members });

    } catch (err) {
        await conn.rollback();
        res.json({ success: false, message: err.message });
    } finally {
        conn.release();
    }
};

// 2. NGƯỜI CHƠI THOÁT PHÒNG
exports.leaveRoom = async (req, res) => {
    const { room_id } = req.body;
    const userId = req.user.id;
    const io = req.app.get('socketio');

    try {
        const [room] = await db.query("SELECT * FROM lq_rooms WHERE id = ?", [room_id]);
        if(room.length === 0) return res.json({success: true});

        // Xóa khỏi danh sách thành viên
        await db.query("DELETE FROM lq_room_members WHERE room_id = ? AND user_id = ?", [room_id, userId]);

        // Cập nhật lại số lượng và mở lại phòng (chuyển full -> active)
        const [membersLeft] = await db.query("SELECT COUNT(*) as count FROM lq_room_members WHERE room_id = ?", [room_id]);
        const currentCount = membersLeft[0].count;
        
        // Nếu chủ phòng thoát (hoặc phòng trống) -> Hủy luôn phòng
        if (currentCount === 0 || room[0].user_id === userId) {
            await db.query("UPDATE lq_rooms SET status = 'expired' WHERE id = ?", [room_id]);
            if(io) io.emit('lq_update_room', { id: room_id, status: 'expired' });
        } else {
            await db.query("UPDATE lq_rooms SET current_players = ?, status = 'active' WHERE id = ?", [currentCount, room_id]);
            if(io) io.emit('lq_update_room', { id: room_id, current_players: currentCount, status: 'active' });
            
            // Báo cho ae trong phòng có người out
            const [updatedMembers] = await db.query(`SELECT u.id, u.username, u.is_booster FROM lq_room_members rm JOIN users u ON rm.user_id = u.id WHERE rm.room_id = ?`, [room_id]);
            if(io) io.to(`lq_room_${room_id}`).emit('lq_room_member_joined', { members: updatedMembers });
        }

        res.json({ success: true });
    } catch (err) {
        res.json({ success: false });
    }
};

// 3. BÁO CÁO PHÒNG ẢO
exports.reportRoom = async (req, res) => {
    const { room_id } = req.body;
    const io = req.app.get('socketio');

    try {
        // Đổi trạng thái thành báo cáo, không ai vào được nữa
        await db.query("UPDATE lq_rooms SET status = 'reported' WHERE id = ?", [room_id]);
        
        // Xóa thẻ khỏi màn hình Lobby của tất cả mọi người
        if (io) io.emit('lq_update_room', { id: room_id, status: 'reported' });

        res.json({ success: true, message: "Cảm ơn bạn! Phòng này đã bị khóa và ẩn khỏi hệ thống." });
    } catch (err) {
        res.json({ success: false, message: "Lỗi hệ thống!" });
    }
};