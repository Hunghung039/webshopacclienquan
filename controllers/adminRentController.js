const db = require('../config/db');

exports.getManager = async (req, res) => {
    try {
        const [accounts] = await db.query("SELECT * FROM rent_accounts ORDER BY id DESC");
        const [orders] = await db.query(`
            SELECT r.*, a.title, u.username 
            FROM rent_orders r 
            JOIN rent_accounts a ON r.account_id = a.id 
            JOIN users u ON r.user_id = u.id 
            ORDER BY r.created_at DESC LIMIT 100
        `);
        // Lấy thông tin 2 gói thuê
        const [packages] = await db.query("SELECT * FROM rent_settings ORDER BY id ASC");

        res.render('admin/rent_manager', {
            layout: 'admin', page: 'rent_manager',
            accounts, orders, packages, user: req.user
        });
    } catch (err) { res.status(500).send("Lỗi trang"); }
};

// Cập nhật giá và giờ của các gói thuê
exports.updatePackages = async (req, res) => {
    const { package_id, hours, price } = req.body;
    try {
        const conn = await db.getConnection();
        await conn.beginTransaction();
        for (let i = 0; i < package_id.length; i++) {
            await conn.query("UPDATE rent_settings SET hours = ?, price = ? WHERE id = ?", [hours[i], price[i], package_id[i]]);
        }
        await conn.commit();
        conn.release();
        res.redirect('/admin/thue-acc?msg=Đã lưu cấu hình gói thuê!');
    } catch (err) { res.redirect('/admin/thue-acc?msg=Lỗi cập nhật gói!'); }
};

// Đăng acc (Đã bỏ rank và giá riêng)
exports.addAccount = async (req, res) => {
    const { title, skins, images, note } = req.body;
    try {
        await db.query(
            "INSERT INTO rent_accounts (title, rank_tier, skins, price_per_hour, images, note) VALUES (?, 'N/A', ?, 0, ?, ?)",
            [title, skins, images, note]
        );
        res.redirect('/admin/thue-acc?msg=Thêm Acc cho thuê thành công!');
    } catch (err) { res.redirect('/admin/thue-acc?msg=Lỗi thêm acc'); }
};

exports.deleteAccount = async (req, res) => {
    try {
        await db.query("DELETE FROM rent_accounts WHERE id = ?", [req.params.id]);
        res.redirect('/admin/thue-acc?msg=Đã xóa Acc!');
    } catch (err) { res.redirect('/admin/thue-acc?msg=Lỗi xóa acc'); }
};

exports.forceUnlock = async (req, res) => {
    try {
        await db.query("UPDATE rent_accounts SET status = 'available', available_at = NULL WHERE id = ?", [req.body.id]);
        res.redirect('/admin/thue-acc?msg=Đã thu hồi acc thành công!');
    } catch (err) { res.redirect('/admin/thue-acc?msg=Lỗi thu hồi'); }
};
// Thêm hàm Xóa Lịch Sử Thuê Acc
exports.deleteRentOrder = async (req, res) => {
    try {
        const orderId = req.params.id;
        await db.query("DELETE FROM rent_orders WHERE id = ?", [orderId]);
        res.redirect('/admin/thue-acc?msg=Đã xóa lịch sử thuê thành công!');
    } catch (err) {
        console.error("Lỗi xóa lịch sử thuê:", err);
        res.redirect('/admin/thue-acc?msg=Lỗi hệ thống khi xóa lịch sử!');
    }
};