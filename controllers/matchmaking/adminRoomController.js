const db = require('../../config/db');

exports.getManager = async (req, res) => {
    try {
        // 1. Lấy danh sách 100 phòng gần nhất
        const [rooms] = await db.query(`
            SELECT r.*, u.username 
            FROM lq_rooms r JOIN users u ON r.user_id = u.id 
            ORDER BY r.created_at DESC LIMIT 100
        `);
        
        // 2. Lấy Bảng xếp hạng Idol / Thợ kéo (Ưu tiên điểm Vote cao nhất lên đầu)
        const [boosters] = await db.query(`
            SELECT id, username, reputation_score, is_booster 
            FROM users 
            WHERE is_booster = 1 OR reputation_score > 0 
            ORDER BY reputation_score DESC LIMIT 50
        `);

        // 3. Lấy Lịch sử giao dịch Thuê phòng VIP (MỚI)
        const [history] = await db.query(`
            SELECT un.price_paid, un.created_at, 
                   payer.username AS payer_name, 
                   host.username AS host_name,
                   r.room_code
            FROM lq_room_unlocks un
            JOIN users payer ON un.user_id = payer.id
            JOIN users host ON un.booster_id = host.id
            LEFT JOIN lq_rooms r ON un.room_id = r.id
            ORDER BY un.created_at DESC LIMIT 50
        `);

        res.render('admin/matchmaking/manager', {
            layout: 'admin',
            page: 'matchmaking',
            user: req.user,
            rooms: rooms,
            boosters: boosters,
            history: history // Truyền lịch sử ra giao diện
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Lỗi tải trang Quản lý Ghép Đội");
    }
};

exports.deleteRoom = async (req, res) => {
    try {
        await db.query("DELETE FROM lq_rooms WHERE id = ?", [req.params.id]);
        res.redirect('/admin/matchmaking?msg=Đã xóa phòng thành công!');
    } catch (err) {
        res.redirect('/admin/matchmaking?msg=Lỗi xóa phòng!');
    }
};

exports.toggleBooster = async (req, res) => {
    try {
        const { target_id, action } = req.body;
        const newStatus = action === 'promote' ? 1 : 0;
        await db.query("UPDATE users SET is_booster = ? WHERE id = ?", [newStatus, target_id]);
        res.redirect('/admin/matchmaking?msg=Cập nhật quyền thành công!');
    } catch (err) {
        res.redirect('/admin/matchmaking?msg=Lỗi cập nhật quyền!');
    }
};

// Hàm mới: Cấp quyền VIP thủ công bằng nhập ID
exports.manualGrantBooster = async (req, res) => {
    try {
        const { user_id } = req.body;
        // Kiểm tra xem User có tồn tại không
        const [user] = await db.query("SELECT id FROM users WHERE id = ?", [user_id]);
        
        if (user.length === 0) {
            return res.redirect('/admin/matchmaking?msg=Lỗi: Không tìm thấy User ID này!');
        }

        // Ép lên làm Idol
        await db.query("UPDATE users SET is_booster = 1 WHERE id = ?", [user_id]);
        res.redirect('/admin/matchmaking?msg=Đã cấp quyền Idol thành công cho ID: ' + user_id);
    } catch (err) {
        console.error(err);
        res.redirect('/admin/matchmaking?msg=Lỗi hệ thống khi cấp quyền!');
    }
};