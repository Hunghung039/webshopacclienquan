const db = require('../config/db');
const fs = require('fs');
const path = require('path');

// 1. RENDER TRANG QUẢN LÝ
exports.getManager = async (req, res) => {
    try {
        const [configs] = await db.query("SELECT * FROM xinxam_config WHERE id = 1");
        const [cards] = await db.query("SELECT * FROM xinxam_cards ORDER BY card_number ASC");
        
        // Đếm số lượng mã còn tồn kho của từng thẻ
        const [stockStats] = await db.query("SELECT card_id, COUNT(*) as stock FROM xinxam_codes WHERE status = 0 GROUP BY card_id");
        
        const cardsWithStock = cards.map(c => {
            const stat = stockStats.find(s => s.card_id === c.id);
            return { ...c, stock: stat ? stat.stock : 0 };
        });

        res.render('admin/xinxam_manager', {
            layout: 'admin',
            page: 'xinxam',
            config: configs[0] || {},
            cards: cardsWithStock, 
            user: req.user
        });
    } catch (err) {
        res.status(500).send("Lỗi tải trang quản lý Xin Xăm");
    }
};

// 2. CẬP NHẬT CẤU HÌNH (GIÁ & ẢNH BÌA)
exports.updateConfig = async (req, res) => {
    try {
        const { name, default_price, full_package_price, old_banner_image, old_card_back_image } = req.body;
        const is_active = req.body.is_active === 'on' ? 1 : 0;
        
        const banner_image = req.files && req.files['banner_file'] ? req.files['banner_file'][0].filename : old_banner_image;
        const card_back_image = req.files && req.files['back_file'] ? req.files['back_file'][0].filename : old_card_back_image;

        await db.query(
            "UPDATE xinxam_config SET name=?, default_price=?, full_package_price=?, banner_image=?, card_back_image=?, is_active=? WHERE id=1",
            [name, default_price, full_package_price, banner_image, card_back_image, is_active]
        );
        res.redirect('/admin/xinxam?msg=Đã lưu cấu hình thành công!&type=success');
    } catch (err) {
        res.redirect(`/admin/xinxam?msg=Lỗi: ${err.message}&type=error`);
    }
};

// 3. THÊM NHIỀU THẺ CÙNG LÚC (TỰ ĐỘNG ĐÁNH SỐ)
exports.addCards = async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) throw new Error("Chưa chọn ảnh nào!");

        const [maxCard] = await db.query("SELECT MAX(card_number) as max_num FROM xinxam_cards");
        let currentNum = maxCard[0].max_num || 0;

        const connection = await db.getConnection();
        await connection.beginTransaction();
        try {
            for (let file of req.files) {
                currentNum++;
                const cardName = `Quẻ Số ${currentNum}`;
                await connection.query(
                    "INSERT INTO xinxam_cards (card_number, name, image_url) VALUES (?, ?, ?)",
                    [currentNum, cardName, file.filename]
                );
            }
            await connection.commit();
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }

        res.redirect(`/admin/xinxam?msg=Đã nạp thành công ${req.files.length} thẻ mới!&type=success`);
    } catch (err) {
        res.redirect(`/admin/xinxam?msg=Lỗi: ${err.message}&type=error`);
    }
};

// 4. CẬP NHẬT GIÁ VÀ TÊN CHO 1 THẺ LẺ
exports.updateCardPrice = async (req, res) => {
    try {
        const { price, name } = req.body;
        const finalPrice = price === '' ? null : parseInt(price);
        
        await db.query("UPDATE xinxam_cards SET price = ?, name = ? WHERE id = ?", [finalPrice, name, req.params.id]);
        res.redirect('/admin/xinxam?msg=Đã cập nhật thông tin Thẻ!&type=success');
    } catch (err) {
        res.redirect('/admin/xinxam?msg=Lỗi cập nhật Thẻ&type=error');
    }
};

// 5. XÓA 1 THẺ LẺ (Xóa luôn ảnh trong ổ cứng VPS)
exports.deleteSingleCard = async (req, res) => {
    try {
        const cardId = req.params.id;

        const [cards] = await db.query("SELECT image_url FROM xinxam_cards WHERE id = ?", [cardId]);
        
        if (cards.length > 0) {
            const imageUrl = cards[0].image_url;
            if (imageUrl && !imageUrl.startsWith('http')) {
                const filePath = path.join(__dirname, '../public/images', imageUrl);
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                }
            }
        }

        await db.query("DELETE FROM xinxam_cards WHERE id = ?", [cardId]);
        await db.query("DELETE FROM xinxam_codes WHERE card_id = ?", [cardId]); // Xóa sạch mã của thẻ này
        res.redirect('/admin/xinxam?msg=Đã xóa thẻ và dọn file gốc thành công!&type=success');
    } catch (err) {
        res.redirect('/admin/xinxam?msg=Lỗi xóa thẻ&type=error');
    }
};

// 6. XÓA SẠCH TOÀN BỘ KHO THẺ (Xóa sạch ảnh trên VPS)
exports.deleteAllCards = async (req, res) => {
    try {
        const [cards] = await db.query("SELECT image_url FROM xinxam_cards");

        cards.forEach(card => {
            const imageUrl = card.image_url;
            if (imageUrl && !imageUrl.startsWith('http')) {
                const filePath = path.join(__dirname, '../public/images', imageUrl);
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                }
            }
        });

        await db.query("DELETE FROM xinxam_cards");
        await db.query("DELETE FROM xinxam_codes"); 
        await db.query("DELETE FROM xinxam_vip_users");

        res.redirect('/admin/xinxam?msg=Đã dọn sạch Database và toàn bộ file ảnh gốc!&type=success');
    } catch (err) {
        res.redirect('/admin/xinxam?msg=Lỗi dọn dẹp hệ thống&type=error');
    }
};

// 7. NẠP MÃ VÀO 1 THẺ CỤ THỂ
exports.addCodesToCard = async (req, res) => {
    try {
        const { card_id, codes_list } = req.body;
        const codesArray = codes_list.split('\n').map(c => c.trim()).filter(c => c !== '');
        if (codesArray.length === 0) throw new Error("Vui lòng nhập ít nhất 1 mã!");

        const connection = await db.getConnection();
        await connection.beginTransaction();
        try {
            for(let code of codesArray) {
                await connection.query("INSERT INTO xinxam_codes (card_id, code, status) VALUES (?, ?, 0)", [card_id, code]);
            }
            await connection.commit();
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }
        res.redirect('/admin/xinxam?msg=Đã nạp thành công ' + codesArray.length + ' mã vào thẻ!&type=success');
    } catch (err) {
        res.redirect(`/admin/xinxam?msg=Lỗi: ${err.message}&type=error`);
    }
};

// 8. LỌC VÀ NẠP MÃ THÔNG MINH THEO TÊN THẺ (AI REGEX)
exports.importRawCodes = async (req, res) => {
    try {
        const { raw_text } = req.body;
        
        // Regex AI: Nhặt TẤT CẢ các cặp Số và Mã bất kể dấu phẩy, chữ thừa hay xuống dòng.
        // Cân tốt cả "Thẻ 61: [MÃ]" (cũ) và "61 [MÃ], 52 [MÃ]" (mới)
        const regex = /(\d+)\s*:?\s*\[([^\]]+)\]/g;
        let match;
        const codesToAdd = [];

        // Lặp qua toàn bộ đoạn text sếp dán vào
        while ((match = regex.exec(raw_text)) !== null) {
            const cardNumber = match[1].trim();   // Lấy Số thẻ (VD: 61, 52)
            const codeString = match[2].trim();   // Lấy chuỗi mã bên trong dấu []
            codesToAdd.push({ cardNumber, codeString });
        }

        // Báo lỗi nếu text dán vào sai bét, không có mã nào hợp lệ
        if (codesToAdd.length === 0) {
            throw new Error("Không tìm thấy mã nào! Hãy nhập theo dạng 'Số [MÃ]' hoặc 'Thẻ Số: [MÃ]'");
        }

        const connection = await db.getConnection();
        await connection.beginTransaction();

        try {
            let successCount = 0;
            let duplicateCount = 0; // Biến đếm số lượng mã bị trùng

            // Duyệt mảng mã vừa nhặt được để nạp vào DB
            for (let item of codesToAdd) {
                const searchName = `Quẻ Số ${item.cardNumber}%`;
                const [cards] = await connection.query("SELECT id FROM xinxam_cards WHERE name LIKE ? LIMIT 1", [searchName]);
                
                if (cards.length > 0) {
                    const card_id = cards[0].id;

                    // ==========================================
                    // TÍNH NĂNG MỚI: KIỂM TRA MÃ TRÙNG (TRÊN TOÀN BỘ KHO)
                    // ==========================================
                    const [existingCodes] = await connection.query("SELECT id FROM xinxam_codes WHERE code = ? LIMIT 1", [item.codeString]);
                    
                    if (existingCodes.length > 0) {
                        // Nếu mã đã tồn tại -> Bỏ qua không nạp, tăng biến đếm trùng
                        duplicateCount++;
                    } else {
                        // Nếu mã chưa tồn tại -> Tiến hành nạp vào DB
                        await connection.query("INSERT INTO xinxam_codes (card_id, code, status) VALUES (?, ?, 0)", [card_id, item.codeString]);
                        successCount++;
                    }
                }
            }
            
            await connection.commit();

            // Tạo câu thông báo linh hoạt hiển thị cả số mã thành công và số mã bị bỏ qua
            let finalMessage = `Đã quét và nạp thành công ${successCount} mã mới!`;
            if (duplicateCount > 0) {
                finalMessage += ` (Đã tự động bỏ qua ${duplicateCount} mã bị trùng lặp).`;
            }

            res.redirect(`/admin/xinxam?msg=${encodeURIComponent(finalMessage)}&type=success`);
            
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }
    } catch (err) {
        res.redirect(`/admin/xinxam?msg=Lỗi nhập liệu: ${err.message}&type=error`);
    }
};