const db = require('../config/db');

// ==========================================
// 1. RENDER TRANG QUẢN LÝ TỔNG
// ==========================================
exports.getManager = async (req, res) => {
    try {
        const [events] = await db.query("SELECT * FROM chungsuc_events ORDER BY id DESC");
        
        const [codes] = await db.query(`
            SELECT c.*, e.name as event_name 
            FROM chungsuc_codes c JOIN chungsuc_events e ON c.event_id = e.id
            WHERE c.status IN (0, 1) ORDER BY c.status DESC, c.created_at DESC
        `);

        const [histories] = await db.query(`
            SELECT c.id, c.code, c.card_image, c.claimed_at, u.username as winner_name, e.name as event_name 
            FROM chungsuc_codes c 
            JOIN users u ON c.winner_id = u.id 
            JOIN chungsuc_events e ON c.event_id = e.id
            WHERE c.status = 2 ORDER BY c.claimed_at DESC LIMIT 500
        `);
        
        const [stats] = await db.query("SELECT COUNT(*) as total, SUM(CASE WHEN status = 0 THEN 1 ELSE 0 END) as available, SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END) as pending, SUM(CASE WHEN status = 2 THEN 1 ELSE 0 END) as claimed FROM chungsuc_codes");

        res.render('admin/chungsuc_manager', {
            layout: 'admin',
            page: 'chungsuc',
            events: events, 
            codes: codes,
            histories: histories,
            stats: stats[0] || { total: 0, available: 0, pending: 0, claimed: 0 },
            user: req.user
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Lỗi tải trang quản lý");
    }
};

// ==========================================
// 2. TẠO SỰ KIỆN MỚI
// ==========================================
exports.addEvent = async (req, res) => {
    try {
        // Thêm vip_code vào danh sách lấy từ form
        const { name, slug, banner_image, card_back_image, rare_image, vip_code, trash_images, pity_threshold, prices } = req.body;
        await db.query(
            "INSERT INTO chungsuc_events (name, slug, banner_image, card_back_image, rare_image, vip_code, trash_images, pity_threshold, prices) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [name, slug, banner_image, card_back_image, rare_image, vip_code, trash_images || '', pity_threshold || 10, prices || 10000]
        );
        res.redirect('/admin/chung-suc?msg=' + encodeURIComponent('Đã đẻ thêm 1 vũ trụ Gacha thành công!') + '&type=success');
    } catch (err) {
        console.error(err);
        res.redirect('/admin/chung-suc?msg=' + encodeURIComponent(`Lỗi tạo game: ${err.message}`) + '&type=error');
    }
};

// ==========================================
// 3. FIX LỖI: NẠP MÃ VÀO SỰ KIỆN CHỈ ĐỊNH (CHỐNG TRÙNG LẶP THÔNG MINH)
// ==========================================
exports.addCodes = async (req, res) => {
    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
        const { event_id, codes_list } = req.body; 
        
        // Cắt chuỗi, lọc khoảng trắng, và loại bỏ dòng trống
        const codeArray = codes_list.split(/\r?\n/).map(c => c.trim()).filter(c => c !== '');
        
        if(codeArray.length === 0) throw new Error("Vui lòng nhập ít nhất 1 mã code!");

        // Lấy ảnh hiếm của đúng sự kiện đó ra
        const [events] = await connection.query("SELECT rare_image FROM chungsuc_events WHERE id = ?", [event_id]);
        if(events.length === 0) throw new Error("Sự kiện không tồn tại!");
        
        const rareImg = events[0].rare_image; 
        let successCount = 0;
        let dupCount = 0;

        // Chạy vòng lặp nhồi code - DÙNG IGNORE ĐỂ BỎ QUA CODE TRÙNG, KHÔNG LÀM VĂNG APP
        for(let code of codeArray) {
            try {
                const [result] = await connection.query(
                    "INSERT IGNORE INTO chungsuc_codes (event_id, code, card_image, status) VALUES (?, ?, ?, 0)", 
                    [event_id, code, rareImg]
                );
                
                // Nếu Insert Ignore bị trùng, affectedRows sẽ trả về 0
                if (result.affectedRows > 0) {
                    successCount++;
                } else {
                    dupCount++;
                }
            } catch (insertErr) {
                console.error("Lỗi dòng mã:", code, insertErr);
            }
        }
        
        await connection.commit();
        
        let finalMsg = `Đã nạp thành công ${successCount} mã VIP!`;
        if (dupCount > 0) finalMsg += ` (Bỏ qua ${dupCount} mã bị trùng)`;

        res.redirect('/admin/chung-suc?msg=' + encodeURIComponent(finalMsg) + '&type=success');

    } catch (err) {
        await connection.rollback();
        console.error("Lỗi nạp mã:", err);
        res.redirect('/admin/chung-suc?msg=' + encodeURIComponent(`Lỗi: ${err.message}`) + '&type=error');
    } finally {
        connection.release();
    }
};

// ==========================================
// 4. XÓA MỘT MÃ
// ==========================================
exports.deleteCode = async (req, res) => {
    try {
        const [check] = await db.query("SELECT status FROM chungsuc_codes WHERE id = ?", [req.params.id]);
        if (check[0] && check[0].status === 1) return res.redirect('/admin/chung-suc?msg=' + encodeURIComponent('Mã đang khóa 20s!') + '&type=error');
        
        await db.query("DELETE FROM chungsuc_codes WHERE id = ?", [req.params.id]);
        res.redirect('/admin/chung-suc?msg=' + encodeURIComponent('Đã xóa mã!') + '&type=success');
    } catch (err) {
        console.error(err);
        res.redirect('/admin/chung-suc?msg=' + encodeURIComponent('Lỗi xóa mã') + '&type=error');
    }
};

// ==========================================
// 5. DỌN DẸP MÃ RÁC
// ==========================================
exports.deleteAllCodes = async (req, res) => {
    try {
        const [result] = await db.query("DELETE FROM chungsuc_codes WHERE status != 1");
        res.redirect('/admin/chung-suc?msg=' + encodeURIComponent(`Đã dọn dẹp ${result.affectedRows} mã!`) + '&type=success');
    } catch (err) {
        console.error(err);
        res.redirect('/admin/chung-suc?msg=' + encodeURIComponent('Lỗi dọn dẹp!') + '&type=error');
    }
};

// ==========================================
// 6. RENDER TRANG CHỈNH SỬA SỰ KIỆN
// ==========================================
exports.editEventPage = async (req, res) => {
    try {
        const [events] = await db.query("SELECT * FROM chungsuc_events WHERE id = ?", [req.params.id]);
        if (events.length === 0) return res.redirect('/admin/chung-suc?msg=' + encodeURIComponent('Không tìm thấy sự kiện') + '&type=error');
        
        res.render('admin/chungsuc_event_edit', {
            layout: 'admin',
            page: 'chungsuc',
            event: events[0],
            user: req.user
        });
    } catch (err) {
        console.error(err);
        res.redirect('/admin/chung-suc?msg=' + encodeURIComponent('Lỗi hệ thống') + '&type=error');
    }
};

// ==========================================
// 7. LƯU CẬP NHẬT SỰ KIỆN 
// ==========================================
exports.updateEvent = async (req, res) => {
    try {
        const { name, slug, pity_threshold, prices, vip_code, old_banner_image, old_card_back_image, old_rare_image, old_trash_images } = req.body;
        const is_active = req.body.is_active === 'on' ? 1 : 0;
        
        const banner_image = req.files && req.files['banner_file'] ? req.files['banner_file'][0].filename : old_banner_image;
        const card_back_image = req.files && req.files['back_file'] ? req.files['back_file'][0].filename : old_card_back_image;
        const rare_image = req.files && req.files['rare_file'] ? req.files['rare_file'][0].filename : old_rare_image;

        let finalTrashArray = old_trash_images ? old_trash_images.split(',').filter(x => x.trim() !== '') : [];
        if (req.files && req.files['trash_files']) {
            req.files['trash_files'].forEach(file => finalTrashArray.push(file.filename));
        }
        const trash_images = finalTrashArray.join(',');

        await db.query(
            "UPDATE chungsuc_events SET name=?, slug=?, banner_image=?, card_back_image=?, rare_image=?, vip_code=?, trash_images=?, pity_threshold=?, prices=?, is_active=? WHERE id=?",
            [name, slug, banner_image, card_back_image, rare_image, vip_code, trash_images, pity_threshold, prices, is_active, req.params.id]
        );
        
        res.redirect('/admin/chung-suc?msg=' + encodeURIComponent('Đã cập nhật sự kiện thành công!') + '&type=success');
    } catch (err) {
        console.error("Lỗi cập nhật sự kiện:", err);
        res.redirect('/admin/chung-suc?msg=' + encodeURIComponent(`Lỗi cập nhật: ${err.message}`) + '&type=error');
    }
};

// ==========================================
// 8. XÓA SỔ SỰ KIỆN (BOM NAPAN)
// ==========================================
exports.deleteEvent = async (req, res) => {
    const connection = await db.getConnection();
    await connection.beginTransaction();
    try {
        const eventId = req.params.id;
        
        // Xóa sạch dấu vết của sự kiện này theo trình tự Khóa ngoại (Foreign Key)
        await connection.query("DELETE FROM user_daily_draws WHERE event_id = ?", [eventId]);
        await connection.query("DELETE FROM chungsuc_codes WHERE event_id = ?", [eventId]);
        await connection.query("DELETE FROM chungsuc_events WHERE id = ?", [eventId]);
        
        await connection.commit();
        res.redirect('/admin/chung-suc?msg=' + encodeURIComponent('Đã xóa sổ hoàn toàn sự kiện và dọn rác thành công!') + '&type=success');
    } catch (err) {
        await connection.rollback();
        console.error("Lỗi xóa sự kiện:", err);
        res.redirect('/admin/chung-suc?msg=' + encodeURIComponent(`Lỗi xóa sự kiện: ${err.message}`) + '&type=error');
    } finally {
        connection.release();
    }
};