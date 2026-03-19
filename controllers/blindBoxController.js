const db = require('../config/db');
const { logUserHistory } = require('../utils/historyLogger');
const { maskName } = require('../utils/helpers'); // Dùng để che tên khách khi nổ thông báo

// =========================================================================
// 1. HIỆN GIAO DIỆN CỬA HÀNG TÚI MÙ (KHÁCH HÀNG) - TỐI ƯU SIÊU SEO
// =========================================================================
exports.getStorePage = async (req, res) => {
    try {
        const [categories] = await db.query("SELECT * FROM blind_bag_categories ORDER BY price ASC");
        
        const webBags = categories.filter(c => c.type === 'web');
        const liveBags = categories.filter(c => c.type === 'live');

        // BỘ TỪ KHÓA SEO ĐỈNH CAO CHO TREND TÚI MÙ
        const seoKeywords = "túi mù liên quân, mở túi mù 9k, test nhân phẩm liên quân, vòng quay túi mù, acc liên quân 9k, mua túi mù trúng acc vip, shop túi mù uy tín, gacha liên quân";

        // SCHEMA TỐI ƯU DẠNG BỘ SƯU TẬP SẢN PHẨM (CollectionPage)
        const seoSchema = {
            "@context": "https://schema.org",
            "@type": "CollectionPage",
            "name": "Phiên Chợ Túi Mù Liên Quân - Test Nhân Phẩm",
            "description": "Thử thách nhân phẩm với phiên chợ túi mù Liên Quân Mobile. Mở túi giá rẻ trúng ngay nick VIP, nick Thách Đấu có skin SSS Tuyệt sắc.",
            "url": "https://shoplienquan.site/tui-mu",
            "publisher": {
                "@type": "Organization",
                "name": "ShopLienQuan"
            }
        };

        res.render(`themes/${req.theme || 'default'}/blind-box-store`, {
            title: 'Phiên Chợ Túi Mù Liên Quân - Test Nhân Phẩm 9K | ShopLienQuan',
            description: 'Tham gia mở túi mù Liên Quân giá chỉ từ 9k. Cơ hội 100% nhận tài khoản, tỷ lệ cao nổ hũ nick VIP có skin SS, SSS hữu hạn. Giao dịch tự động.',
            keywords: seoKeywords,
            schemaData: JSON.stringify(seoSchema), // Bơm Schema ra Header
            webBags,
            liveBags,
            user: req.user
        });
    } catch (err) {
        console.error("Lỗi tải trang cửa hàng túi mù:", err);
        res.status(500).send("Lỗi tải trang cửa hàng!");
    }
};

// =========================================================================
// 2. API XỬ LÝ KHI KHÁCH BẤM MUA TÚI MÙ (CHỐNG HACK / TOOL SPAM)
// =========================================================================
exports.buyBlindBox = async (req, res) => {
    const { category_id } = req.body;
    
    if (!req.user) {
        return res.status(401).json({ success: false, message: "Sếp cần đăng nhập để mua túi nhé!", requireLogin: true });
    }
    const userId = req.user.id;

    if (!category_id) {
        return res.json({ success: false, message: "Lỗi: Không xác định được loại túi! Vui lòng F5 tải lại trang." });
    }

    const conn = await db.getConnection();
    await conn.beginTransaction();

    try {
        const [cats] = await conn.query("SELECT * FROM blind_bag_categories WHERE id = ?", [category_id]);
        
        if (cats.length === 0) {
            await conn.rollback();
            return res.json({ success: false, message: "Túi mù này không tồn tại hoặc đã bị xóa. Vui lòng tải lại trang!" });
        }
        const category = cats[0];

        // Khóa dữ liệu người dùng (FOR UPDATE) chống tool hack âm tiền
        const [users] = await conn.query("SELECT money FROM users WHERE id = ? FOR UPDATE", [userId]);
        const currentBalance = users[0].money;
        
        if (currentBalance < category.price) {
            await conn.rollback();
            return res.json({ success: false, message: "Sếp không đủ lúa rồi, nạp thêm đi ạ!", requireRecharge: true });
        }

        // Tìm 1 nick ngẫu nhiên trong Kho và KHÓA LẠI (Chống trùng người mua)
        const [accs] = await conn.query(
            "SELECT id FROM blind_bag_accounts WHERE category_id = ? AND status = 'available' LIMIT 1 FOR UPDATE",
            [category_id]
        );
        if (accs.length === 0) {
            await conn.rollback();
            return res.json({ success: false, message: "Huhu, túi loại này vừa bị người khác mua hết. Sếp đợi Admin bơm thêm hàng nhé!" });
        }
        const accId = accs[0].id;

        // Chốt bán nick này
        await conn.query("UPDATE blind_bag_accounts SET status = 'sold' WHERE id = ?", [accId]);

        // Trừ tiền
        const newBalance = currentBalance - category.price;
        await conn.query("UPDATE users SET money = ? WHERE id = ?", [newBalance, userId]);

        // TẠO MÃ ĐƠN HÀNG THÔNG MINH (CHỐNG TRÙNG LẶP)
        const randomNum = Math.floor(1000 + Math.random() * 9000);
        const timeStr = Date.now().toString().slice(-4);
        const orderCode = `M-${timeStr}${randomNum}`; // VD: M-82345501
        
        await conn.query(
            `INSERT INTO blind_bag_orders (order_code, user_id, account_id, bag_type) VALUES (?, ?, ?, ?)`,
            [orderCode, userId, accId, category.type]
        );

        // Ghi vào lịch sử cá nhân (Xem ở Hồ Sơ)
        await logUserHistory(userId, 'TÚI MÙ', `Xé Túi: ${category.name}`, category.price, `Mã đơn: #${orderCode} (Chờ bóc)`, conn);
        
        // Ghi vào Lịch sử dòng tiền hệ thống (Báo cáo Admin)
        await conn.query(
            "INSERT INTO transaction_logs (user_id, type, amount, old_balance, new_balance, description) VALUES (?, 'buy_box', ?, ?, ?, ?)",
            [userId, -category.price, currentBalance, newBalance, `Mua Túi Mù ${category.name} (Mã: ${orderCode})`]
        );

        await conn.commit();

        res.json({
            success: true,
            orderCode: orderCode,
            type: category.type
        });

    } catch (err) {
        await conn.rollback();
        console.error("Lỗi mua túi mù:", err);
        res.json({ success: false, message: "Hệ thống máy chủ đang bận, xin thử lại sau!" });
    } finally {
        conn.release();
    }
};

// =========================================================================
// 3. GIAO DIỆN PHÒNG BÓC TÚI MÙ (KHÁCH HÀNG)
// =========================================================================
exports.getUnboxRoom = async (req, res) => {
    const orderCode = req.params.orderCode;
    try {
        const [orders] = await db.query(
            "SELECT * FROM blind_bag_orders WHERE order_code = ? AND user_id = ?", 
            [orderCode, req.user.id]
        );
        
        if (orders.length === 0) return res.redirect('/tui-mu');
        const order = orders[0];

        res.render(`themes/${req.theme || 'default'}/unbox-room`, {
            title: 'Phòng Khui Túi Mù - Hồi Hộp Chờ Kết Quả',
            order: order,
            user: req.user
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Lỗi tải phòng Unbox");
    }
};

// =========================================================================
// 4. API XỬ LÝ KHUI TÚI MÙ TRÊN WEB (NỔ THÔNG BÁO NẾU TRÚNG VIP)
// =========================================================================
exports.processUnbox = async (req, res) => {
    const { orderCode } = req.body;
    const userId = req.user.id;

    const conn = await db.getConnection();
    await conn.beginTransaction();

    try {
        const [orders] = await conn.query(`
            SELECT o.*, c.vip_drop_rate, c.name as cat_name, a.acc_username, a.acc_password, a.info_summary 
            FROM blind_bag_orders o
            JOIN blind_bag_accounts a ON o.account_id = a.id
            JOIN blind_bag_categories c ON a.category_id = c.id
            WHERE o.order_code = ? AND o.user_id = ? FOR UPDATE
        `, [orderCode, userId]);

        if (orders.length === 0) {
            await conn.rollback();
            return res.json({ success: false, message: "Không tìm thấy túi mù này hoặc túi thuộc về người khác!" });
        }
        
        const order = orders[0];

        if (order.is_opened) {
            await conn.rollback();
            return res.json({ success: false, message: "Túi này đã được bóc rồi sếp ơi! Vui lòng vào Tủ đồ để xem." });
        }

        if (order.bag_type === 'live') {
            await conn.rollback();
            return res.json({ success: false, message: "Túi này chỉ được bóc trên phiên Live Tiktok của Admin!" });
        }

        // TÍNH TOÁN NHÂN PHẨM (Tỷ lệ rớt VIP)
        const randomRoll = Math.floor(Math.random() * 100) + 1; 
        const isVipDrop = randomRoll <= order.vip_drop_rate; 

        // Lưu kết quả mở túi
        await conn.query("UPDATE blind_bag_orders SET is_opened = true, dropped_vip = ? WHERE id = ?", [isVipDrop, order.id]);

        // Nếu trúng VIP thì cộng 1 Thẻ VIP cho khách
        if (isVipDrop) {
            await conn.query("UPDATE users SET vip_cards = vip_cards + 1 WHERE id = ?", [userId]);
            
            // NỔ LOA THÔNG BÁO CHO TOÀN SERVER BIẾT CÓ NGƯỜI TRÚNG VIP!
            try {
                const io = req.app.get('socketio');
                if (io) {
                    let safeName = req.user.username;
                    if (typeof maskName === 'function') safeName = maskName(req.user.username);
                    else safeName = safeName.length > 4 ? safeName.substring(0, safeName.length - 3) + '***' : safeName + '***';

                    io.emit('broadcast-activity', {
                        user: safeName,
                        action: `vừa xé ${order.cat_name} <strong>nổ hũ nhận Acc VIP + 1 Thẻ Đặc Quyền</strong>`,
                        time: 'Vừa xong'
                    });
                }
            } catch(e) { console.error("Lỗi Socket bóc túi mù:", e); }
        }

        await conn.commit();

        res.json({
            success: true,
            account: {
                username: order.acc_username,
                password: order.acc_password,
                info: order.info_summary
            },
            isVipDrop: isVipDrop
        });

    } catch (err) {
        await conn.rollback();
        console.error("Lỗi Xé Túi:", err);
        res.json({ success: false, message: "Lỗi hệ thống khi xé túi, vui lòng F5 thử lại!" });
    } finally {
        conn.release();
    }
};

// =========================================================================
// 5. GIAO DIỆN KHO BÁU VIP VAULT (ĐỔI THẺ LẤY TIỀN) - TỐI ƯU SEO
// =========================================================================
const VIP_REWARDS = [
    { id: 'the_bac', title: 'Cộng 10.000đ vào Tài khoản', vip_price: 3, reward_money: 10000, image_url: '/images/the-bac.png' },
    { id: 'the_vang', title: 'Cộng 30.000đ vào Tài khoản', vip_price: 5, reward_money: 30000, image_url: '/images/the-vang.png' },
    { id: 'the_kim_cuong', title: 'Cộng 50.000đ vào Tài khoản', vip_price: 10, reward_money: 50000, image_url: '/images/the-kim-cuong.png' }
];

exports.getVipVault = async (req, res) => {
    try {
        res.render(`themes/${req.theme || 'default'}/vip-vault`, {
            title: 'Kho Báu VIP - Đổi Thẻ Nhận Đặc Quyền | ShopLienQuan',
            description: 'Dùng thẻ VIP rớt ra từ Túi Mù hoặc các sự kiện Minigame để đổi lấy tiền mặt cộng trực tiếp vào ví hệ thống.',
            vipProducts: VIP_REWARDS, 
            user: req.user
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Lỗi tải Kho VIP");
    }
};

// =========================================================================
// 6. API XỬ LÝ ĐỔI THẺ VIP (CỘNG TIỀN VÀO VÍ)
// =========================================================================
exports.exchangeVipAcc = async (req, res) => {
    const { itemId } = req.body;
    
    if (!req.user) return res.status(401).json({ success: false, message: "Vui lòng đăng nhập!" });
    const userId = req.user.id;

    const rewardItem = VIP_REWARDS.find(item => item.id === itemId);
    if (!rewardItem) return res.json({ success: false, message: "Vật phẩm này không tồn tại!" });

    const conn = await db.getConnection();
    await conn.beginTransaction();

    try {
        // Khóa dòng user tránh spam đổi quà liên tục
        const [users] = await conn.query("SELECT vip_cards, money FROM users WHERE id = ? FOR UPDATE", [userId]);
        const currentCards = users[0].vip_cards;
        const currentMoney = users[0].money;

        if (currentCards < rewardItem.vip_price) {
            await conn.rollback();
            return res.json({ success: false, message: `Bạn chỉ có ${currentCards} thẻ. Cần ${rewardItem.vip_price} Thẻ VIP để đổi. Hãy chơi thêm Túi Mù đi sếp!` });
        }

        const newMoney = currentMoney + rewardItem.reward_money;

        await conn.query("UPDATE users SET vip_cards = vip_cards - ?, money = ? WHERE id = ?", [rewardItem.vip_price, newMoney, userId]);

        // Ghi Log Admin
        await conn.query(
            "INSERT INTO transaction_logs (user_id, type, amount, old_balance, new_balance, description) VALUES (?, 'vip_reward', ?, ?, ?, ?)",
            [userId, rewardItem.reward_money, currentMoney, newMoney, `Đổi ${rewardItem.vip_price} Thẻ VIP nhận: ${rewardItem.title}`]
        );
        
        // Ghi Log Cá nhân
        await logUserHistory(userId, 'ĐỔI THẺ VIP', `Đổi ${rewardItem.vip_price} Thẻ lấy Tiền`, 0, `+${new Intl.NumberFormat('vi-VN').format(rewardItem.reward_money)}đ vào Ví`, conn);

        await conn.commit();

        res.json({ 
            success: true, 
            message: `Tuyệt vời! Hệ thống đã cộng ${new Intl.NumberFormat('vi-VN').format(rewardItem.reward_money)}đ vào tài khoản của bạn!`, 
            reward: rewardItem 
        });

    } catch (err) {
        await conn.rollback();
        console.error("Lỗi Đổi Thẻ VIP:", err);
        res.json({ success: false, message: "Hệ thống đang bận, xin thử lại sau!" });
    } finally {
        conn.release();
    }
};

// =========================================================================
// 7. GIAO DIỆN TỦ ĐỒ / BALO (INVENTORY) CỦA KHÁCH
// =========================================================================
exports.getInventory = async (req, res) => {
    const userId = req.user.id;

    try {
        const [users] = await db.query("SELECT vip_cards FROM users WHERE id = ?", [userId]);
        const vipCards = users[0].vip_cards;

        const [openedBags] = await db.query(`
            SELECT o.order_code, o.created_at, o.dropped_vip, a.acc_username, a.acc_password, a.info_summary, c.name as bag_name
            FROM blind_bag_orders o
            JOIN blind_bag_accounts a ON o.account_id = a.id
            JOIN blind_bag_categories c ON a.category_id = c.id
            WHERE o.user_id = ? AND o.is_opened = true
            ORDER BY o.created_at DESC
        `, [userId]);

        const [vipRewards] = await db.query(`
            SELECT description, created_at 
            FROM transaction_logs 
            WHERE user_id = ? AND type = 'vip_reward'
            ORDER BY created_at DESC
        `, [userId]);

        res.render(`themes/${req.theme || 'default'}/inventory`, {
            title: 'Tủ Đồ Cá Nhân - Balo Kho Báu Liên Quân | ShopLienQuan',
            description: 'Quản lý các tài khoản bạn đã khui từ Túi Mù, kiểm tra thẻ VIP và lịch sử nhận thưởng.',
            user: req.user,
            vipCards: vipCards,
            openedBags: openedBags,
            vipRewards: vipRewards
        });

    } catch (err) {
        console.error("Lỗi tải Tủ Đồ:", err);
        res.status(500).send("Lỗi tải trang Tủ đồ!");
    }
};

// =========================================================================
// 8. GIAO DIỆN BÀN BÓC LIVE TIKTOK (DÀNH CHO ADMIN)
// =========================================================================
exports.getLiveUnboxPage = async (req, res) => {
    try {
        res.render('admin/live-unbox', {
            layout: 'admin', 
            page: 'live-unbox',
            user: req.user
        });
    } catch (err) {
        res.status(500).send("Lỗi tải trang Live!");
    }
};

// =========================================================================
// 9. API XỬ LÝ ADMIN KHUI TÚI TRÊN PHIÊN LIVE TIKTOK
// =========================================================================
exports.processLiveUnbox = async (req, res) => {
    const { orderCode } = req.body;

    const conn = await db.getConnection();
    await conn.beginTransaction();

    try {
        const [orders] = await conn.query(`
            SELECT o.*, c.vip_drop_rate, a.info_summary 
            FROM blind_bag_orders o
            JOIN blind_bag_accounts a ON o.account_id = a.id
            JOIN blind_bag_categories c ON a.category_id = c.id
            WHERE o.order_code = ? FOR UPDATE
        `, [orderCode]);

        if (orders.length === 0) {
            await conn.rollback();
            return res.json({ success: false, message: "Mã đơn không tồn tại! Sếp check lại xem gõ đúng chưa." });
        }

        const order = orders[0];

        if (order.is_opened) {
            await conn.rollback();
            return res.json({ success: false, message: "Đơn này sếp đã khui rồi mà!" });
        }

        const randomRoll = Math.floor(Math.random() * 100) + 1;
        const isVipDrop = randomRoll <= order.vip_drop_rate;

        await conn.query("UPDATE blind_bag_orders SET is_opened = true, dropped_vip = ? WHERE id = ?", [isVipDrop, order.id]);
        
        if (isVipDrop) {
            await conn.query("UPDATE users SET vip_cards = vip_cards + 1 WHERE id = ?", [order.user_id]);
        }

        await conn.commit();

        // Bắn thông báo về máy của vị khách đã mua đơn Live này
        try {
            const io = req.app.get('socketio');
            if (io) {
                io.emit('live-unbox-alert', {
                    userId: order.user_id, // Socket phía client sẽ check xem đúng ID mình không thì mới nhận
                    message: `🎉 Đơn Túi mù [${order.order_code}] của bạn vừa được Admin khui trên Livestream! Kết quả: ${isVipDrop ? 'Trúng 1 Acc Khủng + 1 THẺ VIP' : '1 Acc Game'}. Vào Tủ đồ lấy Pass ngay!`
                });
            }
        } catch(e) {}

        res.json({
            success: true,
            infoSummary: order.info_summary,
            isVipDrop: isVipDrop
        });

    } catch (err) {
        await conn.rollback();
        console.error("Lỗi Khui Live:", err);
        res.json({ success: false, message: "Lỗi hệ thống Database!" });
    } finally {
        conn.release();
    }
};

// =========================================================================
// CÁC HÀM CÒN LẠI DÀNH CHO ADMIN (GIỮ NGUYÊN HOÀN TOÀN)
// =========================================================================
exports.getAdminManager = async (req, res) => {
    try {
        const [categories] = await db.query("SELECT * FROM blind_bag_categories ORDER BY price ASC");
        const [accounts] = await db.query(`
            SELECT a.*, c.name as category_name 
            FROM blind_bag_accounts a 
            LEFT JOIN blind_bag_categories c ON a.category_id = c.id 
            ORDER BY a.id DESC LIMIT 200
        `);
        const [vipUsers] = await db.query("SELECT id, username, vip_cards FROM users WHERE vip_cards > 0 ORDER BY vip_cards DESC");
        
        res.render('admin/blind_box_manager', {
            layout: 'admin', page: 'blind_box', categories, accounts, vipUsers, user: req.user
        });
    } catch (err) { res.status(500).send("Lỗi tải trang quản lý túi mù!"); }
};

exports.addCategory = async (req, res) => {
    try {
        const { name, price, type, vip_drop_rate, description } = req.body;
        await db.query(
            "INSERT INTO blind_bag_categories (name, price, type, vip_drop_rate, description) VALUES (?, ?, ?, ?, ?)",
            [name, price, type, vip_drop_rate, description]
        );
        res.redirect('/admin/blind-box?msg=Thêm túi thành công!');
    } catch (err) { res.status(500).send("Lỗi thêm loại túi!"); }
};

exports.deleteCategory = async (req, res) => {
    const categoryId = req.params.id;
    const conn = await db.getConnection();
    await conn.beginTransaction();
    try {
        await conn.query("DELETE FROM blind_bag_accounts WHERE category_id = ? AND status = 'available'", [categoryId]);
        await conn.query("DELETE FROM blind_bag_categories WHERE id = ?", [categoryId]);
        await conn.commit();
        res.redirect('/admin/blind-box?msg=Đã xóa túi thành công!');
    } catch (err) {
        await conn.rollback();
        res.status(500).send("Lỗi xóa loại túi! Có thể do dính lịch sử đơn hàng.");
    } finally { conn.release(); }
};

exports.addAccount = async (req, res) => {
    try {
        const { category_id, account_data } = req.body;
        if (!category_id) return res.redirect(`/admin/blind-box?msg=${encodeURIComponent("Chưa chọn phân loại túi mù!")}`);
        if (!account_data || account_data.trim() === '') return res.redirect(`/admin/blind-box?msg=${encodeURIComponent("Chưa nhập thông tin nick!")}`);

        const lines = account_data.split(/\r?\n/);
        let successCount = 0;
        
        for(let line of lines) {
            if(line.trim() !== '') {
                const parts = line.split('|');
                if(parts.length >= 2) {
                    const user = parts[0].trim();
                    const pass = parts[1].trim();
                    const info = parts.length >= 3 ? parts[2].trim() : 'Acc Random VIP';
                    
                    await db.query(
                        "INSERT INTO blind_bag_accounts (category_id, acc_username, acc_password, info_summary, status) VALUES (?, ?, ?, ?, 'available')",
                        [category_id, user, pass, info]
                    );
                    successCount++;
                }
            }
        }
        res.redirect(`/admin/blind-box?msg=${encodeURIComponent(`Thêm thành công ${successCount} Acc vào túi!`)}`);
    } catch (err) { res.redirect(`/admin/blind-box?msg=${encodeURIComponent("Lỗi Database khi nạp nick!")}`); }
};

exports.deleteAccount = async (req, res) => {
    try {
        await db.query("DELETE FROM blind_bag_accounts WHERE id = ?", [req.params.id]);
        res.redirect('/admin/blind-box');
    } catch (err) { res.status(500).send("Lỗi xóa Acc!"); }
};

exports.bulkDeleteAccounts = async (req, res) => {
    try {
        const { category_id, delete_type } = req.body; 
        let query = "DELETE FROM blind_bag_accounts WHERE 1=1";
        let params = [];

        if (category_id && category_id !== 'all') { query += " AND category_id = ?"; params.push(category_id); }
        if (delete_type !== 'all') { query += " AND status = ?"; params.push(delete_type); }

        const [result] = await db.query(query, params);
        res.redirect(`/admin/blind-box?msg=${encodeURIComponent(`Đã dọn dẹp thành công ${result.affectedRows} Acc khỏi kho!`)}`);
    } catch (err) { res.redirect(`/admin/blind-box?msg=${encodeURIComponent("Lỗi máy chủ khi dọn dẹp kho!")}`); }
};

exports.updateVipCards = async (req, res) => {
    try {
        const { user_id, amount, action } = req.body;
        const amt = parseInt(amount) || 1;

        if (action === 'add') await db.query("UPDATE users SET vip_cards = vip_cards + ? WHERE id = ?", [amt, user_id]);
        else if (action === 'sub') await db.query("UPDATE users SET vip_cards = GREATEST(0, vip_cards - ?) WHERE id = ?", [amt, user_id]);

        res.redirect('/admin/blind-box?msg=Cập nhật Thẻ VIP thành công!');
    } catch (err) { res.redirect('/admin/blind-box?msg=Lỗi khi cập nhật thẻ VIP!'); }
};