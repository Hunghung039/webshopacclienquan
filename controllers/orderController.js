const db = require('../config/db');
const { maskName } = require('../utils/helpers'); // Đảm bảo sếp có hàm này trong helpers
const { logUserHistory } = require('../utils/historyLogger');

// =========================================================================
// 1. API XỬ LÝ MUA TÀI KHOẢN (POST) - CÓ TRANSACTION & CHỐNG HACK
// =========================================================================
exports.buyAccount = async (req, res) => {
    const { productId, productTitle, contact } = req.body;
    const userId = req.user ? req.user.id : null; 

    // --- BẮT BUỘC ĐĂNG NHẬP ---
    if (!userId) {
        return res.status(401).json({ 
            success: false,
            message: "Bạn cần đăng nhập để mua Acc!", 
            requireLogin: true // Cờ để Frontend biết đường hiển thị form Đăng nhập
        });
    }

    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
        // 1. Tìm Acc và KHÓA dòng này lại (FOR UPDATE) để chống 2 người mua cùng lúc
        let query = "SELECT * FROM products WHERE status = 'available' ";
        let params = [];
        
        if (productId) {
            query += "AND id = ? FOR UPDATE";
            params.push(productId);
        } else if (productTitle) {
            query += "AND title = ? FOR UPDATE";
            params.push(productTitle);
        } else {
            throw new Error("Dữ liệu sản phẩm không hợp lệ");
        }

        const [products] = await connection.query(query, params);
        
        if (products.length === 0) {
            await connection.rollback();
            return res.status(400).json({ success: false, message: "Trễ mất rồi! Acc này vừa có người mua." });
        }
        const product = products[0];

        // 2. Lấy dữ liệu User (FOR UPDATE để chống hack xài tool mua nhiều acc cùng lúc)
        const [users] = await connection.query("SELECT money, username FROM users WHERE id = ? FOR UPDATE", [userId]);
        const userMoney = users[0].money;
        const username = users[0].username;

        if (userMoney < product.price_new) {
            await connection.rollback();
            // Trả cờ requireRecharge để Frontend tự động cuộn xuống khu vực nạp thẻ
            return res.status(400).json({ 
                success: false,
                message: `Số dư không đủ! Vui lòng nạp thêm ${new Intl.NumberFormat('vi-VN').format(product.price_new - userMoney)}đ.`, 
                requireRecharge: true 
            });
        }

        // 3. Xử lý trừ tiền
        const newBalance = userMoney - product.price_new;
        await connection.query("UPDATE users SET money = ? WHERE id = ?", [newBalance, userId]);
        
        // 4. Ghi log dòng tiền (Báo cáo admin)
        await connection.query(
            "INSERT INTO transaction_logs (user_id, type, amount, old_balance, new_balance, description) VALUES (?, 'buy_acc', ?, ?, ?, ?)", 
            [userId, -product.price_new, userMoney, newBalance, `Mua Acc #${product.id} - ${product.title}`]
        );

        // 5. Tạo đơn hàng (Xuất mã game cho khách)
        await connection.query(
            "INSERT INTO acc_orders (user_id, product_id, buyer_contact) VALUES (?, ?, ?)", 
            [userId, product.id, contact || 'User đã đăng nhập']
        );

        // 6. Ghi vào lịch sử tài khoản của khách
        await logUserHistory(userId, 'MUA_ACC', `Mua tài khoản: ${product.title}`, product.price_new, `Tài khoản: ${product.acc_username}`, connection);
        
        // 7. Đổi trạng thái acc thành "Đã bán"
        await connection.query("UPDATE products SET status = 'sold' WHERE id = ?", [product.id]);
        
        // Hoàn tất giao dịch Database
        await connection.commit();

        // 8. Bắn sự kiện Socket Real-time cho mọi người xem (An toàn, không bị treo API nếu Socket lỗi)
        try {
            const io = req.app.get('socketio');
            if (io) {
                // Che mờ tên trước khi phát thông báo
                let safeName = username;
                if (typeof maskName === 'function') { safeName = maskName(username); } 
                else { safeName = username.length > 4 ? username.substring(0, username.length - 3) + '***' : username + '***'; }

                io.emit('broadcast-activity', {
                    user: safeName,
                    action: `vừa chốt đơn Acc #${product.id} (${new Intl.NumberFormat('vi-VN').format(product.price_new)}đ)`,
                    time: 'Vừa xong'
                });
            }
        } catch (socketErr) { console.error("Lỗi Socket:", socketErr); }

        res.json({ success: true, message: "Mua thành công! Vui lòng kiểm tra Tài khoản & Mật khẩu trong Hồ Sơ." });

    } catch (err) {
        await connection.rollback();
        console.error("Lỗi giao dịch mua Acc:", err);
        res.status(500).json({ success: false, message: "Lỗi hệ thống máy chủ. Vui lòng thử lại sau!" });
    } finally {
        connection.release();
    }
};

// =========================================================================
// 2. TRANG LỊCH SỬ MUA HÀNG (GET) - TỐI ƯU SEO & SCHEMA CHO PAGE
// =========================================================================
exports.getPurchaseHistory = async (req, res) => {
    try {
        const theme = req.theme || 'default';
        const userId = req.user.id;

        // Lấy danh sách acc đã mua
        const [orders] = await db.query(`
            SELECT o.*, p.title, p.acc_username, p.acc_password, p.image_url 
            FROM acc_orders o 
            JOIN products p ON o.product_id = p.id 
            WHERE o.user_id = ? 
            ORDER BY o.created_at DESC
        `, [userId]);

        // CẤU HÌNH TỪ KHÓA SEO CHO TRANG LỊCH SỬ
        const seoKeywords = "lịch sử mua acc liên quân, tài khoản liên quân đã mua, shop liên quân uy tín, kiểm tra đơn hàng acc liên quân, bảo hành acc liên quân";

        // SCHEMA TỐI ƯU (Dạng CollectionPage cho danh sách đơn hàng)
        const seoSchema = {
            "@context": "https://schema.org",
            "@type": "CollectionPage",
            "name": "Lịch Sử Mua Tài Khoản Liên Quân",
            "description": "Quản lý và lấy mật khẩu các tài khoản Liên Quân Mobile bạn đã mua tại Shop.",
            "url": `https://shoplienquan.site/user/history`,
            "isPartOf": {
                "@type": "WebSite",
                "name": "ShopLienQuan",
                "url": "https://shoplienquan.site/"
            }
        };

        res.render(`themes/${theme}/purchase_history`, {
            title: 'Lịch Sử Mua Acc - Shop Liên Quân Uy Tín',
            description: 'Tra cứu thông tin tài khoản và mật khẩu các nick Liên Quân Mobile bạn đã thanh toán. Giao dịch minh bạch, bảo hành dài hạn.',
            keywords: seoKeywords,
            schemaData: JSON.stringify(seoSchema), // Đẩy Schema ra thẻ Head
            orders: orders,
            user: req.user
        });

    } catch (err) {
        console.error("Lỗi getPurchaseHistory:", err);
        res.status(500).send("Lỗi tải trang lịch sử mua hàng!");
    }
};
// =========================================================================
// 3. API XỬ LÝ MUA GÓI SỰ KIỆN (CHUNG SỨC HẢO VẬN, RƯƠNG VIP...)
// =========================================================================
exports.joinEvent = async (req, res) => {
    const { pack_id, account_user, account_pass, note } = req.body;
    const userId = req.user ? req.user.id : null;

    if (!userId) {
        return res.status(401).json({ success: false, message: "Vui lòng đăng nhập để đặt đơn!", requireLogin: true });
    }

    // Cấu hình giá gói (Khớp với cài đặt ở trang chủ)
    const packs = {
        'full_1000': { name: 'Gói Full 1000 Điểm', price: 40000 },
        'part_200': { name: 'Gói Lẻ 200 Điểm', price: 20000 }
    };

    const selectedPack = packs[pack_id];
    if (!selectedPack) {
        return res.json({ success: false, message: "Gói sự kiện không hợp lệ!" });
    }

    if (!account_user || !account_pass) {
        return res.json({ success: false, message: "Vui lòng nhập Tài khoản và Mật khẩu game!" });
    }

    const conn = await db.getConnection();
    await conn.beginTransaction();

    try {
        // Khóa dòng user để tránh bug âm tiền
        const [users] = await conn.query("SELECT money, username FROM users WHERE id = ? FOR UPDATE", [userId]);
        const user = users[0];
        const currentBalance = user.money;

        if (currentBalance < selectedPack.price) {
            await conn.rollback();
            return res.json({ 
                success: false, 
                message: `Số dư không đủ! Cần ${new Intl.NumberFormat('vi-VN').format(selectedPack.price)}đ để mua gói này.`, 
                requireRecharge: true 
            });
        }

        const newBalance = currentBalance - selectedPack.price;
        await conn.query("UPDATE users SET money = ? WHERE id = ?", [newBalance, userId]);

        // Ghép Pass và Ghi chú
        const finalPass = note ? `${account_pass} | LƯU Ý: ${note}` : account_pass;

        // Thêm vào bảng đơn sự kiện (event_orders)
        await conn.query(
            "INSERT INTO event_orders (user_id, pack_id, pack_name, price, account_user, account_pass, status) VALUES (?, ?, ?, ?, ?, ?, 'pending')",
            [userId, pack_id, selectedPack.name, selectedPack.price, account_user, finalPass]
        );

        // Ghi log dòng tiền
        await conn.query(
            "INSERT INTO transaction_logs (user_id, type, amount, old_balance, new_balance, description) VALUES (?, 'join_event', ?, ?, ?, ?)",
            [userId, -selectedPack.price, currentBalance, newBalance, `Mua sự kiện: ${selectedPack.name}`]
        );

        // Ghi lịch sử cá nhân
        await logUserHistory(userId, 'SỰ KIỆN', selectedPack.name, selectedPack.price, 'Đang chờ Admin xử lý', conn);

        await conn.commit();

        // Bắn Socket thông báo toàn Server
        try {
            const io = req.app.get('socketio');
            if (io) {
                let safeName = user.username;
                if (typeof maskName === 'function') safeName = maskName(user.username);
                else safeName = user.username.length > 4 ? user.username.substring(0, user.username.length - 3) + '***' : user.username + '***';

                io.emit('broadcast-activity', {
                    user: safeName,
                    action: `vừa đặt thành công <strong>${selectedPack.name}</strong>`,
                    time: 'Vừa xong'
                });
            }
        } catch(e) { console.error("Lỗi socket sự kiện:", e); }

        res.json({ success: true, message: "Đặt đơn sự kiện thành công! Cày thuê sẽ sớm vào acc của bạn." });
        
    } catch (err) {
        await conn.rollback();
        console.error("Lỗi đặt đơn sự kiện:", err);
        res.json({ success: false, message: "Hệ thống đang bận, xin thử lại sau!" });
    } finally {
        conn.release();
    }
};