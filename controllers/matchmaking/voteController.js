const db = require('../../config/db');

exports.submitVote = async (req, res) => {
    const { target_id, room_id, vote_type } = req.body; // vote_type: 'up' hoặc 'down'
    const voter_id = req.user.id;
    const ip_address = req.ip || req.headers['x-forwarded-for'] || 'unknown';

    if (voter_id == target_id) {
        return res.json({ success: false, message: 'Bạn không thể tự Vote cho chính mình!' });
    }

    const conn = await db.getConnection();
    await conn.beginTransaction();

    try {
        // 1. Chống Spam: 1 người chỉ được vote 1 lần cho 1 đồng đội trong 1 phòng
        const [existing] = await conn.query(
            "SELECT id FROM lq_votes WHERE voter_id = ? AND target_id = ? AND room_id = ?", 
            [voter_id, target_id, room_id]
        );
        if (existing.length > 0) throw new Error("Bạn đã đánh giá người này trong trận đấu này rồi!");

        // 2. Ghi nhận Vote
        await conn.query(
            "INSERT INTO lq_votes (voter_id, target_id, room_id, vote_type, ip_address) VALUES (?, ?, ?, ?, ?)", 
            [voter_id, target_id, room_id, vote_type, ip_address]
        );

        // 3. Cộng hoặc Trừ điểm Uy Tín
        const scoreChange = vote_type === 'up' ? 1 : -1;
        await conn.query("UPDATE users SET reputation_score = reputation_score + ? WHERE id = ?", [scoreChange, target_id]);

        // 4. KIỂM TRA THĂNG CẤP CAO THỦ (AUTO PROMOTE)
        const [targetUser] = await conn.query("SELECT reputation_score, is_booster FROM users WHERE id = ?", [target_id]);
        let message = "Cảm ơn bạn đã đánh giá!";
        
        if (targetUser[0].reputation_score >= 50 && targetUser[0].is_booster == 0) {
            await conn.query("UPDATE users SET is_booster = 1 WHERE id = ?", [target_id]);
            message = "Đánh giá thành công! Người chơi này vừa đủ điểm thăng cấp lên danh hiệu Idol Kéo Rank!";
        }

        await conn.commit();
        res.json({ success: true, message: message });

    } catch (e) {
        await conn.rollback();
        res.json({ success: false, message: e.message });
    } finally {
        conn.release();
    }
};