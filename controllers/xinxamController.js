const db = require('../config/db');
const { logUserHistory } = require('../utils/historyLogger');
const { maskName } = require('../utils/helpers'); // Thêm helper che tên chống lộ info khách

// =========================================================================
// 1. HIỂN THỊ GIAO DIỆN TRANG GIEO QUẺ (KÈM BỘ META SEO TỐI ƯU)
// =========================================================================
exports.getPage = async (req, res) => {
    try {
        const [configs] = await db.query("SELECT * FROM xinxam_config WHERE id = 1 AND is_active = TRUE");
        if (configs.length === 0) return res.status(404).render(`themes/${req.theme || 'default'}/404`, { title: "Sự kiện đã đóng", user: req.user });
        
        const config = configs[0];
        const [cards] = await db.query("SELECT * FROM xinxam_cards ORDER BY card_number ASC");
        const [stockStats] = await db.query("SELECT card_id, COUNT(*) as stock FROM xinxam_codes WHERE status = 0 GROUP BY card_id");
        
        // Tính toán lại giá thực tế và số lượng tồn kho của từng thẻ
        const displayCards = cards.map(card => {
            const stat = stockStats.find(s => s.card_id === card.id);
            return { ...card, actual_price: card.price !== null ? card.price : config.default_price, stock: stat ? stat.stock : 0 };
        });

        let myHistory = [];
        let nextFreeTime = 0;
        let pendingSpin = null;

        // Nếu đã đăng nhập, load lịch sử cá nhân và tính thời gian hồi chiêu
        if (req.user) {
            // 1. Lấy lịch sử thẻ đã nhận/mua (Từ kho Code)
            const [histories] = await db.query(`
                SELECT c.name as card_name, c.image_url, x.code, x.claimed_at 
                FROM xinxam_codes x 
                JOIN xinxam_cards c ON x.card_id = c.id 
                WHERE x.winner_id = ? ORDER BY x.claimed_at DESC`, 
            [req.user.id]);
            myHistory = histories;

            // 2. Lấy trạng thái thời gian hồi Free
            const [states] = await db.query("SELECT * FROM user_xinxam_state WHERE user_id = ?", [req.user.id]);
            if (states.length > 0) {
                const COOLDOWN_MS = 30 * 60 * 1000; // 30 phút
                nextFreeTime = Number(states[0].last_free_time) + COOLDOWN_MS;
                
                if (states[0].pending_code_id !== null) {
                    pendingSpin = { start_time: Number(states[0].spin_start_time) };
                }
            }
        }

        // SCHEMA.ORG: KHAI BÁO DẠNG TRANG GAME TƯƠNG TÁC KÈM TỪ KHÓA
        const seoSchema = {
            "@context": "https://schema.org",
            "@type": "VideoGame",
            "name": "Gieo quẻ đầu năm shoplienquan.site - Nhận Code Liên Quân",
            "description": "Tham gia gieo quẻ đầu năm shoplienquan.site miễn phí hoặc mua quẻ ưu đãi rước code VIP tại shop liên quân site (shoplienquansite).",
            "playMode": "SinglePlayer",
            "url": "https://shoplienquan.site/gieo-que",
            "image": config.banner_image.startsWith('http') ? config.banner_image : `https://shoplienquan.site/images/${config.banner_image}`
        };

        res.render(`themes/${req.theme || 'default'}/xinxam`, {
            title: 'Gieo quẻ đầu năm shoplienquan.site - FREE Thẻ | shop liên quân site',
            description: 'Sự kiện gieo quẻ đầu năm shoplienquan.site rước Code VIP và Acc siêu phẩm miễn phí. Uy tín số 1 tại shop liên quân site. Truy cập shoplienquansite ngay!',
            keywords: 'gieo quẻ đầu năm shoplienquan.site, shop liên quân site, shoplienquansite', // Truyền biến keyword xuống Head
            image: config.banner_image.startsWith('http') ? config.banner_image : `${process.env.BASE_URL || 'https://shoplienquan.site'}/images/${config.banner_image}`,
            schemaData: JSON.stringify(seoSchema), // Bơm Schema ra Header
            config: config,
            cards: displayCards,
            myHistory: myHistory,
            nextFreeTime: nextFreeTime,
            pendingSpin: pendingSpin,
            user: req.user
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Lỗi hệ thống");
    }
};

// =========================================================================
// 2. API: LẤY THẺ FREE (CHỜ 30S) - ĐÃ FIX LỖI SẬP SERVER DO REQ.BODY TRỐNG
// =========================================================================
exports.freeSpin = async (req, res) => {
    // [FIX BẢO MẬT]: Đón đầu nếu req.body bị undefined
    const body = req.body || {}; 
    const card_id = body.card_id;
    
    // Nếu mất gói tin, báo lỗi trả về chứ TUYỆT ĐỐI KHÔNG SẬP SERVER
    if (!card_id) {
        return res.status(400).json({ success: false, message: "Mất kết nối. Vui lòng F5 tải lại trang shoplienquan.site!" });
    }
    
    const user_id = req.user ? req.user.id : null;
    if (!user_id) return res.status(401).json({ success: false, message: "Vui lòng đăng nhập để xin xăm!" });
    
    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
        let [states] = await connection.query("SELECT * FROM user_xinxam_state WHERE user_id = ? FOR UPDATE", [user_id]);
        if (states.length === 0) {
            await connection.query("INSERT INTO user_xinxam_state (user_id, last_free_time) VALUES (?, 0)", [user_id]);
            states = [{ last_free_time: 0, pending_code_id: null }];
        }

        const state = states[0];
        if (state.pending_code_id !== null) throw new Error("Bạn đang có 1 quẻ chưa lật xong!");

        const COOLDOWN_MS = 30 * 60 * 1000;
        if (Date.now() - Number(state.last_free_time) < COOLDOWN_MS) {
            throw new Error("Chưa hồi xong lượt xin xăm miễn phí!");
        }

        const [availableCodes] = await connection.query("SELECT id FROM xinxam_codes WHERE card_id = ? AND status = 0 LIMIT 1 FOR UPDATE", [card_id]);
        if (availableCodes.length === 0) throw new Error("Quẻ này hiện tại đang hết mã!");

        const codeId = availableCodes[0].id;
        const spinStartTime = Date.now();

        await connection.query("UPDATE xinxam_codes SET status = 2 WHERE id = ?", [codeId]);
        await connection.query("UPDATE user_xinxam_state SET pending_code_id = ?, spin_start_time = ? WHERE user_id = ?", [codeId, spinStartTime, user_id]);

        await connection.commit();
        connection.release();

        res.json({ success: true, start_time: spinStartTime });
    } catch (err) {
        await connection.rollback();
        connection.release();
        res.status(400).json({ success: false, message: err.message });
    }
};

// =========================================================================
// 3. API: LẬT THẺ FREE VÀ NHẬN MÃ (SAU KHI CHỜ XONG 30 GIÂY)
// =========================================================================
exports.freeReveal = async (req, res) => {
    const user_id = req.user ? req.user.id : null;
    if (!user_id) return res.status(401).json({ success: false, message: "Vui lòng đăng nhập!" });

    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
        const [states] = await connection.query("SELECT * FROM user_xinxam_state WHERE user_id = ? FOR UPDATE", [user_id]);
        if (states.length === 0 || states[0].pending_code_id === null) {
            throw new Error("Không có quẻ nào đang chờ lật!");
        }

        const state = states[0];
        const elapsed = Date.now() - Number(state.spin_start_time);
        if (elapsed < 29000) { // Check gian lận thời gian (Yêu cầu ít nhất 29 giây)
            throw new Error("Chưa đủ thời gian 30 giây! Đừng dùng Tool hack thời gian nhé sếp.");
        }

        const codeId = state.pending_code_id;
        
        // Lấy mã Code và Tên thẻ để xíu nổ thông báo
        const [codes] = await connection.query(`
            SELECT x.code, c.name as card_name 
            FROM xinxam_codes x 
            JOIN xinxam_cards c ON x.card_id = c.id 
            WHERE x.id = ?
        `, [codeId]);
        
        await connection.query("UPDATE xinxam_codes SET status = 1, winner_id = ?, claimed_at = NOW() WHERE id = ?", [user_id, codeId]);
        await connection.query("UPDATE user_xinxam_state SET pending_code_id = NULL, spin_start_time = NULL, last_free_time = ? WHERE user_id = ?", [Date.now(), user_id]);

        await connection.commit();

        // BẮN SOCKET THÔNG BÁO CHO TOÀN SERVER BIẾT CÓ NGƯỜI RƯỚC QUẺ THÀNH CÔNG (CHÈN KEYWORD)
        try {
            const io = req.app.get('socketio');
            if (io && req.user) {
                let safeName = maskName(req.user.username);
                let cardName = codes.length > 0 ? codes[0].card_name : 'Quẻ Liên Quân';
                io.emit('broadcast-activity', {
                    user: safeName,
                    action: `vừa rước thành công <strong>${cardName}</strong> từ sự kiện gieo quẻ đầu năm shoplienquan.site!`,
                    time: 'Vừa xong'
                });
            }
        } catch(e) { console.error("Lỗi Socket Gieo Quẻ Free:", e); }

        connection.release();
        res.json({ success: true, code: codes[0].code });

    } catch (err) {
        await connection.rollback();
        connection.release();
        res.status(400).json({ success: false, message: err.message });
    }
};

// =========================================================================
// 4. API: MUA BẰNG TIỀN (LẤY MÃ NGAY LẬP TỨC - KHÔNG CẦN CHỜ)
// =========================================================================
exports.buyPaidCard = async (req, res) => {
    // [FIX BẢO MẬT]: Đón đầu lỗi req.body
    const body = req.body || {}; 
    const card_id = body.card_id;
    
    if (!card_id) return res.status(400).json({ success: false, message: "Lỗi kết nối thẻ. Vui lòng tải lại shop liên quân site!" });
    
    const user_id = req.user ? req.user.id : null;
    if (!user_id) return res.status(401).json({ success: false, message: "Vui lòng đăng nhập!", requireLogin: true });

    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
        // 1. Lấy thông tin giá tiền của thẻ
        const [config] = await connection.query("SELECT default_price FROM xinxam_config WHERE id = 1");
        const [card] = await connection.query("SELECT name, price FROM xinxam_cards WHERE id = ?", [card_id]);
        const priceToPay = card[0].price !== null ? card[0].price : config[0].default_price;
        const cardName = card[0].name;

        // 2. Tính toán số dư và KHÓA HÀNG USER TRONG KHI TRỪ TIỀN
        const [users] = await connection.query("SELECT money, username FROM users WHERE id = ? FOR UPDATE", [user_id]);
        const oldBalance = users[0].money || 0;
        const username = users[0].username;
        
        if (oldBalance < priceToPay) {
            throw new Error(`Số dư không đủ! Sếp cần nạp thêm ${new Intl.NumberFormat('vi-VN').format(priceToPay - oldBalance)}đ để mua.`);
        }

        const newBalance = oldBalance - priceToPay;
        await connection.query("UPDATE users SET money = ? WHERE id = ?", [newBalance, user_id]);

        // 3. GHI LOG VÀO BẢNG transaction_logs (CHÈN KEYWORD)
        await connection.query(
            "INSERT INTO transaction_logs (user_id, type, amount, old_balance, new_balance, description) VALUES (?, 'buy_xinxam', ?, ?, ?, ?)", 
            [user_id, -priceToPay, oldBalance, newBalance, `Gieo quẻ đầu năm shoplienquan.site: Mua thẻ ${cardName}`]
        );

        // 4. Kiểm tra kho thẻ (FOR UPDATE để chống trùng)
        const [availableCodes] = await connection.query("SELECT id, code FROM xinxam_codes WHERE card_id = ? AND status = 0 LIMIT 1 FOR UPDATE", [card_id]);

        if (availableCodes.length === 0) {
            // Trường hợp hy hữu: Vừa bấm thì thằng khác mua mất mã cuối cùng
            await logUserHistory(user_id, 'XIN_XAM', `Mua đặt trước thẻ: ${cardName} (shoplienquansite)`, priceToPay, `Chờ Admin Zalo cấp mã thủ công`, connection);
            
            await connection.commit();
            connection.release();
            
            return res.json({ success: true, contact_admin: true, new_money: newBalance });
        } else {
            // CÒN MÃ THÌ CHỐT ĐƠN LUÔN
            const codeId = availableCodes[0].id;
            const finalCode = availableCodes[0].code;
            
            await connection.query("UPDATE xinxam_codes SET status = 1, winner_id = ?, claimed_at = NOW() WHERE id = ?", [user_id, codeId]);
            
            // Ghi Log Cá nhân để show ở mục Hồ Sơ (CHÈN KEYWORD)
            await logUserHistory(user_id, 'XIN_XAM', `Mua thẻ tại shop liên quân site: ${cardName}`, priceToPay, `Mã Quẻ: ${finalCode}`, connection);

            await connection.commit();

            // NỔ LOA THÔNG BÁO CHO TOÀN SERVER BIẾT CÓ "ĐẠI GIA" XUỐNG TIỀN (CHÈN KEYWORD)
            try {
                const io = req.app.get('socketio');
                if (io) {
                    let safeName = maskName(username);
                    io.emit('broadcast-activity', {
                        user: safeName,
                        action: `vừa dùng ${new Intl.NumberFormat('vi-VN').format(priceToPay)}đ chốt liền tay <strong>${cardName}</strong> tại shoplienquansite!`,
                        time: 'Vừa xong'
                    });
                }
            } catch(e) { console.error("Lỗi Socket Mua Quẻ:", e); }

            connection.release();

            return res.json({ 
                success: true, 
                contact_admin: false,
                code: finalCode,
                new_money: newBalance 
            });
        }
    } catch (err) {
        await connection.rollback();
        connection.release();
        res.status(400).json({ success: false, message: err.message });
    }
};