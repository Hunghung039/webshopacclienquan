const db = require('../config/db');
const fs = require('fs');
const path = require('path');

// ============================================================
// 1. RENDER GIAO DIỆN QUẢN LÝ
// ============================================================
exports.getManager = async (req, res) => {
    try {
        const [gameTypes] = await db.query("SELECT * FROM game_types");
        const [minigames] = await db.query(`
            SELECT m.*, t.name as type_name 
            FROM minigames m JOIN game_types t ON m.type_id = t.id 
            ORDER BY m.id DESC
        `);
        const [prizes] = await db.query(`
            SELECT p.*, m.name as game_name 
            FROM minigame_prizes p JOIN minigames m ON p.minigame_id = m.id 
            ORDER BY p.minigame_id, p.drop_rate DESC
        `);

        res.render('admin/minigame_manager', {
            layout: 'admin',
            page: 'minigames',
            gameTypes,
            minigames,
            prizes,
            user: req.user
        });
    } catch (err) {
        console.error("Lỗi getManager Minigame:", err);
        res.status(500).send("Lỗi tải trang quản lý Minigame");
    }
};

// ============================================================
// 2. TẠO MINIGAME MỚI (CLONE)
// ============================================================
exports.addGame = async (req, res) => {
    try {
        const { type_id, name, slug } = req.body;
        
        // Ép kiểu số để tránh lỗi SQL
        const price = parseInt(req.body.price) || 0;
        const luck_points_reward = parseInt(req.body.luck_points_reward) || 0;
        
        // Fix lỗi sai đường dẫn (Chuyển uploads thành images cho khớp bộ nén WebP)
        const image_url = req.file ? `/images/${req.file.filename}` : '/images/default-wheel.png';

        await db.query(
            "INSERT INTO minigames (type_id, name, slug, image_url, price, luck_points_reward) VALUES (?, ?, ?, ?, ?, ?)",
            [type_id, name, slug, image_url, price, luck_points_reward]
        );
        res.redirect('/admin/minigames?msg=' + encodeURIComponent('Đã tạo Minigame thành công!') + '&type=success');
    } catch (err) {
        console.error("Lỗi addGame:", err);
        res.redirect('/admin/minigames?msg=' + encodeURIComponent(`Lỗi: ${err.message}`) + '&type=error');
    }
};

// ============================================================
// 3. XÓA MINIGAME
// ============================================================
exports.deleteGame = async (req, res) => {
    try {
        await db.query("DELETE FROM minigames WHERE id = ?", [req.params.id]);
        res.redirect('/admin/minigames?msg=' + encodeURIComponent('Đã xóa Game và toàn bộ giải thưởng liên quan!') + '&type=success');
    } catch (err) {
        console.error("Lỗi deleteGame:", err);
        res.redirect('/admin/minigames?msg=' + encodeURIComponent('Lỗi xóa game') + '&type=error');
    }
};

// ============================================================
// 4. THÊM PHẦN THƯỞNG VÀO KHO
// ============================================================
exports.addPrize = async (req, res) => {
    try {
        const { minigame_id, name, type } = req.body;
        
        // Ép kiểu chuẩn xác các thông số số học (Rất quan trọng để không sập DB)
        const value = parseInt(req.body.value) || 0;
        const drop_rate = parseFloat(req.body.drop_rate) || 0;
        const quantity = parseInt(req.body.quantity) || 0;
        const is_special = req.body.is_special === 'on' ? 1 : 0;
        
        // Fix lỗi sai đường dẫn
        const image_url = req.file ? `/images/${req.file.filename}` : '/images/default-prize.png';

        await db.query(
            "INSERT INTO minigame_prizes (minigame_id, name, image_url, type, value, drop_rate, quantity, is_special) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            [minigame_id, name, image_url, type, value, drop_rate, quantity, is_special]
        );
        res.redirect('/admin/minigames?msg=' + encodeURIComponent('Đã nạp giải thưởng vào kho!') + '&type=success');
    } catch (err) {
        console.error("Lỗi addPrize:", err);
        res.redirect('/admin/minigames?msg=' + encodeURIComponent(`Lỗi nạp giải: ${err.message}`) + '&type=error');
    }
};

// ============================================================
// 5. XÓA PHẦN THƯỞNG
// ============================================================
exports.deletePrize = async (req, res) => {
    try {
        await db.query("DELETE FROM minigame_prizes WHERE id = ?", [req.params.id]);
        res.redirect('/admin/minigames?msg=' + encodeURIComponent('Đã xóa giải thưởng khỏi kho!') + '&type=success');
    } catch (err) {
        console.error("Lỗi deletePrize:", err);
        res.redirect('/admin/minigames?msg=' + encodeURIComponent('Lỗi xóa giải') + '&type=error');
    }
};

// ============================================================
// 6. XEM LỊCH SỬ CHƠI
// ============================================================
exports.getLogs = async (req, res) => {
    try {
        const [logs] = await db.query(`
            SELECT l.*, u.username, m.name as game_name, p.name as prize_name, p.type as prize_type 
            FROM minigame_logs l
            JOIN users u ON l.user_id = u.id
            JOIN minigames m ON l.minigame_id = m.id
            LEFT JOIN minigame_prizes p ON l.prize_id = p.id
            ORDER BY l.created_at DESC LIMIT 500
        `);

        res.render('admin/minigame_logs', {
            layout: 'admin',
            page: 'minigame_logs',
            logs: logs,
            user: req.user
        });
    } catch (err) {
        console.error("Lỗi getLogs:", err);
        res.status(500).send("Lỗi xem lịch sử");
    }
};