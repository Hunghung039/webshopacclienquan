// controllers/bulkProductController.js
const db = require('../config/db');
const cryptoHelper = require('../utils/cryptoHelper');
const { createSlug } = require('../utils/seoHelper');

exports.getBulkAddPage = (req, res) => {
    res.render('admin/bulk_add', { 
        title: 'Đăng Acc Hàng Loạt', 
        user: req.user, 
        page: 'bulk_add'
    });
};

exports.postBulkAdd = async (req, res) => {
    try {
        const files = req.files; 
        if (!files || files.length === 0) {
            return res.json({ success: false, message: "Chưa có ảnh nào được tải lên!" });
        }

        const toArray = (val) => Array.isArray(val) ? val : [val];
        
        const titles = toArray(req.body.titles);
        const price_olds = toArray(req.body.price_olds); // Thêm dòng lấy giá cũ
        const price_news = toArray(req.body.price_news); // Thêm dòng lấy giá mới
        const usernames = toArray(req.body.usernames);
        const passwords = toArray(req.body.passwords);
        const infos = toArray(req.body.infos);
        const is_hots = toArray(req.body.is_hots);

        let successCount = 0;

        for (let i = 0; i < files.length; i++) {
            let title = titles[i];
            let priceOld = parseInt(price_olds[i]) || 0;
            let priceNew = parseInt(price_news[i]) || 0;
            let username = usernames[i];
            let password = passwords[i];
            let info = infos[i];
            let isHot = parseInt(is_hots[i]);

            let slug = createSlug(title) + '-' + Date.now() + '-' + i;
            let encryptedPass = cryptoHelper.encrypt(password);
            let imageUrl = `/images/${files[i].filename}`;
            let detailsJson = JSON.stringify({ "Thông tin": info || "Acc Liên Quân VIP" });

            await db.query(`
                INSERT INTO products 
                (title, slug, category, price_old, price_new, image_url, acc_username, acc_password, details, status, is_hot) 
                VALUES (?, ?, 'lien-quan', ?, ?, ?, ?, ?, ?, 'available', ?)
            `, [title, slug, priceOld, priceNew, imageUrl, username, encryptedPass, detailsJson, isHot]);

            successCount++;
        }

        res.json({ success: true, message: `Tuyệt vời! Đã đăng thành công ${successCount} tài khoản lên Shop.` });
    } catch (error) {
        console.error("Lỗi đăng acc hàng loạt:", error);
        res.json({ success: false, message: "Lỗi hệ thống: " + error.message });
    }
};