const db = require('../config/db');
const { logUserHistory } = require('../utils/historyLogger');

exports.getRentPage = async (req, res) => {
    try {
        const { skin } = req.query;

        // Nhả acc tự động nếu hết giờ
        await db.query("UPDATE rent_accounts SET status = 'available', available_at = NULL WHERE status = 'rented' AND available_at <= NOW()");

        // Lấy 2 gói thuê để hiển thị lên Form
        const [packages] = await db.query("SELECT * FROM rent_settings ORDER BY id ASC");

        let queryAvailable = "SELECT * FROM rent_accounts WHERE status = 'available'";
        let params = [];
        if (skin) {
            queryAvailable += " AND skins LIKE ?";
            params.push(`%${skin}%`);
        }
        queryAvailable += " ORDER BY id DESC";

        const [availableAccs] = await db.query(queryAvailable, params);
        const [rentedAccs] = await db.query("SELECT * FROM rent_accounts WHERE status = 'rented' ORDER BY available_at ASC");

        // BỘ DỮ LIỆU SEO & SCHEMA CHUẨN GOOGLE 2026
        const seoSchema = {
            "@context": "https://schema.org",
            "@type": "Product",
            "name": "Dịch Vụ Thuê Acc Liên Quân Mobile VIP",
            "description": "Thuê acc Liên Quân full tướng, full skin hiếm (Nakroth Thứ Nguyên Vệ Thần, Raz Muay Thái, SS Tuyệt Sắc) giá rẻ chỉ từ 5K.",
            "image": "https://cdn.tgdd.vn/2021/11/GameApp/lienquan-1-800x450.jpg",
            "brand": { "@type": "Brand", "name": "ShopLienQuan" },
            "offers": {
                "@type": "AggregateOffer",
                "lowPrice": "5000",
                "highPrice": "10000",
                "priceCurrency": "VND",
                "offerCount": availableAccs.length > 0 ? availableAccs.length : 1,
                "availability": "https://schema.org/InStock"
            },
            "aggregateRating": {
                "@type": "AggregateRating",
                "ratingValue": "4.9",
                "reviewCount": "1589"
            }
        };

        const seoKeywords = "thuê acc liên quân, thue acc lq, thuê acc liên quân giá rẻ, thuê acc liên quân 5k, thuê acc liên quân full tướng full skin, thuê nick liên quân có nakroth thứ nguyên vệ thần, thuê acc lq uy tín";

        res.render(`themes/${req.theme || 'default'}/thue-acc`, {
            title: 'Thuê Acc Liên Quân Giá rẻ-Thuê acc liên quân| Dịch vụ thuê acc game theo giờ',
            description: 'shop liên quân,shoplienquan Dịch vụ cho thuê nick Liên Quân giá học sinh chỉ từ 5.000đ. Đầy đủ các skin SS, Tuyệt Sắc. Bảo mật 100%, không bị giành acc.',
            keywords: seoKeywords,
            schemaData: JSON.stringify(seoSchema), // Truyền schema ra ngoài
            availableAccs, 
            rentedAccs, 
            packages, 
            user: req.user, 
            query: req.query
        });
       
    } catch (err) {
        console.error(err);
        res.status(500).send("Lỗi tải trang");
    }
};

exports.bookRent = async (req, res) => {
    const { account_id, package_id } = req.body;
    const userId = req.user.id;

    if (!account_id || !package_id) return res.json({ success: false, message: "Vui lòng chọn gói thuê!" });

    const conn = await db.getConnection();
    await conn.beginTransaction();

    try {
        const [pkgs] = await conn.query("SELECT * FROM rent_settings WHERE id = ?", [package_id]);
        if (pkgs.length === 0) throw new Error("Gói thuê không tồn tại!");
        const rentHours = pkgs[0].hours;
        const totalPrice = pkgs[0].price;

        const [accs] = await conn.query("SELECT * FROM rent_accounts WHERE id = ? FOR UPDATE", [account_id]);
        if (accs.length === 0) throw new Error("Acc không tồn tại!");
        const acc = accs[0];
        if (acc.status === 'rented') {
            await conn.rollback();
            return res.json({ success: false, message: "Acc này vừa có người thuê mất rồi!" });
        }

        const [users] = await conn.query("SELECT money FROM users WHERE id = ? FOR UPDATE", [userId]);
        if (users[0].money < totalPrice) {
            await conn.rollback();
            return res.json({ success: false, message: `Bạn cần ${new Intl.NumberFormat('vi-VN').format(totalPrice)}đ để thuê gói này!` });
        }

        const newBalance = users[0].money - totalPrice;
        await conn.query("UPDATE users SET money = ? WHERE id = ?", [newBalance, userId]);
        await conn.query("UPDATE rent_accounts SET status = 'rented', available_at = DATE_ADD(NOW(), INTERVAL ? HOUR) WHERE id = ?", [rentHours, account_id]);

        await conn.query(
            "INSERT INTO rent_orders (user_id, account_id, hours_rented, total_price, start_time, end_time) VALUES (?, ?, ?, ?, NOW(), DATE_ADD(NOW(), INTERVAL ? HOUR))",
            [userId, account_id, rentHours, totalPrice, rentHours]
        );

        await conn.query("INSERT INTO transaction_logs (user_id, type, amount, old_balance, new_balance, description) VALUES (?, 'rent_acc', ?, ?, ?, ?)", [userId, -totalPrice, users[0].money, newBalance, `Thuê acc #${account_id} trong ${rentHours} giờ`]);
        await logUserHistory(userId, 'THUÊ ACC', `Thuê acc #${account_id} (${rentHours}h)`, totalPrice, 'Đã thanh toán', conn);

        await conn.commit();
        res.json({ success: true, data: { acc_title: acc.title, hours: rentHours, skins: acc.skins }});
    } catch (err) {
        await conn.rollback();
        res.json({ success: false, message: "Lỗi hệ thống!" });
    } finally { conn.release(); }
};