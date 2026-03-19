const db = require('../config/db');
const { maskName } = require('../utils/helpers'); 

// =========================================================================
// 1. GIAO DIỆN TRANG SĂN ACC 1Đ (KHÁCH HÀNG) - TỐI ƯU SIÊU SEO
// =========================================================================
exports.getFlashSalePage = async (req, res) => {
    try {
        // Lấy danh sách từ BẢNG MỚI (flash_sale_accounts)
        const [flashProducts] = await db.query(`
            SELECT id, title, price, image_url, status, flash_sale_time 
            FROM flash_sale_accounts 
            ORDER BY flash_sale_time ASC, status ASC
        `);

        // BỘ TỪ KHÓA SEO ĐỈNH CAO CHO SỰ KIỆN 1 ĐỒNG
        const seoKeywords = "săn acc 1đ, săn acc liên quân 1đ, mua nick liên quân 1 đồng, flash sale liên quân, shop acc 1đ, nhận acc liên quân miễn phí, nick vip 1đ, sự kiện 1k liên quân";

        // SCHEMA TỐI ƯU DẠNG SỰ KIỆN GIẢM GIÁ (SaleEvent)
        const seoSchema = {
            "@context": "https://schema.org",
            "@type": "SaleEvent",
            "name": "Sự Kiện Săn Acc Liên Quân 1 Đồng (Flash Sale)",
            "description": "Cơ hội sở hữu tài khoản Liên Quân VIP, Full Tướng, Skin SS chỉ với giá 1 VNĐ vào các khung giờ vàng.",
            "url": "https://shoplienquan.site/san-acc-1d",
            "image": "https://shoplienquan.site/images/flash-sale-banner.jpg",
            "eventStatus": "https://schema.org/EventScheduled",
            "eventAttendanceMode": "https://schema.org/OnlineEventAttendanceMode",
            "location": {
                "@type": "VirtualLocation",
                "url": "https://shoplienquan.site/san-acc-1d"
            },
            "organizer": {
                "@type": "Organization",
                "name": "ShopLienQuan.Site",
                "url": "https://shoplienquan.site"
            }
        };

        res.render(`themes/${req.theme || 'default'}/flash-sale`, {
            title: 'Săn Acc 1đ - Flash Sale Liên Quân VIP | ShopLienQuan',
            description: 'Săn tài khoản Liên Quân siêu phẩm giá 1đ vào khung giờ vàng. Cơ hội duy nhất mỗi tuần! Chuẩn bị sẵn sàng để chớp lấy siêu phẩm.',
            keywords: seoKeywords,
            schemaData: JSON.stringify(seoSchema), // Truyền Schema ra thẻ Head
            products: flashProducts,
            serverTime: Date.now(), // Truyền thời gian Server ra làm đồng hồ chống hack
            user: req.user
        });
    } catch (err) {
        console.error("Lỗi trang Flash Sale:", err);
        res.status(500).send("Lỗi tải trang Flash Sale");
    }
};

// =========================================================================
// 2. API XỬ LÝ KHI KHÁCH BẤM MUA ACC 1Đ (CHỐNG HACK, CHỐNG TOOL)
// =========================================================================
exports.buyFlashSaleAcc = async (req, res) => {
    const { productId } = req.body;
    const userId = req.user.id;

    const conn = await db.getConnection();
    await conn.beginTransaction();

    try {
        // A. KIỂM TRA TÀI KHOẢN VÀ ĐIỀU KIỆN TIỀN (Khóa dòng FOR UPDATE)
        const [users] = await conn.query("SELECT username, money, last_flash_sale_time FROM users WHERE id = ? FOR UPDATE", [userId]);
        const user = users[0];

        if (user.money < 1) {
            await conn.rollback();
            return res.json({ success: false, message: "Bạn không có đủ 1đ để tham gia săn Acc!" });
        }

        // B. KIỂM TRA ÉP NẠP 10K (Nếu đã từng săn thành công trước đó)
        if (user.last_flash_sale_time !== null) {
            const [deposits] = await conn.query(`
                SELECT SUM(amount) as total_recharge 
                FROM transaction_logs 
                WHERE user_id = ? AND type IN ('topup', 'bank_transfer', 'card', 'recharge', 'deposit') AND created_at > ?
            `, [userId, user.last_flash_sale_time]);

            const totalRecharge = deposits[0].total_recharge || 0;

            if (totalRecharge < 10000) {
                await conn.rollback();
                return res.json({ 
                    success: false, 
                    message: `Bạn đã săn 1 acc trước đó! Hãy nạp thêm ít nhất 10.000đ để tiếp tục tham gia đợt này nhé. (Đã nạp: ${new Intl.NumberFormat('vi-VN').format(totalRecharge)}đ)` 
                });
            }
        }

        // C. KHÓA DÒNG ACC TRONG BẢNG MỚI ĐỂ CHỐNG TRÙNG NGƯỜI MUA (FOR UPDATE)
        const [products] = await conn.query(`
            SELECT * FROM flash_sale_accounts 
            WHERE id = ? FOR UPDATE
        `, [productId]);

        if (products.length === 0) {
            await conn.rollback();
            return res.json({ success: false, message: "Tài khoản không tồn tại trong sự kiện này!" });
        }
        
        const product = products[0];

        // Đã bán chưa? -> ĐÃ FIX LỖI NHÁY KÉP Ở ĐÂY
        if (product.status !== 'available') {
            await conn.rollback();
            return res.json({ success: false, message: 'Rất tiếc! Acc này vừa bị người khác "bàn tay chớp nhoáng" lấy mất rồi!' });
        }

        // Tới giờ chưa? (Chống tool gọi thẳng API)
        if (new Date() < new Date(product.flash_sale_time)) {
            await conn.rollback();
            return res.json({ success: false, message: "Sếp bình tĩnh, chưa tới giờ mở bán mà! 😅" });
        }

        // D. XỬ LÝ MUA HÀNG THÀNH CÔNG
        const price = product.price || 1; 
        const newBalance = user.money - price;
        
        // 1. Trừ tiền và cập nhật mốc thời gian lần cuối mua Flash Sale
        await conn.query("UPDATE users SET money = ?, last_flash_sale_time = NOW() WHERE id = ?", [newBalance, userId]);
        
        // 2. Chuyển trạng thái Acc thành 'sold' và Ghi nhận ID người mua (buyer_id)
        await conn.query("UPDATE flash_sale_accounts SET status = 'sold', buyer_id = ? WHERE id = ?", [userId, productId]);

        // 3. Ghi Lịch sử giao dịch dòng tiền Đầy đủ cột
        await conn.query(
            "INSERT INTO transaction_logs (user_id, type, amount, old_balance, new_balance, description) VALUES (?, 'buy_acc', ?, ?, ?, ?)",
            [userId, -price, user.money, newBalance, `Săn thành công Acc Flash Sale: ${product.title}`]
        );

        await conn.commit();

        // 4. NỔ THÔNG BÁO REAL-TIME TOÀN SERVER KHI SĂN THÀNH CÔNG
        try {
            const io = req.app.get('socketio');
            if (io) {
                let safeName = user.username;
                if (typeof maskName === 'function') safeName = maskName(user.username);
                else safeName = user.username.length > 4 ? user.username.substring(0, user.username.length - 3) + '***' : user.username + '***';

                io.emit('broadcast-activity', {
                    user: safeName,
                    action: `vừa săn thành công <strong>Acc VIP 1Đ</strong> chớp nhoáng!`,
                    time: 'Vừa xong'
                });
            }
        } catch (socketErr) {
            console.error("Lỗi Socket Săn 1đ:", socketErr);
        }

        res.json({ success: true, message: "🎉 CHÚC MỪNG BẠN! Bạn đã săn thành công siêu phẩm. Vui lòng liên hệ Admin đọc tên tài khoản web để nhận Nick nhé!" });

    } catch (err) {
        await conn.rollback();
        console.error("Lỗi Săn Acc:", err);
        res.json({ success: false, message: "Hệ thống đang quá tải. Vui lòng thử lại!" });
    } finally {
        conn.release();
    }
};

// =========================================================================
// 3. GIAO DIỆN QUẢN LÝ FLASH SALE (ADMIN)
// =========================================================================
exports.getAdminFlashSale = async (req, res) => {
    try {
        // Lấy toàn bộ danh sách Acc sự kiện, kết hợp (JOIN) với bảng users để lấy tên người mua nếu đã bán
        const [accounts] = await db.query(`
            SELECT f.*, u.username as buyer_name 
            FROM flash_sale_accounts f
            LEFT JOIN users u ON f.buyer_id = u.id
            ORDER BY f.flash_sale_time DESC, f.id DESC
        `);

        res.render('admin/flash_sale_manager', {
            layout: 'admin',
            page: 'flash_sale',
            accounts: accounts,
            user: req.user
        });
    } catch (err) {
        console.error("Lỗi trang Admin Flash Sale:", err);
        res.status(500).send("Lỗi tải trang quản lý!");
    }
};

// =========================================================================
// 4. THÊM ACC VÀO SỰ KIỆN FLASH SALE (HỖ TRỢ NHÂN BẢN HÀNG LOẠT)
// =========================================================================
exports.addFlashSaleAcc = async (req, res) => {
    try {
        const { title, image_url, acc_username, acc_password, info_summary, price, flash_sale_time, quantity } = req.body;
        
        // Cài đặt mặc định nếu để trống
        const finalImage = image_url || '/images/tui-mu-dong.png';
        const finalPrice = price || 1;
        const numCopies = parseInt(quantity) || 1; // Số lượng cần nhân bản (Mặc định là 1)

        // Tạo mảng dữ liệu để nhồi hàng loạt (Bulk Insert) giúp tối ưu tốc độ VPS
        let placeholders = [];
        let values = [];

        for (let i = 0; i < numCopies; i++) {
            placeholders.push('(?, ?, ?, ?, ?, ?, ?, ?)');
            values.push(title, finalImage, acc_username, acc_password, info_summary, finalPrice, flash_sale_time, 'available');
        }

        // Chạy lệnh chèn dữ liệu
        const query = `
            INSERT INTO flash_sale_accounts 
            (title, image_url, acc_username, acc_password, info_summary, price, flash_sale_time, status) 
            VALUES ${placeholders.join(', ')}
        `;

        await db.query(query, values);

        res.redirect(`/admin/flash-sale?msg=Treo thành công ${numCopies} Acc sự kiện!`);
    } catch (err) {
        console.error("Lỗi thêm Acc Flash Sale:", err);
        res.status(500).send("Lỗi thêm dữ liệu!");
    }
};

// =========================================================================
// 5. XÓA ACC KHỎI SỰ KIỆN
// =========================================================================
exports.deleteFlashSaleAcc = async (req, res) => {
    try {
        await db.query("DELETE FROM flash_sale_accounts WHERE id = ?", [req.params.id]);
        res.redirect('/admin/flash-sale?msg=Đã xóa Acc!');
    } catch (err) {
        console.error("Lỗi xóa Acc Flash Sale:", err);
        res.status(500).send("Lỗi xóa dữ liệu!");
    }
};