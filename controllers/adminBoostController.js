const db = require('../config/db');

exports.getManager = async (req, res) => {
    try {
        const [orders] = await db.query("SELECT b.*, u.username as client_name FROM boost_orders b JOIN users u ON b.user_id = u.id ORDER BY b.created_at DESC");
        // Lấy cấu hình bảng giá đưa lên Admin cho sếp sửa
        const [settings] = await db.query("SELECT * FROM boost_settings ORDER BY id ASC");

        res.render('admin/boost_manager', {
            layout: 'admin', page: 'boost_manager',
            orders: orders, settings: settings, user: req.user
        });
    } catch (err) { res.status(500).send("Lỗi tải trang"); }
};

// Hàm lưu cài đặt Bảng Giá và Ảnh do sếp tự chỉnh
exports.updateSettings = async (req, res) => {
    const { tier_keys, prices, images } = req.body;
    try {
        const conn = await db.getConnection();
        await conn.beginTransaction();
        
        for (let i = 0; i < tier_keys.length; i++) {
            await conn.query(
                "UPDATE boost_settings SET price_per_star = ?, image_url = ? WHERE tier_key = ?",
                [parseInt(prices[i]) || 0, images[i], tier_keys[i]]
            );
        }
        
        await conn.commit();
        conn.release();
        res.redirect('/admin/cay-thue?msg=Đã cập nhật Bảng Giá & Hình Ảnh thành công!');
    } catch (err) {
        res.redirect('/admin/cay-thue?msg=Lỗi hệ thống khi cập nhật bảng giá!');
    }
};

// ... Hàm updateOrder (Hủy/Cày) giữ nguyên như cũ ...
exports.updateOrder = async (req, res) => {
    const { order_id, status, hero_used, proof_images } = req.body;
    const conn = await db.getConnection();
    await conn.beginTransaction();

    try {
        const [orders] = await conn.query("SELECT * FROM boost_orders WHERE id = ? FOR UPDATE", [order_id]);
        if (orders.length === 0) throw new Error("Không tìm thấy đơn");
        const order = orders[0];

        // LOGIC HOÀN TIỀN
        if (status === 'cancelled' && order.status !== 'cancelled') {
            await conn.query("UPDATE users SET money = money + ? WHERE id = ?", [order.price, order.user_id]);
            const [users] = await conn.query("SELECT money FROM users WHERE id = ?", [order.user_id]);
            await conn.query(
                "INSERT INTO transaction_logs (user_id, type, amount, old_balance, new_balance, description) VALUES (?, 'refund', ?, ?, ?, ?)",
                [order.user_id, order.price, users[0].money - order.price, users[0].money, `Hoàn tiền: Hủy đơn Cày Thuê (Đơn #${order.id})`]
            );
        }

        if (order.status === 'cancelled' && status !== 'cancelled') {
             await conn.query("UPDATE users SET money = money - ? WHERE id = ?", [order.price, order.user_id]);
        }

        // Cập nhật trạng thái, Tướng và Ảnh Bằng Chứng
        await conn.query(
            "UPDATE boost_orders SET status = ?, hero_used = ?, proof_images = ? WHERE id = ?", 
            [status, hero_used, proof_images || '', order_id]
        );
        
        await conn.commit();
        res.redirect('/admin/cay-thue?msg=Cập nhật đơn và ảnh thành công!');
    } catch (err) {
        await conn.rollback();
        console.error(err);
        res.redirect('/admin/cay-thue?msg=Lỗi cập nhật trạng thái!');
    } finally {
        conn.release();
    }
};
// 3. Xóa vĩnh viễn đơn cày thuê (Dọn rác)
exports.deleteOrder = async (req, res) => {
    const { order_id } = req.body;
    try {
        await db.query("DELETE FROM boost_orders WHERE id = ?", [order_id]);
        res.redirect('/admin/cay-thue?msg=Đã xóa đơn cày thuê thành công!');
    } catch (err) {
        console.error("Lỗi xóa đơn cày thuê:", err);
        res.redirect('/admin/cay-thue?msg=Lỗi hệ thống khi xóa đơn!');
    }
};