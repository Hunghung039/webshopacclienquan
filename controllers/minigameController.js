const db = require('../config/db');
const { logUserHistory } = require('../utils/historyLogger');
const { maskName } = require('../utils/helpers'); // Dùng hàm che tên an toàn

// ============================================================
// 1. TRANG SẢNH MINIGAME (LOBBY) - TỐI ƯU SEO
// ============================================================
exports.getLobby = async (req, res) => {
    try {
        const [games] = await db.query(`
            SELECT m.*, t.name as type_name 
            FROM minigames m JOIN game_types t ON m.type_id = t.id 
            WHERE m.is_active = TRUE ORDER BY m.id DESC
        `);

        // BỘ TỪ KHÓA SEO CHO SẢNH GAME
        const seoKeywords = "minigame liên quân, vòng quay liên quân, lật thẻ chung sức, túi mù liên quân, vòng quay 9k trúng acc vip, vòng quay quân huy, thử vận may liên quân";

        // SCHEMA TỐI ƯU SEO
        const seoSchema = {
            "@context": "https://schema.org",
            "@type": "CollectionPage",
            "name": "Sảnh Minigame Liên Quân - Vòng Quay & Túi Mù",
            "description": "Tham gia ngay các sự kiện Gacha, vòng quay nhân phẩm, mở túi mù 9k trúng tài khoản Liên Quân VIP có Skin SSS.",
            "url": "https://shoplienquan.site/minigame",
            "publisher": {
                "@type": "Organization",
                "name": "ShopLienQuan"
            }
        };
        
        res.render(`themes/${req.theme || 'default'}/minigame_lobby`, {
            title: 'Sảnh Minigame - Vòng Quay Nhân Phẩm | Shop Liên Quân',
            description: 'Tham gia vòng quay nhân phẩm, túi mù 9k, sự kiện chung sức Liên Quân với tỷ lệ trúng 100%. Giải thưởng cực khủng đang chờ đón.',
            keywords: seoKeywords,
            schemaData: JSON.stringify(seoSchema), // Ép Schema ra File Head
            games: games,
            user: req.user
        });
    } catch (err) {
        console.error("Lỗi Sảnh Gacha:", err);
        res.status(500).send("Lỗi tải sảnh");
    }
};

// ============================================================
// 2. RENDER TRANG GIAO DIỆN CHƠI GAME (CHI TIẾT GAME)
// ============================================================
exports.getMinigamePage = async (req, res) => {
    try {
        const slug = req.params.slug;
        const [games] = await db.query(
            "SELECT m.*, t.code as engine_code FROM minigames m JOIN game_types t ON m.type_id = t.id WHERE m.slug = ? AND m.is_active = TRUE", 
            [slug]
        );

        if (games.length === 0) return res.status(404).render(`themes/${req.theme || 'default'}/404`, { title: "Game không tồn tại", user: req.user });

        const game = games[0];
        const [prizes] = await db.query("SELECT id, name, image_url, type, is_special FROM minigame_prizes WHERE minigame_id = ?", [game.id]);

        // BỘ TỪ KHÓA SEO ĐỘNG DỰA TRÊN TÊN GAME
        const seoKeywords = `chơi ${game.name.toLowerCase()}, ${game.name.toLowerCase()} liên quân, vòng quay trúng acc vip, thử vận may 9k, gacha liên quân`;

        const seoSchema = {
            "@context": "https://schema.org",
            "@type": "VideoGame",
            "name": game.name,
            "description": `Chơi ${game.name} để có cơ hội trúng tài khoản VIP và các phần quà giá trị.`,
            "playMode": "SinglePlayer",
            "applicationCategory": "BrowserGame"
        };

        res.render(`themes/${req.theme || 'default'}/minigame_${game.engine_code.toLowerCase()}`, {
            title: `Chơi ${game.name} - Trúng Lớn | Shop Liên Quân`,
            description: `Tham gia sự kiện ${game.name} với giá chỉ từ ${new Intl.NumberFormat('vi-VN').format(game.price)}đ. Cam kết tỷ lệ trúng thưởng cao, hệ thống ngẫu nhiên 100%.`,
            keywords: seoKeywords,
            schemaData: JSON.stringify(seoSchema),
            game: game,
            prizes: prizes,
            user: req.user
        });
    } catch (err) {
        console.error("Lỗi tải minigame:", err);
        res.status(500).send("Lỗi hệ thống");
    }
};

// ============================================================
// 3. LÕI GACHA CỰC BẢO MẬT (API XỬ LÝ QUAY/LẬT) - ĐÃ FIX BUGS
// ============================================================
exports.playGame = async (req, res) => {
    const { game_id } = req.body;
    const user_id = req.user.id;

    // Bắt buộc kết nối an toàn (Transaction) để chống Tool spam nhấp chuột
    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
        // BƯỚC 1: Lấy thông tin Game
        const [games] = await connection.query("SELECT * FROM minigames WHERE id = ? AND is_active = TRUE", [game_id]);
        if (games.length === 0) throw new Error("Game đã đóng hoặc không tồn tại!");
        const game = games[0];

        // BƯỚC 2: Khóa dữ liệu User (FOR UPDATE) - Chống tool xài tiền ảo
        const [users] = await connection.query("SELECT money, luck_points, last_free_spin, username FROM users WHERE id = ? FOR UPDATE", [user_id]);
        const user = users[0];

        // BƯỚC 3: Kiểm tra tiền / Lượt quay Free
        let isFreeSpin = false;
        if (game.price === 0) {
            const today = new Date().toISOString().split('T')[0];
            const lastSpinDate = user.last_free_spin ? new Date(user.last_free_spin).toISOString().split('T')[0] : null;
            if (lastSpinDate === today) throw new Error("Bạn đã hết lượt chơi Free hôm nay. Hãy quay lại vào ngày mai!");
            isFreeSpin = true;
        } else {
            if (user.money < game.price) throw new Error("Số dư không đủ! Vui lòng nạp thêm tiền.");
        }

        // BƯỚC 4: THUẬT TOÁN TÌM PHẦN THƯỞNG (4 LỚP)
        let winningPrize = null;
        let isPityHit = false; // Cờ nổ hũ (Thanh nhân phẩm)

        // Lớp 1: Check "Bàn tay Admin" (Ghim giải ưu tiên)
        const [targeted] = await connection.query(
            "SELECT * FROM user_targeted_rewards WHERE user_id = ? AND minigame_id = ? AND status = 'PENDING' LIMIT 1",
            [user_id, game_id]
        );

        if (targeted.length > 0) {
            const [prizes] = await connection.query("SELECT * FROM minigame_prizes WHERE id = ?", [targeted[0].prize_id]);
            winningPrize = prizes[0];
            await connection.query("UPDATE user_targeted_rewards SET status = 'CLAIMED' WHERE id = ?", [targeted[0].id]);
        } 
        // Lớp 2: Check "Thanh Nhân Phẩm" (Pity System) - Đạt 100 điểm thì auto trúng giải Đặc Biệt
        else if (!isFreeSpin && (user.luck_points + game.luck_points_reward >= 100)) {
            const [specialPrizes] = await connection.query("SELECT * FROM minigame_prizes WHERE minigame_id = ? AND is_special = TRUE AND quantity != 0 ORDER BY RAND() LIMIT 1", [game_id]);
            if (specialPrizes.length > 0) {
                winningPrize = specialPrizes[0];
                isPityHit = true;
            }
        }

        // Lớp 3: Thuật toán Random Tỉ Lệ (Weighted Random) chuẩn Gacha Quốc Tế
        if (!winningPrize) {
            const [prizes] = await connection.query("SELECT * FROM minigame_prizes WHERE minigame_id = ? AND quantity != 0", [game_id]);
            if (prizes.length === 0) throw new Error("Kho giải thưởng đang trống!");

            let totalWeight = 0;
            prizes.forEach(p => totalWeight += parseFloat(p.drop_rate));
            
            let randomNum = Math.random() * totalWeight;
            let currentWeight = 0;

            for (let p of prizes) {
                currentWeight += parseFloat(p.drop_rate);
                if (randomNum <= currentWeight) {
                    winningPrize = p;
                    break;
                }
            }
            if(!winningPrize) winningPrize = prizes[prizes.length - 1]; // Fallback phòng hờ
        }

        // BƯỚC 5: XỬ LÝ KẾT QUẢ VÀ TRỪ TIỀN
        // 5.1 - Trừ số lượng giải
        if (winningPrize.quantity > 0) {
            await connection.query("UPDATE minigame_prizes SET quantity = quantity - 1 WHERE id = ?", [winningPrize.id]);
        }

        // 5.2 - Tính toán Tiền & Điểm Nhân phẩm mới
        let newMoney = user.money;
        let newLuck = user.luck_points;

        if (!isFreeSpin) {
            newMoney -= game.price; 
            if (isPityHit) {
                newLuck = 0; // Trúng hũ -> Reset điểm
            } else {
                newLuck = Math.min(100, user.luck_points + game.luck_points_reward); 
            }
        }

        if (winningPrize.type === 'MONEY') {
            newMoney += parseInt(winningPrize.value || 0); // Cộng tiền nếu giải là Tiền
        }

        // 5.3 - Cập nhật ví User
        if (isFreeSpin) {
            await connection.query("UPDATE users SET last_free_spin = NOW() WHERE id = ?", [user_id]);
        } else {
            await connection.query("UPDATE users SET money = ?, luck_points = ? WHERE id = ?", [newMoney, newLuck, user_id]);
        }

        // 5.4 - Ghi Log Lịch sử Gacha cho User
        await connection.query(
            "INSERT INTO minigame_logs (user_id, minigame_id, prize_id, price_paid) VALUES (?, ?, ?, ?)",
            [user_id, game_id, winningPrize.id, game.price]
        );

        // 5.5 - [FIXED BUGS] Ghi Lịch Sử Tổng Hợp (Dùng đúng tên biến)
        let rewardText = winningPrize.type === 'NOTHING' ? 'Trượt (Chúc may mắn lần sau)' : `Trúng: ${winningPrize.name}`;
        
        await logUserHistory(
            user_id, // Đã fix từ userId thành user_id
            'VÒNG QUAY', 
            `Chơi sự kiện: ${game.name}`, 
            game.price, // Đã fix từ priceToPay thành game.price
            rewardText, 
            connection
        );

        // BƯỚC 6: XÁC NHẬN GIAO DỊCH
        await connection.commit();
        connection.release();

        // BƯỚC 7: NỔ THÔNG BÁO REAL-TIME CHO TOÀN BỘ KHÁCH
        if (winningPrize.type !== 'NOTHING') {
            try {
                const io = req.app.get('socketio');
                if (io) {
                    let safeName = user.username.length > 4 ? user.username.substring(0, user.username.length - 3) + '***' : user.username + '***';
                    let actionText = `vừa chơi ${game.name} và trúng phần thưởng siêu cấp: ${winningPrize.name}`;
                    
                    if (game.name.toLowerCase().includes("túi mù")) {
                        actionText = `vừa mở Túi Mù 9k trúng ${winningPrize.name}`;
                    } else if (game.name.toLowerCase().includes("quẻ")) {
                        actionText = `vừa thỉnh Quẻ Liên Quân nhận ${winningPrize.name}`;
                    }

                    io.emit('broadcast-activity', {
                        user: safeName,
                        action: actionText,
                        time: 'Vừa xong'
                    });
                }
            } catch (e) { console.error("Lỗi Socket Minigame:", e); }
        }

        // TRẢ KẾT QUẢ VỀ CHO VÒNG QUAY BẮT ĐẦU CHẠY
        res.json({
            success: true,
            message: `Trúng: ${winningPrize.name}`,
            prize: {
                id: winningPrize.id,
                name: winningPrize.name,
                image: winningPrize.image_url,
                type: winningPrize.type
            },
            new_money: newMoney,
            new_luck: newLuck,
            pity_hit: isPityHit 
        });

    } catch (err) {
        // NẾU CÓ LỖI (Hack, Hết tiền) -> ROLLBACK HOÀN TIỀN
        await connection.rollback();
        connection.release();
        res.status(400).json({ success: false, message: err.message || "Lỗi hệ thống Gacha!" });
    }
};

// ============================================================
// 4. API LẤY DANH SÁCH TRÚNG THƯỞNG GẦN ĐÂY (CHO THANH CHẠY MARQUEE)
// ============================================================
exports.getRecentWinners = async (req, res) => {
    try {
        const [logs] = await db.query(`
            SELECT u.username, p.name as prize_name, m.name as game_name
            FROM minigame_logs l
            JOIN users u ON l.user_id = u.id
            JOIN minigame_prizes p ON l.prize_id = p.id
            JOIN minigames m ON l.minigame_id = m.id
            WHERE p.type != 'NOTHING'
            ORDER BY l.created_at DESC
            LIMIT 10
        `);

        // Che tên người dùng để bảo mật (VD: tuan123 -> tua***)
        const maskedLogs = logs.map(log => ({
            username: log.username.substring(0, 3) + '***',
            prize_name: log.prize_name,
            game_name: log.game_name
        }));

        res.json({ success: true, data: maskedLogs });
    } catch (err) {
        console.error("Lỗi lấy lịch sử:", err);
        res.status(500).json({ success: false });
    }
};