const db = require('../config/db');
const { logUserHistory } = require('../utils/historyLogger');
const { maskName } = require('../utils/helpers'); // Dùng để che tên trên loa thông báo

// =========================================================================
// 1. RENDER SẢNH CHUNG SỨC (LOBBY TỔNG HỢP) - SIÊU SEO
// =========================================================================
exports.getLobby = async (req, res) => {
    try {
        const [events] = await db.query("SELECT * FROM chungsuc_events WHERE is_active = TRUE ORDER BY id DESC");
        
        // BỘ TỪ KHÓA SEO ĐỈNH CAO CHO SỰ KIỆN CHUNG SỨC
        const seoKeywords = "chungsuc, gieo quẻ đầu năm,cày thuê,shoplienquan.site,chungsulienquan ,chung sức liên quân, lật thẻ liên quân, cách làm sự kiện chung sức liên quân, sự kiện chung sức hảo vận, mã code chung sức, đổi mã chung sức liên quân, shop chung sức liên quân";

        // SCHEMA.ORG: KHAI BÁO DẠNG TRANG SỰ KIỆN KHUYẾN MÃI TẬP HỢP
        const seoSchema = {
            "@context": "https://schema.org",
            "@type": "CollectionPage",
            "name": "Sự Kiện Chung Sức Liên Quân",
            "description": "Trang web chuyên chạy nhanh các dịch vụ về liên quân , sự kiện chung sức , chung sức liên quân các mùa trong năm. tham gia ngay nhé!",
            "url": "https://shoplienquan.site/chung-suc"
        };

        res.render(`themes/${req.theme || 'default'}/chungsuc_lobby`, {
            title: 'Chạy Nhanh Sự Kiện Chung Sức Liên Quân - | shoplienquan',
            description: 'Trang web chuyên chạy nhanh các dịch vụ về liên quân , sự kiện chung sức , chung sức liên quân các mùa trong năm. tham gia ngay nhé!',
            keywords: seoKeywords,
            schemaData: JSON.stringify(seoSchema), // Truyền ra Header
            events: events,
            user: req.user
        });
    } catch (err) {
        console.error("Lỗi Sảnh Chung Sức:", err);
        res.status(500).send("Lỗi tải sảnh hệ thống");
    }
};

// =========================================================================
// 2. RENDER TRANG CHƠI TỪNG GAME CHUNG SỨC
// =========================================================================
exports.getPage = async (req, res) => {
    try {
        const slug = req.params.slug;
        
        const [events] = await db.query("SELECT * FROM chungsuc_events WHERE slug = ? AND is_active = TRUE", [slug]);
        if(events.length === 0) return res.status(404).render(`themes/${req.theme || 'default'}/404`, { title: "Sự kiện đã đóng", user: req.user });
        
        const event = events[0];
        const SPIN_PRICES = event.prices.split(',').map(Number); 

        let drawCount = 0;
        let pendingSpin = null;
        let currentPrice = SPIN_PRICES[0];
        let myHistory = [];

        if (req.user) {
            const today = new Date().toLocaleDateString('en-CA');
            const [dailyRecord] = await db.query("SELECT * FROM user_daily_draws WHERE user_id = ? AND draw_date = ? AND event_id = ?", [req.user.id, today, event.id]);
            
            if (dailyRecord.length > 0) {
                drawCount = dailyRecord[0].draw_count;
                if (dailyRecord[0].pending_code_id !== null) {
                    pendingSpin = {
                        start_time: dailyRecord[0].spin_start_time,
                        card_image: dailyRecord[0].pending_image
                    };
                }
            }
            
            currentPrice = drawCount >= SPIN_PRICES.length ? SPIN_PRICES[SPIN_PRICES.length - 1] : SPIN_PRICES[drawCount];

            const [histories] = await db.query(
                "SELECT code, card_image, claimed_at FROM chungsuc_codes WHERE winner_id = ? AND status = 2 AND event_id = ? ORDER BY claimed_at DESC", 
                [req.user.id, event.id]
            );
            myHistory = histories;
        }

        // TỪ KHÓA ĐỘNG DỰA THEO TÊN SỰ KIỆN CỦA ADMIN CÀI ĐẶT
        const seoKeywords = `sự kiện ${event.name.toLowerCase()}, lật thẻ ${event.name.toLowerCase()}, chung sức liên quân, nhận quà ${event.name.toLowerCase()}`;

        // SCHEMA VIDEO GAME 
        const seoSchema = {
            "@context": "https://schema.org",
            "@type": "VideoGame",
            "name": event.name,
            "description": `Chơi ${event.name} để có cơ hội trúng mã code Liên Quân VIP.`,
            "playMode": "SinglePlayer"
        };

        res.render(`themes/${req.theme || 'default'}/chungsuc`, {
            title: `Lật thẻ ${event.name} - 100% Trúng Skin SSS | ShopLienQuan`,
            description: `Tham gia sự kiện ${event.name} ngay hôm nay. Lật thẻ may mắn chỉ từ ${currentPrice}đ. Tỷ lệ trúng các trang phục hiếm cao nhất hệ thống.`,
            keywords: seoKeywords,
            schemaData: JSON.stringify(seoSchema),
            event: event, 
            drawCount: drawCount,
            currentPrice: currentPrice,
            pendingSpin: pendingSpin,
            myHistory: myHistory,
            user: req.user
        });
    } catch (err) {
        console.error("Lỗi trang Chung Sức:", err);
        res.status(500).send("Lỗi hệ thống");
    }
};

// =========================================================================
// 3. API BẤM NÚT QUAY (TRỪ TIỀN & XÁC ĐỊNH KẾT QUẢ - BẢO MẬT GIAO DỊCH)
// =========================================================================
exports.spin = async (req, res) => {
    const user_id = req.user.id;
    const { event_id } = req.body; 
    const today = new Date().toLocaleDateString('en-CA');
    
    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
        const [events] = await connection.query("SELECT * FROM chungsuc_events WHERE id = ? AND is_active = TRUE", [event_id]);
        if(events.length === 0) throw new Error("Sự kiện không hợp lệ!");
        const event = events[0];
        const SPIN_PRICES = event.prices.split(',').map(Number);

        // Khóa dòng user tránh hack âm tiền
        const [users] = await connection.query("SELECT money FROM users WHERE id = ? FOR UPDATE", [user_id]);
        
        let [dailyRecord] = await connection.query("SELECT * FROM user_daily_draws WHERE user_id = ? AND draw_date = ? AND event_id = ? FOR UPDATE", [user_id, today, event_id]);
        let drawCount = 0;
        let totalSpent = 0;
        
        if (dailyRecord.length === 0) {
            await connection.query("INSERT INTO user_daily_draws (user_id, draw_date, event_id, draw_count, total_spent) VALUES (?, ?, ?, 0, 0)", [user_id, today, event_id]);
        } else {
            drawCount = dailyRecord[0].draw_count;
            totalSpent = dailyRecord[0].total_spent;
            if (dailyRecord[0].pending_code_id !== null) throw new Error("Bạn đang có một lượt quay chưa lật thẻ!");
        }

        const price = drawCount >= SPIN_PRICES.length ? SPIN_PRICES[SPIN_PRICES.length - 1] : SPIN_PRICES[drawCount];
        if (users[0].money < price) throw new Error("Số dư không đủ! Cần " + new Intl.NumberFormat('vi-VN').format(price) + "đ.");

        let newTotalSpent = totalSpent + price;
        let isRare = false;

        // KIỂM TRA MỐC NỔ HŨ (BẢO HIỂM PITTY SYSTEM)
        if (newTotalSpent >= event.pity_threshold) {
            isRare = true;
        }

        let assignedCodeId = -1; 
        let assignedImage = '';
        let pickedCodeString = null; 
        const spinStartTime = Date.now();

        if (isRare) {
            // NỔ HŨ: TRÚNG MÃ VIP CỐ ĐỊNH (Đã cài ở Admin)
            assignedCodeId = -999; 
            pickedCodeString = event.vip_code; 
            assignedImage = event.rare_image;
            
            // RESET TOÀN BỘ CHU KỲ (Về lại 0đ)
            newTotalSpent = 0; 
            drawCount = -1; // Để tí nữa +1 thành 0 (Quay lại giá Free/Mốc 1)
        } else {
            // RÚT MÃ TRONG KHO (MÃ RÁC/KHUYẾN MÃI)
            const [availableCodes] = await connection.query("SELECT id, code FROM chungsuc_codes WHERE status = 0 AND event_id = ? LIMIT 1 FOR UPDATE", [event_id]);
            if (availableCodes.length === 0) {
                throw new Error("Kho thẻ tạm hết! Xin chờ Admin bơm thêm mã.");
            }
            
            assignedCodeId = availableCodes[0].id;
            pickedCodeString = availableCodes[0].code; 
            
            // Random ảnh rác hiển thị để lừa cảm giác khách
            const trashImages = event.trash_images.split(',').map(img => img.trim());
            assignedImage = trashImages[Math.floor(Math.random() * trashImages.length)];
            
            // Khóa mã này lại ngay lập tức
            await connection.query("UPDATE chungsuc_codes SET status = 1 WHERE id = ?", [assignedCodeId]);
        }

        // Trừ tiền user
        if (price > 0) {
            await connection.query("UPDATE users SET money = money - ? WHERE id = ?", [price, user_id]);
        }

        // Đánh dấu thời điểm quay để khách bắt buộc chờ 20 giây mới lật được
        await connection.query(
            "UPDATE user_daily_draws SET draw_count = ?, total_spent = ?, has_won_rare = ?, pending_code_id = ?, pending_image = ?, spin_start_time = ? WHERE user_id = ? AND draw_date = ? AND event_id = ?",
            [drawCount + 1, newTotalSpent, isRare ? 1 : 0, assignedCodeId, assignedImage, spinStartTime, user_id, today, event_id]
        );

        // Ghi Lịch sử tổng hợp (Hiển thị trong hồ sơ khách)
        await logUserHistory(user_id, 'CHUNG SỨC', `Lật thẻ: ${event.name}`, price, `Nhận mã bí mật (Đang chờ lật)`, connection);
        
        await connection.commit();
        connection.release();

        res.json({ success: true, card_image: assignedImage, start_time: spinStartTime, new_money: users[0].money - price });

    } catch (err) {
        await connection.rollback();
        connection.release();
        res.status(400).json({ success: false, message: err.message });
    }
};

// =========================================================================
// 4. API TRẢ MÃ KHI KHÁCH ĐÃ ĐỢI LẬT BÀI XONG 20s (FIXED LỖI CONNECTION)
// =========================================================================
exports.reveal = async (req, res) => {
    const user_id = req.user.id;
    const { event_id } = req.body;
    const today = new Date().toLocaleDateString('en-CA');

    // [FIXED]: Khởi tạo transaction ngay từ đầu để đảm bảo an toàn mọi nhánh lỗi
    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
        const [dailyRecord] = await connection.query("SELECT * FROM user_daily_draws WHERE user_id = ? AND draw_date = ? AND event_id = ? FOR UPDATE", [user_id, today, event_id]);
        
        if (dailyRecord.length === 0 || dailyRecord[0].pending_code_id === null) {
            await connection.rollback();
            connection.release();
            return res.status(400).json({ success: false, message: "Không tìm thấy phiên quay hợp lệ!" });
        }

        const spinStartTime = dailyRecord[0].spin_start_time;
        
        // Cú lừa 20s - Nếu khách xài tool F12 chọc thẳng vào API nhanh hơn 19.5s sẽ bị chặn
        if ((Date.now() - spinStartTime) < 19500) {
            await connection.rollback();
            connection.release();
            return res.status(400).json({ success: false, message: "Phát hiện gian lận thời gian (Dùng Tool hack tốc độ)!" });
        }

        const pendingCodeId = dailyRecord[0].pending_code_id;
        let finalCode = "LỖI HỆ THỐNG"; 
        let isVip = false; 
        let eventName = "Chung sức";

        // Lấy thông tin sự kiện
        const [events] = await connection.query("SELECT name, vip_code, rare_image FROM chungsuc_events WHERE id = ?", [event_id]);
        if(events.length > 0) eventName = events[0].name;

        if (pendingCodeId === -999) {
            // NẾU LÀ MÃ VIP TỪ BẢO HIỂM NỔ HŨ:
            finalCode = events[0].vip_code;
            isVip = true;
            
            // Sinh ra 1 bản ghi ảo trong bảng code để hiển thị ở Bảng vàng trúng thưởng
            await connection.query(
                "INSERT INTO chungsuc_codes (event_id, code, card_image, status, winner_id, claimed_at) VALUES (?, ?, ?, 2, ?, NOW())", 
                [event_id, finalCode, events[0].rare_image, user_id]
            );

        } else if (pendingCodeId > 0) {
            // NẾU LÀ MÃ TRONG KHO (MÃ RÁC): Đổi trạng thái mã thành Đã Bán
            const [codes] = await connection.query("SELECT code FROM chungsuc_codes WHERE id = ?", [pendingCodeId]);
            if (codes.length > 0) {
                finalCode = codes[0].code;
                await connection.query("UPDATE chungsuc_codes SET status = 2, winner_id = ?, claimed_at = NOW() WHERE id = ?", [user_id, pendingCodeId]);
            }
        }

        // Dọn dẹp trạng thái chờ (Giải phóng user để họ quay lượt tiếp)
        await connection.query("UPDATE user_daily_draws SET pending_code_id = NULL, pending_image = NULL, spin_start_time = NULL WHERE user_id = ? AND draw_date = ? AND event_id = ?", [user_id, today, event_id]);

        await connection.commit();

        // NỔ LOA REALTIME TOÀN WEB NẾU TRÚNG MÃ VIP (KÍCH THÍCH KHÁCH NẠP THẺ)
        if (isVip) {
            try {
                const io = req.app.get('socketio');
                if (io && req.user) {
                    let safeName = maskName(req.user.username);
                    io.emit('broadcast-activity', {
                        user: safeName,
                        action: `vừa lật thẻ ${eventName} thành công! <strong>Nhận ngay trang phục SSS Tuyệt Sắc!</strong>`,
                        time: 'Vừa xong'
                    });
                }
            } catch (e) { console.error("Lỗi Socket Chung sức:", e); }
        }

        connection.release();
        res.json({ success: true, code: finalCode, is_vip: isVip });
        
    } catch (err) {
        await connection.rollback();
        connection.release();
        console.error("Lỗi lật thẻ Chung Sức:", err);
        res.status(500).json({ success: false, message: "Lỗi hệ thống khi mở mã!" });
    }
};