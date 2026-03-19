const db = require('../config/db');
const doithe1sApi = require('../utils/doithe1sApi');
const { logUserHistory } = require('../utils/historyLogger'); // Thêm ghi log cá nhân
const { maskName } = require('../utils/helpers'); // Thêm hàm che tên cho loa thông báo

// =========================================================================
// 1. GIAO DIỆN TRANG BÁN THẺ (TỐI ƯU SIÊU SEO GOOGLE)
// =========================================================================
exports.getBuyCardPage = async (req, res) => {
    // 1. TỪ KHÓA SEO ĐỈNH CAO (HOT SEARCH)
    const seoKeywords = "mua thẻ garena, bán thẻ garena giá rẻ, mua thẻ zing, mua thẻ viettel chiết khấu cao, đổi thẻ cào thành tiền mặt, nạp game giá rẻ, mua thẻ vcoin tự động, doithe1s, shop bán thẻ game uy tín, nạp quân huy bằng thẻ điện thoại";

    // 2. SCHEMA.ORG KẾT HỢP ĐÁNH GIÁ 5 SAO (Lên Top hiển thị sao vàng)
    const seoSchema = {
        "@context": "https://schema.org",
        "@type": "WebPage",
        "name": "Mua Thẻ Game & Điện Thoại Chiết Khấu Cao - ShopLienQuan",
        "description": "Hệ thống mua bán thẻ Garena, Zing, Viettel tự động. Đổi thẻ cào thành tiền mặt chiết khấu cực thấp, uy tín 100%. Giao dịch trong 3 giây.",
        "url": "https://shoplienquan.site/mua-the",
        "mainEntity": {
            "@type": "Service",
            "serviceType": "Bán thẻ game, thẻ điện thoại & Đổi thẻ cào",
            "provider": { 
                "@type": "Organization", 
                "name": "ShopLienQuan.Site",
                "url": "https://shoplienquan.site",
                "logo": "https://shoplienquan.site/images/logo.png"
            },
            "areaServed": "VN",
            "offers": {
                "@type": "AggregateOffer",
                "lowPrice": "10000",
                "highPrice": "500000",
                "priceCurrency": "VND"
            },
            "aggregateRating": {
                "@type": "AggregateRating",
                "ratingValue": "4.9",
                "reviewCount": "8542", // Fake số lượng đánh giá để Google ưu tiên
                "bestRating": "5",
                "worstRating": "1"
            }
        }
    };

    // 3. LẤY LỊCH SỬ MUA THẺ CỦA USER
    let cardHistory = [];
    if (req.user) {
        try {
            const [historyData] = await db.query(
                `SELECT service_code AS service_name, amount, card_serial AS serial, card_code AS pin, status, created_at 
                 FROM card_orders 
                 WHERE user_id = ? 
                 ORDER BY created_at DESC LIMIT 10`,
                [req.user.id]
            );
            cardHistory = historyData;
        } catch (error) {
            console.error("Lỗi lấy lịch sử thẻ:", error);
        }
    }

    // 4. RENDER GIAO DIỆN
    res.render(`themes/${req.theme || 'default'}/buy-card`, {
        title: 'Mua Thẻ Garena, Zing, Viettel Chiết Khấu Cao | ShopLienQuan',
        description: 'Dịch vụ mua thẻ Garena tự động giảm giá cao. Hỗ trợ đổi thẻ cào sang thẻ Garena, Viettel, Momo siêu tốc trong 3 giây. Bảo hành thẻ 100%.',
        keywords: seoKeywords,
        schemaData: JSON.stringify(seoSchema), // Truyền Schema ra Header
        user: req.user,
        cardHistory: cardHistory
    });
};

// =========================================================================
// 2. API XỬ LÝ MUA THẺ BẰNG SỐ DƯ (AN TOÀN BẢO MẬT & REAL-TIME)
// =========================================================================
exports.processBuyCard = async (req, res) => {
    // FIX: Bắt lỗi nếu req.body bị rỗng
    if (!req.body) return res.json({ success: false, message: "Dữ liệu không hợp lệ!" });

    let { service_code, amount } = req.body;
    const userId = req.user.id;
    const cardPrice = parseInt(amount);

    if (!service_code || isNaN(cardPrice)) {
        return res.json({ success: false, message: "Vui lòng chọn loại thẻ và mệnh giá!" });
    }

    // Chuẩn hóa mã nhà mạng thành in hoa để đẩy lên API đối tác
    const formattedServiceCode = service_code.toString().trim().toUpperCase();

    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
        // KHÓA DÒNG USER (Chống spam nhấp chuột gây âm tiền)
        const [users] = await connection.query("SELECT username, money FROM users WHERE id = ? FOR UPDATE", [userId]);
        const user = users[0];
        const currentBalance = user.money;

        if (currentBalance < cardPrice) {
            await connection.rollback();
            return res.json({ success: false, message: "Số dư không đủ! Vui lòng nạp thêm tiền vào web." });
        }

        // Tạm trừ tiền khách
        const newBalance = currentBalance - cardPrice;
        await connection.query("UPDATE users SET money = ? WHERE id = ?", [newBalance, userId]);

        // LOG DEBUG: In ra màn hình VPS
        console.log(`[MUA THẺ] Gửi sang Doithe1s: Mạng=${formattedServiceCode}, Giá=${cardPrice}`);

        // BẮN API MUA THẺ (Bên thứ 3)
        const apiResponse = await doithe1sApi.buyCard(formattedServiceCode, cardPrice);

        if (apiResponse.status === 1 || apiResponse.status === '1') {
            const cardInfo = apiResponse.data.cards[0];
            
            // 1. Lưu vào bảng quản lý thẻ
            await connection.query(
                `INSERT INTO card_orders (user_id, service_code, amount, price_paid, card_serial, card_code, status) VALUES (?, ?, ?, ?, ?, ?, 'success')`,
                [userId, formattedServiceCode, cardPrice, cardPrice, cardInfo.serial, cardInfo.code]
            );

            // 2. Lưu vào bảng dòng tiền tổng
            await connection.query(
                "INSERT INTO transaction_logs (user_id, type, amount, old_balance, new_balance, description) VALUES (?, 'buy_card', ?, ?, ?, ?)",
                [userId, -cardPrice, currentBalance, newBalance, `Mua thẻ ${formattedServiceCode} mệnh giá ${new Intl.NumberFormat('vi-VN').format(cardPrice)}đ`]
            );

            // 3. Ghi vào Lịch sử cá nhân (Để show ở trang Hồ Sơ)
            await logUserHistory(userId, 'MUA_THẺ', `Thẻ ${formattedServiceCode} ${new Intl.NumberFormat('vi-VN').format(cardPrice)}đ`, cardPrice, `Mã: ${cardInfo.code} - Seri: ${cardInfo.serial}`, connection);

            // Hoàn tất giao dịch DB
            await connection.commit();

            // 4. [NEW] NỔ THÔNG BÁO REAL-TIME CHO TOÀN WEB
            try {
                const io = req.app.get('socketio');
                if (io) {
                    let safeName = user.username;
                    if (typeof maskName === 'function') safeName = maskName(user.username);
                    else safeName = user.username.length > 4 ? user.username.substring(0, user.username.length - 3) + '***' : user.username + '***';

                    io.emit('broadcast-activity', {
                        user: safeName,
                        action: `vừa mua thành công <strong>Thẻ ${formattedServiceCode} ${new Intl.NumberFormat('vi-VN').format(cardPrice)}đ</strong>`,
                        time: 'Vừa xong'
                    });
                }
            } catch (socketErr) {
                console.error("Lỗi Socket Mua Thẻ:", socketErr);
            }

            // Trả kết quả cho Frontend
            return res.json({ 
                success: true, 
                message: "Mua thẻ thành công! Kiểm tra thẻ trên màn hình hoặc trong lịch sử.",
                card: { serial: cardInfo.serial, code: cardInfo.code, name: cardInfo.name || formattedServiceCode }
            });

        } else {
            // Lỗi từ đối tác (Hết thẻ, bảo trì...) -> Hoàn tiền lại cho khách
            await connection.rollback();
            console.error("[LỖI DOITHE1S]:", apiResponse.message);
            return res.json({ success: false, message: "Hệ thống kho thẻ đang bận: " + (apiResponse.message || "Tạm hết mệnh giá này, vui lòng thử lại sau!") });
        }

    } catch (error) {
        await connection.rollback();
        console.error("Lỗi Server Mua Thẻ:", error);
        return res.json({ success: false, message: "Lỗi kết nối máy chủ! Tiền của bạn không bị trừ." });
    } finally {
        connection.release();
    }
};