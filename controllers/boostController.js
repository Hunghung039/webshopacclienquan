const db = require('../config/db');
const { logUserHistory } = require('../utils/historyLogger');
const { maskName } = require('../utils/helpers'); // Thêm hàm che tên chống lộ info khách

// =========================================================================
// HÀM HỖ TRỢ (HELPERS)
// =========================================================================
// Hàm tính số sao quy đổi tuyệt đối để làm mốc tính toán
function getAbsoluteStars(rankGroup, tier, stars) {
    let base = 0;
    tier = parseInt(tier) || 5;
    stars = parseInt(stars) || 0;

    if (rankGroup === 'kimcuong') base = (5 - tier) * 5;
    else if (rankGroup === 'tinhanh') base = 25 + (5 - tier) * 5;
    else if (rankGroup === 'caothu') base = 50;
    
    return base + stars;
}

// Hàm tính tiền tự động, giá lấy động từ Bảng boost_settings
function calculateCost(startAbs, endAbs, priceMap) {
    let total = 0;
    for (let i = startAbs; i < endAbs; i++) {
        if (i < 25) total += priceMap['kim_cuong'] || 5000;
        else if (i < 50) total += priceMap['tinh_anh'] || 8000;
        else if (i < 70) total += priceMap['cao_thu_1_20'] || 10000;
        else if (i < 90) total += priceMap['cao_thu_20_40'] || 12000;
        else total += priceMap['cao_thu_40_50'] || 14000;
    }
    return total;
}

// =========================================================================
// 1. HIỂN THỊ GIAO DIỆN KHÁCH HÀNG (GET) - TỐI ƯU SIÊU SEO
// =========================================================================
exports.getBoostPage = async (req, res) => {
    try {
        const theme = req.theme || 'default';
        const currentSeason = 'S1 2026';
        
        // Gọi bảng giá từ DB
        const [settings] = await db.query("SELECT * FROM boost_settings ORDER BY id ASC");

        // LẤY TẤT CẢ CÁC ĐƠN ĐỂ SHOW LÊN BẢNG FEED LIVE
        const [liveOrders] = await db.query(`
            SELECT b.current_rank, b.target_rank, b.status, b.hero_used, b.proof_images 
            FROM boost_orders b
            WHERE b.season = ? AND b.status != 'cancelled'
            ORDER BY b.created_at DESC LIMIT 30
        `, [currentSeason]);

        // CẤU HÌNH BỘ TỪ KHÓA SEO HOT NHẤT
        const seoKeywords = "cày thuê liên quân, cày thuê rank lq, nhận cày thuê thách đấu, bảng giá cày thuê liên quân, cày thuê uy tín, cày thuê không dùng hack, thuê người leo rank, shop cày thuê liên quân";

        // CẤU HÌNH SCHEMA.ORG CHO DỊCH VỤ CHUYÊN NGHIỆP
        const seoSchema = {
            "@context": "https://schema.org",
            "@type": "Service",
            "serviceType": "Cày Thuê Rank Liên Quân Mobile",
            "provider": {
                "@type": "Organization",
                "name": "ShopLienQuan.Site"
            },
            "areaServed": "VN",
            "description": "Dịch vụ cày thuê rank Liên Quân Mobile bằng tay 100%, bảo mật tuyệt đối. Cam kết tốc độ nhanh nhất với giá rẻ nhất thị trường. Thách đấu trực tiếp gánh team.",
            "offers": {
                "@type": "AggregateOffer",
                "lowPrice": "5000",
                "highPrice": "14000",
                "priceCurrency": "VND",
                "description": "Giá trung bình cho mỗi sao"
            },
            "aggregateRating": {
                "@type": "AggregateRating",
                "ratingValue": "4.9",
                "reviewCount": "3215"
            }
        };

        res.render(`themes/${theme}/cay-thue`, {
            title: `Cày Thuê Liên Quân Bằng Tay - Uy Tín Tuyệt Đối | Mùa ${currentSeason}`,
            description: 'Dịch vụ cày thuê Liên Quân Mobile uy tín, cày tay 100% không dùng phần mềm thứ 3. Bảng giá rẻ nhất, bảo mật tài khoản tuyệt đối.',
            keywords: seoKeywords,
            schemaData: JSON.stringify(seoSchema), // Ép dải Schema ra thẻ Head
            liveLink: 'https://www.tiktok.com/@shoplienquan_live', 
            liveOrders: liveOrders,
            settings: settings,
            season: currentSeason,
            user: req.user
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Lỗi tải trang Cày Thuê");
    }
};

// =========================================================================
// 2. API XỬ LÝ ĐẶT ĐƠN (POST) - CÓ BẢO MẬT & SOCKET
// =========================================================================
exports.bookOrder = async (req, res) => {
    const { login_type, account_user, account_pass, note, current_group, current_tier, current_stars, target_group, target_tier, target_stars } = req.body;
    
    // Nếu chưa đăng nhập thì trả về cờ để Frontend bật form Đăng nhập
    if (!req.user) {
        return res.status(401).json({ 
            success: false, 
            message: "Bạn cần đăng nhập để đặt đơn cày thuê!",
            requireLogin: true 
        });
    }
    
    const userId = req.user.id;

    if (!account_user || !account_pass) {
        return res.json({ success: false, message: "Vui lòng nhập tài khoản và mật khẩu!" });
    }

    const startAbs = getAbsoluteStars(current_group, current_tier, current_stars);
    const endAbs = getAbsoluteStars(target_group, target_tier, target_stars);

    if (startAbs >= endAbs) {
        return res.json({ success: false, message: "Mức rank mong muốn phải cao hơn rank hiện tại!" });
    }

    const conn = await db.getConnection();
    await conn.beginTransaction();

    try {
        // Lấy lại giá tiền mới nhất từ DB
        const [settings] = await conn.query("SELECT tier_key, price_per_star FROM boost_settings");
        const priceMap = {};
        settings.forEach(s => { priceMap[s.tier_key] = parseInt(s.price_per_star); });

        // Tính tiền bằng thuật toán ngầm
        const price = calculateCost(startAbs, endAbs, priceMap);
        const starCount = endAbs - startAbs;

        // Chuẩn hóa tên Mức Rank để in ra màn hình
        const currentRankStr = current_group === 'caothu' ? `Cao Thủ (${current_stars} Sao)` : `${current_group === 'kimcuong' ? 'Kim Cương' : 'Tinh Anh'} ${current_tier} (${current_stars} Sao)`;
        const targetRankStr = target_group === 'caothu' ? `Cao Thủ (${target_stars} Sao)` : `${target_group === 'kimcuong' ? 'Kim Cương' : 'Tinh Anh'} ${target_tier} (${target_stars} Sao)`;

        // KHÓA DỮ LIỆU USER ĐỂ CHỐNG HACK TIỀN
        const [users] = await conn.query("SELECT money, username FROM users WHERE id = ? FOR UPDATE", [userId]);
        const user = users[0];
        const currentBalance = user.money;

        if (currentBalance < price) {
            await conn.rollback();
            return res.json({ 
                success: false, 
                message: `Số dư không đủ! Hóa đơn của bạn là ${new Intl.NumberFormat('vi-VN').format(price)}đ.`,
                requireRecharge: true
            });
        }

        const newBalance = currentBalance - price;
        await conn.query("UPDATE users SET money = ? WHERE id = ?", [newBalance, userId]);

        // Ghép Note vào Password để lưu DB gọn gàng
        const accountPassWithNote = note ? `${account_pass} | LƯU Ý: ${note}` : account_pass;

        // Lưu đơn hàng vào Database
        await conn.query(`
            INSERT INTO boost_orders (user_id, login_type, account_user, account_pass, current_rank, target_rank, star_count, price, season) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'S1 2026')
        `, [userId, login_type, account_user, accountPassWithNote, currentRankStr, targetRankStr, starCount, price]);

        // Log lại lịch sử dòng tiền tổng hệ thống
        await conn.query(
            "INSERT INTO transaction_logs (user_id, type, amount, old_balance, new_balance, description) VALUES (?, 'book_boost', ?, ?, ?, ?)", 
            [userId, -price, currentBalance, newBalance, `Thuê cày rank: ${currentRankStr} -> ${targetRankStr}`]
        );
        
        // Log vào lịch sử cá nhân (Để khách tra cứu trong /user/history)
        await logUserHistory(userId, 'CÀY THUÊ', `Đích: ${targetRankStr}`, price, 'Đang chờ Admin', conn);

        // NỔ THÔNG BÁO REALTIME TRÊN TOÀN WEB (Chống sập bằng TRY...CATCH)
        try {
            const io = req.app.get('socketio');
            if (io) {
                let safeName = user.username;
                if (typeof maskName === 'function') safeName = maskName(user.username);
                else safeName = user.username.length > 4 ? user.username.substring(0, user.username.length - 3) + '***' : user.username + '***';

                io.emit('broadcast-activity', {
                    user: safeName,
                    action: `vừa đặt đơn cày thuê <strong>lên thẳng ${targetRankStr}</strong>`,
                    time: 'Vừa xong'
                });
            }
        } catch (socketErr) {
            console.error("Lỗi Socket Cày Thuê:", socketErr);
        }

        await conn.commit();
        res.json({ success: true, message: "Đặt đơn thành công! Vui lòng kiểm tra lại bảo mật tài khoản và chờ Cao thủ tiếp nhận đơn." });
    } catch (err) {
        await conn.rollback();
        console.error("Lỗi đặt đơn:", err);
        res.json({ success: false, message: "Hệ thống máy chủ đang bận, xin thử lại sau!" });
    } finally {
        conn.release();
    }
};