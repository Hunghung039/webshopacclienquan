const db = require('../config/db');
const { createSlug } = require('../utils/seoHelper');
const bcrypt = require('bcryptjs');
const cryptoHelper = require('../utils/cryptoHelper');
const fs = require('fs');
const path = require('path');
const notifyGoogle = require('../utils/googleIndexing'); 
const os = require('os');

const DOMAIN = process.env.BASE_URL || 'https://shoplienquan.site';
// ============================================================
// 1. TRANG DASHBOARD (THỐNG KÊ TỔNG HỢP VÀ LỌC THEO GIỜ/PHÚT)
// ============================================================
exports.getDashboard = async (req, res) => {
    try {
        // --- XỬ LÝ LỌC ĐẾN TỪNG GIỜ TỪNG PHÚT ---
        const { start_time, end_time } = req.query;
        let dateCondition = "";
        let queryParams = [];

        if (start_time && end_time) {
            // HTML datetime-local trả về dạng: "YYYY-MM-DDTHH:mm"
            // Ta cần chuyển T thành dấu cách và thêm giây vào để chuẩn form MySQL "YYYY-MM-DD HH:mm:ss"
            let formattedStart = start_time.replace('T', ' ');
            let formattedEnd = end_time.replace('T', ' ');

            // Nếu người dùng không nhập giây, tự động bù giây
            if (formattedStart.length === 16) formattedStart += ':00';
            if (formattedEnd.length === 16) formattedEnd += ':59'; // Lấy đến giây 59 của phút đó

            dateCondition = " AND t.created_at >= ? AND t.created_at <= ?";
            queryParams = [formattedStart, formattedEnd];
        }

        // Biến phụ cho các bảng khác (VD: bảng đơn hàng o, sự kiện e)
        let dateConditionO = dateCondition.replace(/t\.created_at/g, 'o.created_at');
        let dateConditionE = dateCondition.replace(/t\.created_at/g, 'e.created_at');

        // --- 1. THỐNG KÊ DÒNG TIỀN (LỌC THEO GIỜ CHỌN) ---
        const [realDeposit] = await db.query(`
            SELECT SUM(t.amount) as total 
            FROM transaction_logs t JOIN users u ON t.user_id = u.id
            WHERE t.type IN ('topup', 'bank_transfer', 'card', 'recharge') 
            AND t.amount > 0 AND u.role != 'admin' ${dateCondition}
        `, queryParams);

        const [adminDeposit] = await db.query(`
            SELECT SUM(t.amount) as total 
            FROM transaction_logs t JOIN users u ON t.user_id = u.id
            WHERE t.type IN ('admin_add', 'admin_adjust') 
            AND t.amount > 0 AND u.role != 'admin' ${dateCondition}
        `, queryParams);

        const [totalSpent] = await db.query(`
            SELECT SUM(ABS(t.amount)) as total 
            FROM transaction_logs t JOIN users u ON t.user_id = u.id
            WHERE t.amount < 0 AND t.type NOT IN ('refund', 'admin_adjust') 
            AND u.role != 'admin' ${dateCondition}
        `, queryParams);

        // --- 2. THỐNG KÊ CHI TIẾT TÚI MÙ (LỌC THEO GIỜ CHỌN) ---
        const [blindBoxStats] = await db.query(`
            SELECT c.name as bag_name, c.price as unit_price, COUNT(o.id) as total_sold, SUM(c.price) as total_revenue
            FROM blind_bag_orders o
            JOIN blind_bag_accounts a ON o.account_id = a.id
            JOIN blind_bag_categories c ON a.category_id = c.id
            JOIN users u ON o.user_id = u.id
            WHERE u.role != 'admin' ${dateConditionO}
            GROUP BY c.id, c.name, c.price
            ORDER BY c.price ASC
        `, queryParams);

        // --- 3. THỐNG KÊ GIEO QUẺ (LỌC THEO GIỜ CHỌN) ---
        const [xinxamStats] = await db.query(`
            SELECT COUNT(t.id) as total_sold, SUM(ABS(t.amount)) as total_revenue
            FROM transaction_logs t JOIN users u ON t.user_id = u.id
            WHERE t.type = 'buy_xinxam' AND u.role != 'admin' ${dateCondition}
        `, queryParams);

        // --- 4. THỐNG KÊ CÀY THUÊ & THUÊ ACC ---
        const [boostStats] = await db.query(`
            SELECT COUNT(t.id) as total_sold, SUM(ABS(t.amount)) as total_revenue
            FROM transaction_logs t JOIN users u ON t.user_id = u.id
            WHERE t.type = 'book_boost' AND u.role != 'admin' ${dateCondition}
        `, queryParams);

        const [rentAccStats] = await db.query(`
            SELECT COUNT(t.id) as total_sold, SUM(ABS(t.amount)) as total_revenue
            FROM transaction_logs t JOIN users u ON t.user_id = u.id
            WHERE t.type = 'rent_acc' AND u.role != 'admin' ${dateCondition}
        `, queryParams);

        // --- 5. THỐNG KÊ KHO VÀ USER (Tổng chung) ---
        const [users] = await db.query("SELECT COUNT(id) as count FROM users WHERE role != 'admin'");
        const [products] = await db.query("SELECT COUNT(id) as count FROM products WHERE status = 'available'");
        const [totalMoneyInSystem] = await db.query("SELECT SUM(money) as total FROM users WHERE role != 'admin'");

        // --- 6. LỊCH SỬ GIAO DỊCH THEO THỜI GIAN ĐÃ LỌC ---
        const [recentActivities] = await db.query(`
            SELECT CAST(u.username AS CHAR) as username, CAST('MUA_ACC' AS CHAR) as act_type, CAST(COALESCE(p.title, 'Tài khoản') AS CHAR) as detail, -p.price_new as amount, o.created_at
            FROM acc_orders o JOIN users u ON o.user_id = u.id LEFT JOIN products p ON o.product_id = p.id WHERE u.role != 'admin' ${dateConditionO}
            UNION ALL
            SELECT CAST(u.username AS CHAR) as username, CAST(t.type AS CHAR) as act_type, CAST(t.description AS CHAR) as detail, t.amount, t.created_at
            FROM transaction_logs t JOIN users u ON t.user_id = u.id WHERE u.role != 'admin' ${dateCondition}
            UNION ALL
            SELECT CAST(u.username AS CHAR) as username, CAST('EVENT_ORDER' AS CHAR) as act_type, CAST(CONCAT('Đơn dịch vụ/Sự kiện #', e.id) AS CHAR) as detail, -e.price as amount, e.created_at
            FROM event_orders e JOIN users u ON e.user_id = u.id WHERE u.role != 'admin' ${dateConditionE}
            ORDER BY created_at DESC LIMIT 500
        `, [...queryParams, ...queryParams, ...queryParams]);

        const statData = {
            autoDeposit: realDeposit[0].total || 0,
            manualDeposit: adminDeposit[0].total || 0,
            profitTotal: totalSpent[0].total || 0, 
            userCount: users[0].count || 0,
            productCount: products[0].count || 0,
            totalMoneyInSystem: totalMoneyInSystem[0].total || 0
        };

        res.render('admin/dashboard', {
            layout: 'admin',
            page: 'dashboard',
            stats: statData,
            blindBoxStats: blindBoxStats, 
            xinxamStats: xinxamStats[0],
            boostStats: boostStats[0],
            rentAccStats: rentAccStats[0],
            recentActivities: recentActivities,
            vpsStats: req.vpsStats,
            user: req.user,
            queryFilters: req.query 
        });
    } catch (err) {
        console.error("Lỗi Dashboard:", err);
        res.status(500).send("Lỗi tải Dashboard");
    }
};
// ============================================================
// 2. QUẢN LÝ SẢN PHẨM (ACC GAME)
// ============================================================
exports.getProducts = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 20;
        const offset = (page - 1) * limit;

        const [countResult] = await db.query("SELECT COUNT(*) as total FROM products");
        const totalProducts = countResult[0].total;
        const totalPages = Math.ceil(totalProducts / limit);

        const [products] = await db.query("SELECT * FROM products ORDER BY id DESC LIMIT ? OFFSET ?", [limit, offset]);

        res.render('admin/products', { 
            page: 'products', 
            products: products, 
            pagination: { page: page, totalPages: totalPages },
            user: req.user 
        });
    } catch (err) {
        console.error("Lỗi lấy danh sách sản phẩm:", err);
        res.status(500).send("Lỗi Server Admin");
    }
};

exports.createProduct = async (req, res) => {
    try {
        const { title, category, price_old, price_new, acc_username, acc_password, description_text } = req.body;
        
        const image_url = req.file ? `/images/${req.file.filename}` : '/images/default.jpg';

        let detailsObj = {};
        if (description_text) {
            const lines = description_text.split(/\r?\n/);
            lines.forEach(line => {
                if (line.includes(':')) {
                    const parts = line.split(':');
                    const key = parts[0].trim();
                    const val = parts.slice(1).join(':').trim();
                    if (key && val) detailsObj[key] = val;
                }
            });
        }
        const detailsJson = JSON.stringify(detailsObj);
        const encryptedAccPassword = cryptoHelper.encrypt(acc_password);
        const slug = createSlug(title) + '-' + Date.now(); 

        const sql = `INSERT INTO products (title, slug, category, price_old, price_new, image_url, acc_username, acc_password, details, status) 
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'available')`;
        
        await db.query(sql, [title, slug, category, price_old, price_new, image_url, acc_username, encryptedAccPassword, detailsJson]);
        
        notifyGoogle(`${DOMAIN}/chi-tiet/${slug}`, 'URL_UPDATED');

        res.redirect('/admin/products'); 
    } catch (err) {
        console.error(err);
        res.status(500).send("Lỗi thêm sản phẩm: " + err.message);
    }
};

exports.deleteProduct = async (req, res) => {
    try {
        const productId = req.params.id;
        const [products] = await db.query("SELECT * FROM products WHERE id = ?", [productId]);
        if (products.length === 0) return res.redirect('/admin/products?message=Không tìm thấy sản phẩm!&type=error');
        
        const product = products[0];

        if (product.status === 'sold') {
            const [orders] = await db.query("SELECT created_at FROM acc_orders WHERE product_id = ? ORDER BY created_at DESC LIMIT 1", [productId]);
            if (orders.length > 0) {
                const soldDate = new Date(orders[0].created_at);
                const diffTime = Math.abs(new Date() - soldDate);
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 

                if (diffDays < 30) {
                    return res.redirect(`/admin/products?message=Tài khoản này đã bán được ${diffDays} ngày. Chỉ được xóa sau 1 tháng!&type=error`);
                }
            }
        }

        await db.query("DELETE FROM acc_orders WHERE product_id = ?", [productId]);

        if (product.image_url) {
            const cleanPath = product.image_url.startsWith('/') ? product.image_url.substring(1) : product.image_url;
            const imagePath = path.join(__dirname, '../public', cleanPath);
            if (fs.existsSync(imagePath)) {
                fs.unlinkSync(imagePath);
            }
        }

        await db.query("DELETE FROM products WHERE id = ?", [productId]);
        notifyGoogle(`${DOMAIN}/chi-tiet/${product.slug}`, 'URL_DELETED');

        return res.redirect('/admin/products?message=Xóa Acc và Dọn dẹp ảnh thành công!&type=success');
    } catch (err) {
        console.error("Lỗi xóa sản phẩm:", err);
        return res.redirect('/admin/products?message=Lỗi hệ thống khi xóa sản phẩm!&type=error');
    }
};

exports.getProductEdit = async (req, res) => {
    try {
        const [products] = await db.query("SELECT * FROM products WHERE id = ?", [req.params.id]);
        if (products.length === 0) return res.redirect('/admin/products');

        let product = products[0];
        try { product.acc_password = cryptoHelper.decrypt(product.acc_password); } catch(e) {}

        let descText = "";
        try {
            let detailsObj = JSON.parse(product.details);
            for (let key in detailsObj) {
                descText += `${key}: ${detailsObj[key]}\n`;
            }
        } catch(e) {}
        product.description_text = descText;

        res.render('admin/product_edit', { product: product, user: req.user, page: 'products' });
    } catch (err) { res.status(500).send("Lỗi server"); }
};

exports.updateProduct = async (req, res) => {
    try {
        const productId = req.params.id;
        const { title, category, price_old, price_new, acc_username, acc_password, description_text } = req.body;

        const [oldProducts] = await db.query("SELECT image_url, slug FROM products WHERE id = ?", [productId]);
        if (oldProducts.length === 0) return res.redirect('/admin/products');
        const oldProduct = oldProducts[0];

        let newImageUrl = oldProduct.image_url;
        if (req.file) {
            newImageUrl = `/images/${req.file.filename}`;
            if (oldProduct.image_url) {
                const cleanPath = oldProduct.image_url.startsWith('/') ? oldProduct.image_url.substring(1) : oldProduct.image_url;
                const oldPath = path.join(__dirname, '../public', cleanPath);
                if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
            }
        }

        let detailsObj = {};
        if (description_text) {
            const lines = description_text.split(/\r?\n/);
            lines.forEach(line => {
                if (line.includes(':')) {
                    const parts = line.split(':');
                    const key = parts[0].trim();
                    const val = parts.slice(1).join(':').trim();
                    if (key && val) detailsObj[key] = val;
                }
            });
        }
        const detailsJson = JSON.stringify(detailsObj);
        const encryptedAccPassword = cryptoHelper.encrypt(acc_password);

        await db.query(
            `UPDATE products SET title=?, category=?, price_old=?, price_new=?, image_url=?, acc_username=?, acc_password=?, details=? WHERE id=?`,
            [title, category, price_old, price_new, newImageUrl, acc_username, encryptedAccPassword, detailsJson, productId]
        );

        notifyGoogle(`${DOMAIN}/chi-tiet/${oldProduct.slug}`, 'URL_UPDATED');
        res.redirect('/admin/products?message=Cập nhật Acc thành công!&type=success');

    } catch (err) {
        console.error("Lỗi cập nhật Acc:", err);
        res.status(500).send("Lỗi server khi cập nhật");
    }
};

// ============================================================
// 3. QUẢN LÝ ĐƠN HÀNG 
// ============================================================
exports.getOrders = async (req, res) => {
    try {
        const [accOrders] = await db.query(`SELECT o.id, u.username, p.title, p.price_new, p.acc_username, p.acc_password, o.created_at FROM acc_orders o JOIN users u ON o.user_id = u.id JOIN products p ON o.product_id = p.id ORDER BY o.created_at DESC`);
        const [eventOrders] = await db.query(`SELECT e.*, u.username FROM event_orders e JOIN users u ON e.user_id = u.id ORDER BY e.created_at DESC`);
        res.render('admin/orders', { user: req.user, accOrders: accOrders, eventOrders: eventOrders, page: 'orders' });
    } catch (err) { res.status(500).send("Lỗi lấy danh sách đơn hàng"); }
};

exports.updateEventOrder = async (req, res) => {
    const { orderId, status, note } = req.body; 
    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
        const [orders] = await connection.query("SELECT * FROM event_orders WHERE id = ? FOR UPDATE", [orderId]);
        if (orders.length === 0) {
            await connection.rollback();
            return res.status(404).json({ message: "Đơn hàng không tồn tại!" });
        }
        const order = orders[0];

        if (order.status === 'completed' || order.status === 'cancelled') {
            await connection.rollback();
            return res.status(400).json({ message: "Đơn này đã kết thúc, không thể sửa!" });
        }

        if (status === 'cancelled') {
            if (!note) {
                await connection.rollback();
                return res.status(400).json({ message: "Vui lòng nhập lý do hủy đơn!" });
            }
            await connection.query("SELECT money FROM users WHERE id = ? FOR UPDATE", [order.user_id]);
            await connection.query("UPDATE users SET money = money + ? WHERE id = ?", [order.price, order.user_id]);
            await connection.query("UPDATE event_orders SET status = 'cancelled', admin_note = ? WHERE id = ?", [note, orderId]);
            await connection.query(`INSERT INTO transaction_logs (user_id, type, amount, description) VALUES (?, 'refund', ?, ?)`, [order.user_id, order.price, `Hoàn tiền đơn #${order.id}. Lý do: ${note}`]);
        } else {
            await connection.query("UPDATE event_orders SET status = ?, admin_note = ? WHERE id = ?", [status, note || null, orderId]);
        }

        await connection.commit();
        res.json({ message: "Cập nhật trạng thái thành công!" });
    } catch (err) {
        await connection.rollback();
        res.status(500).json({ message: "Lỗi hệ thống khi cập nhật đơn" });
    } finally { connection.release(); }
};

exports.deleteOrder = async (req, res) => {
    try {
        await db.query("DELETE FROM acc_orders WHERE id = ?", [req.params.id]);
        res.redirect('/admin/orders?msg=Deleted');
    } catch (err) { res.status(500).send("Lỗi xóa đơn hàng"); }
};

// ============================================================
// 4. QUẢN LÝ THÀNH VIÊN (TỐI ƯU LOAD SERVER & TÌM KIẾM)
// ============================================================
exports.getUsers = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 15; 
        const offset = (page - 1) * limit;
        const searchQuery = req.query.q ? req.query.q.trim() : '';

        let query = "SELECT id, username, email, money, role, is_banned, created_at FROM users";
        let countQuery = "SELECT COUNT(*) as total FROM users";
        let params = [];
        let countParams = [];

        if (searchQuery) {
            if (!isNaN(searchQuery)) { 
                query += " WHERE id = ? OR username LIKE ?";
                countQuery += " WHERE id = ? OR username LIKE ?";
                params.push(searchQuery, `%${searchQuery}%`);
                countParams.push(searchQuery, `%${searchQuery}%`);
            } else { 
                query += " WHERE username LIKE ?";
                countQuery += " WHERE username LIKE ?";
                params.push(`%${searchQuery}%`);
                countParams.push(`%${searchQuery}%`);
            }
        }

        query += " ORDER BY id DESC LIMIT ? OFFSET ?";
        params.push(limit, offset);

        const [countResult] = await db.query(countQuery, countParams);
        const totalUsers = countResult[0].total;
        const totalPages = Math.ceil(totalUsers / limit);

        const [users] = await db.query(query, params);

        res.render('admin/users', { 
            users: users, 
            user: req.user, 
            page: 'users',
            pagination: { page, totalPages },
            searchQuery: searchQuery
        });
    } catch (err) { 
        console.error(err);
        res.status(500).send("Lỗi lấy danh sách user"); 
    }
};

exports.getUserDetail = async (req, res) => {
    try {
        const userId = req.params.id;
        const [users] = await db.query("SELECT * FROM users WHERE id = ?", [userId]);
        if (users.length === 0) return res.redirect('/admin/users');
        const targetUser = users[0];

        const [transactions] = await db.query("SELECT * FROM transaction_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 50", [userId]);
        const [accOrders] = await db.query(`SELECT o.*, p.title, p.price_new, p.acc_username, p.acc_password FROM acc_orders o JOIN products p ON o.product_id = p.id WHERE o.user_id = ? ORDER BY o.created_at DESC`, [userId]);

        accOrders.forEach(acc => { try { acc.acc_password = cryptoHelper.decrypt(acc.acc_password); } catch(e) { } });

        res.render('admin/user_detail', { targetUser, transactions, accOrders, user: req.user, page: 'users' });
    } catch (err) { res.status(500).send("Lỗi lấy thông tin user"); }
};

exports.updateUserMoney = async (req, res) => {
    const { userId, amount, type, reason } = req.body;
    const money = parseInt(amount);

    if (!money || money <= 0) return res.json({ success: false, message: "Số tiền không hợp lệ" });

    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
        const [rows] = await connection.query("SELECT money FROM users WHERE id = ? FOR UPDATE", [userId]);
        if (rows.length === 0) throw new Error("User không tồn tại");
        
        const currentMoney = rows[0].money;
        let newMoney = type === 'plus' ? currentMoney + money : currentMoney - money;
        if (newMoney < 0) newMoney = 0;
        let logAmount = type === 'plus' ? money : -money;

        await connection.query("UPDATE users SET money = ? WHERE id = ?", [newMoney, userId]);
        await connection.query(`INSERT INTO transaction_logs (user_id, type, amount, old_balance, new_balance, description) VALUES (?, 'admin_adjust', ?, ?, ?, ?)`, [userId, logAmount, currentMoney, newMoney, `Admin: ${reason}`]);

        await connection.commit();
        res.json({ success: true, message: "Cập nhật số dư thành công!" });
    } catch (err) {
        await connection.rollback();
        res.json({ success: false, message: "Lỗi Server" });
    } finally { connection.release(); }
};

exports.resetUserPassword = async (req, res) => {
    const { userId, newPassword } = req.body;
    if (!newPassword) return res.json({ success: false, message: "Thiếu mật khẩu mới" });
    try {
        const salt = await bcrypt.genSalt(10);
        const hash = await bcrypt.hash(newPassword, salt);
        await db.query("UPDATE users SET password = ? WHERE id = ?", [hash, userId]);
        res.json({ success: true, message: "Đổi mật khẩu thành công!" });
    } catch (err) { res.json({ success: false, message: "Lỗi đổi mật khẩu" }); }
};

exports.banUser = async (req, res) => {
    const { userId, action, reason } = req.body;
    try {
        if (action === 'ban') {
            await db.query("UPDATE users SET is_banned = 1, ban_reason = ? WHERE id = ?", [reason, userId]);
            res.json({ success: true, message: "Đã khóa tài khoản này!" });
        } else {
            await db.query("UPDATE users SET is_banned = 0, ban_reason = NULL WHERE id = ?", [userId]);
            res.json({ success: true, message: "Đã mở khóa tài khoản!" });
        }
    } catch (err) { res.json({ success: false, message: "Lỗi xử lý Ban/Unban" }); }
};

// ============================================================
// 5. CẤU HÌNH HỆ THỐNG
// ============================================================
exports.getSettings = async (req, res) => {
    try {
        const [settings] = await db.query("SELECT * FROM settings LIMIT 1");
        const [banners] = await db.query("SELECT * FROM banners ORDER BY id DESC");
        const [quickActions] = await db.query("SELECT * FROM quick_actions ORDER BY sort_order ASC");
        res.render('admin/settings', { settings: settings[0], banners, quickActions, page: 'settings', user: req.user });
    } catch (err) { res.status(500).send("Lỗi tải cấu hình"); }
};

exports.saveSettings = async (req, res) => {
    const data = req.body;
    const connection = await db.getConnection();
    await connection.beginTransaction();
    try {
        for (const [key, value] of Object.entries(data)) {
            await connection.query(`INSERT INTO settings (site_key, site_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE site_value = ?`, [key, value, value]);
        }
        await connection.commit();
        res.json({ success: true, message: "Lưu cấu hình thành công!" });
    } catch (err) {
        await connection.rollback();
        res.status(500).json({ success: false, message: "Lỗi lưu cấu hình" });
    } finally { connection.release(); }
};

exports.addBanner = async (req, res) => {
    try {
        let imageUrl = '';
        if (req.file) imageUrl = `/images/${req.file.filename}`;
        else if (req.body && req.body.image_url) imageUrl = req.body.image_url;

        if (!imageUrl) return res.status(400).json({ success: false, message: 'Vui lòng chọn ảnh!' });
        await db.query("INSERT INTO banners (image_url, link) VALUES (?, ?)", [imageUrl, req.body.link || '#']);
        return res.json({ success: true, message: 'Thêm thành công!' });
    } catch (err) { return res.status(500).json({ success: false, message: 'Lỗi server' }); }
};

exports.deleteBanner = async (req, res) => {
    try {
        await db.query("DELETE FROM banners WHERE id = ?", [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false }); }
};

exports.updateQuickAction = async (req, res) => {
    try {
        await db.query("UPDATE quick_actions SET title = ?, icon_class = ?, link_url = ? WHERE id = ?", [req.body.title, req.body.icon_class, req.body.link_url, req.body.id]);
        res.json({ success: true, message: 'Cập nhật menu thành công' });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ============================================================
// 6. QUẢN LÝ BÀI VIẾT (BLOG / TIN TỨC)
// ============================================================
exports.getBlogs = async (req, res) => {
    try {
        const [blogs] = await db.query("SELECT * FROM articles ORDER BY created_at DESC");
        const [categories] = await db.query("SELECT DISTINCT category FROM articles WHERE category IS NOT NULL AND category != ''");
        res.render('admin/blogs', { blogs, existingCategories: categories, user: req.user, page: 'blogs' });
    } catch (err) { res.status(500).send("Lỗi Server Admin"); }
};

exports.createBlog = async (req, res) => {
    try {
        const { title, summary, content, tags, category } = req.body; 
        const thumbnail = req.file ? `/images/${req.file.filename}` : '/images/default-blog.jpg';
        const slug = createSlug(title) + '-' + Date.now(); 

        await db.query("INSERT INTO articles (title, slug, thumbnail, summary, content, tags, author_id, category) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [title, slug, thumbnail, summary, content, tags, req.user.id, category]);
        notifyGoogle(`${DOMAIN}/tin-tuc/${slug}`, 'URL_UPDATED');
        res.redirect('/admin/blogs');
    } catch (err) { res.status(500).send("Lỗi thêm bài viết: " + err.message); }
};

exports.getBlogEdit = async (req, res) => {
    try {
        const [blogs] = await db.query("SELECT * FROM articles WHERE id = ?", [req.params.id]);
        res.render('admin/blog_edit', { blog: blogs[0], user: req.user, page: 'blogs' });
    } catch (err) { res.status(500).send("Lỗi"); }
};

exports.updateBlog = async (req, res) => {
    try {
        const { title, summary, content, tags, category } = req.body;
        const [oldBlogs] = await db.query("SELECT thumbnail, slug FROM articles WHERE id = ?", [req.params.id]);
        if (oldBlogs.length === 0) return res.redirect('/admin/blogs?message=Không tìm thấy bài viết!&type=error');
        
        let newThumbnail = oldBlogs[0].thumbnail;
        if (req.file) {
            newThumbnail = `/images/${req.file.filename}`;
            if (oldBlogs[0].thumbnail) {
                const cleanPath = oldBlogs[0].thumbnail.startsWith('/') ? oldBlogs[0].thumbnail.substring(1) : oldBlogs[0].thumbnail;
                const oldPath = path.join(__dirname, '../public', cleanPath);
                if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
            }
        }

        await db.query(`UPDATE articles SET title = ?, summary = ?, content = ?, tags = ?, category = ?, thumbnail = ? WHERE id = ?`, [title, summary, content, tags, category, newThumbnail, req.params.id]);
        notifyGoogle(`${DOMAIN}/tin-tuc/${oldBlogs[0].slug}`, 'URL_UPDATED');
        res.redirect('/admin/blogs?message=Cập nhật bài viết thành công!&type=success');
    } catch (err) { res.status(500).send("Lỗi server khi cập nhật bài viết"); }
};

exports.deleteBlog = async (req, res) => {
    try {
        const [blogs] = await db.query("SELECT thumbnail, slug FROM articles WHERE id = ?", [req.params.id]);
        if (blogs.length > 0) {
            if (blogs[0].thumbnail) {
                const cleanPath = blogs[0].thumbnail.startsWith('/') ? blogs[0].thumbnail.substring(1) : blogs[0].thumbnail;
                const imagePath = path.join(__dirname, '../public', cleanPath);
                if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
            }
            notifyGoogle(`${DOMAIN}/tin-tuc/${blogs[0].slug}`, 'URL_DELETED');
        }
        await db.query("DELETE FROM articles WHERE id = ?", [req.params.id]);
        return res.redirect('/admin/blogs?message=Xóa bài viết thành công!&type=success');
    } catch (err) { return res.redirect('/admin/blogs?message=Lỗi!&type=error'); }
};

// ============================================================
// 7. QUẢN LÝ TRANG SEO
// ============================================================
exports.getSeoPages = async (req, res) => {
    try {
        const [pages] = await db.query("SELECT * FROM seo_pages ORDER BY id DESC");
        res.render('admin/seo_pages', { page: 'seo_pages', pages, user: req.user });
    } catch (err) { res.status(500).send("Lỗi lấy danh sách SEO Pages"); }
};

exports.addSeoPage = async (req, res) => {
    try {
        const { slug, title, description, keywords, h1_title, seo_content, target_category, article_category } = req.body;
        await db.query(`INSERT INTO seo_pages (slug, title, description, keywords, h1_title, seo_content, target_category, article_category) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [slug, title, description, keywords, h1_title, seo_content, target_category, article_category]);
        notifyGoogle(`${DOMAIN}/shop/${slug}`, 'URL_UPDATED');
        res.redirect('/admin/seo-pages?msg=Thành công');
    } catch (err) { res.status(500).send("Lỗi thêm trang SEO"); }
};

exports.updateSeoPage = async (req, res) => {
    try {
        const { title, description, keywords, h1_title, seo_content } = req.body;
        await db.query("UPDATE seo_pages SET title=?, description=?, keywords=?, h1_title=?, seo_content=? WHERE id=?", [title, description, keywords, h1_title, seo_content, req.params.id]);
        res.json({ success: true, message: 'Thành công' });
    } catch (err) { res.status(500).json({ success: false }); }
};

exports.deleteSeoPage = async (req, res) => {
    try {
        const [pages] = await db.query("SELECT slug FROM seo_pages WHERE id = ?", [req.params.id]);
        if(pages.length > 0) notifyGoogle(`${DOMAIN}/shop/${pages[0].slug}`, 'URL_DELETED');
        await db.query("DELETE FROM seo_pages WHERE id = ?", [req.params.id]);
        res.redirect('/admin/seo-pages');
    } catch (err) { res.status(500).send("Lỗi xóa trang"); }
};

// ============================================================
// 8. QUẢN LÝ HÌNH ẢNH (HỖ TRỢ CẢ THƯ MỤC CŨ LẪN MỚI)
// ============================================================
exports.getImageManager = (req, res) => {
    const newDir = path.join(__dirname, '../public/images');
    const oldDir = path.join(__dirname, '../public/uploads');

    // Tạo thư mục nếu chưa có
    if (!fs.existsSync(newDir)) fs.mkdirSync(newDir, { recursive: true });
    if (!fs.existsSync(oldDir)) fs.mkdirSync(oldDir, { recursive: true });

    let allImages = [];

    // Quét thư mục MỚI (/images)
    try {
        const newFiles = fs.readdirSync(newDir);
        newFiles.filter(file => /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(file)).forEach(file => {
            const stats = fs.statSync(path.join(newDir, file));
            allImages.push({ name: file, time: stats.mtime.getTime(), folder: 'images' });
        });
    } catch (e) { console.log("Lỗi đọc thư mục images"); }

    // Quét thư mục CŨ (/uploads)
    try {
        const oldFiles = fs.readdirSync(oldDir);
        oldFiles.filter(file => /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(file)).forEach(file => {
            const stats = fs.statSync(path.join(oldDir, file));
            allImages.push({ name: file, time: stats.mtime.getTime(), folder: 'uploads' }); 
        });
    } catch (e) { console.log("Lỗi đọc thư mục uploads"); }

    // Sắp xếp tất cả ảnh (cả cũ lẫn mới) theo thời gian từ mới nhất -> cũ nhất
    allImages.sort((a, b) => b.time - a.time);

    res.render('admin/images', { title: 'Quản Lý Hình Ảnh', images: allImages, domain: DOMAIN, user: req.user });
};

exports.uploadImage = (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, message: 'Chưa chọn ảnh!' });
    
    const fileUrl = `/images/${req.file.filename}`;
    
    res.json({ 
        success: true, 
        message: 'Tải ảnh lên thành công!', 
        filename: req.file.filename, 
        url: fileUrl, 
        location: fileUrl // TinyMCE cần cái này
    });
};

exports.deleteImage = (req, res) => {
    const { filename, folder } = req.body; 
    if (!filename || filename.includes('..') || filename.includes('/')) return res.status(400).json({ success: false });
    
    const targetFolder = folder === 'uploads' ? 'uploads' : 'images';
    const filepath = path.join(__dirname, '../public', targetFolder, filename);
    
    if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
        res.json({ success: true, message: 'Đã xóa!' });
    } else {
        res.status(404).json({ success: false, message: 'Không thấy ảnh!' });
    }
};