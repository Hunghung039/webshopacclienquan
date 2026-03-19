const db = require('../config/db');
const axios = require('axios');
const crypto = require('crypto');
const { maskName } = require('../utils/helpers');

// Hàm tạo mã MD5 chuẩn theo yêu cầu của Doithe1s
const createSignature = (str) => {
    return crypto.createHash('md5').update(str).digest('hex');
};

// ============================================================
// 1. GỬI THẺ LÊN DOITHE1S (API V2) - CHỈ LƯU DB KHI THÀNH CÔNG
// ============================================================
exports.submitCard = async (req, res) => {
    const { network, amount, pin, seri } = req.body;
    const userId = req.user ? req.user.id : null;

    if (!userId) return res.status(401).json({ message: "Vui lòng đăng nhập!" });

    // Validate đầu vào cơ bản
    if (!network || !amount || !pin || !seri) {
        return res.status(400).json({ message: "Thiếu thông tin thẻ!" });
    }

    // ============================================================
    // KHIÊN LỚP 1: CHỐNG SPAM GỬI THẺ LIÊN TỤC
    // ============================================================
    const [pendingCards] = await db.query(
        "SELECT COUNT(*) as count FROM card_requests WHERE user_id = ? AND status = 'pending'", 
        [userId]
    );
    if (pendingCards[0].count >= 3) {
        return res.status(429).json({ 
            message: "Bạn đang có quá nhiều thẻ chờ duyệt. Vui lòng đợi hệ thống xử lý xong mới nạp tiếp!" 
        });
    }
    
    // ============================================================
    const partnerId = process.env.DOITHE1S_PARTNER_ID;
    const partnerKey = process.env.DOITHE1S_PARTNER_KEY;
    
    if (!partnerId || !partnerKey) {
        console.error("LỖI: Chưa cấu hình DOITHE1S_PARTNER_ID hoặc DOITHE1S_PARTNER_KEY trong .env");
        return res.status(500).json({ message: "Hệ thống nạp thẻ đang bảo trì, vui lòng quay lại sau!" });
    }

    try {
        const requestId = Math.floor(Math.random() * 1000000000).toString();

        // Tạo chữ ký gửi đi
        const sign = createSignature(partnerKey + pin + seri);

        const payload = {
            code: pin,
            serial: seri,
            telco: network.toUpperCase(),
            amount: parseInt(amount),
            partner_id: partnerId,
            request_id: requestId,
            command: 'charging',
            sign: sign
        };

        // GỌI API TRƯỚC TIÊN (Chưa lưu DB vội)
        const response = await axios.post('https://doithe1s.vn/chargingws/v2', payload, {
            headers: { 'Content-Type': 'application/json' }
        });

        const result = response.data;

        // XỬ LÝ KẾT QUẢ TRẢ VỀ TỪ DOITHE1S
        if (result.status == 99 || result.status == 1) {
            
            // THÀNH CÔNG -> LÚC NÀY MỚI LƯU VÀO DATABASE
            await db.query(`
                INSERT INTO card_requests (user_id, request_id, network, amount, pin, seri, status) 
                VALUES (?, ?, ?, ?, ?, ?, 'pending')`, 
                [userId, requestId, network, amount, pin, seri]
            );

            // Bắn Socket.io thông báo cho toàn server
            const io = req.app.get('socketio');
            if (io && req.user) {
                io.emit('broadcast-activity', {
                    user: maskName(req.user.username),
                    action: `vừa nạp thẻ ${network} ${parseInt(amount)/1000}k`, 
                    time: 'Vừa xong'
                });
            }
            res.json({ success: true, message: `Gửi thẻ thành công! Hệ thống đang xử lý...` });
            
        } else {
            // THẤT BẠI (Do thẻ sai định dạng, bảo trì, v.v.) -> KHÔNG LƯU DB, TRẢ VỀ LỖI LUÔN
            res.status(400).json({ success: false, message: result.message || 'Thẻ lỗi hoặc sai định dạng!' });
        }

    } catch (err) {
        console.error("Lỗi nạp thẻ Axios:", err);
        res.status(500).json({ success: false, message: "Lỗi kết nối tới cổng nạp thẻ. Vui lòng thử lại!" });
    }
};

// ============================================================
// 2. CALLBACK (XỬ LÝ KẾT QUẢ TRẢ VỀ & CỘNG TIỀN)
// ============================================================
exports.handleCallback = async (req, res) => {
    try {
        const data = req.body;
        
        // 1. Lấy Partner Key từ ENV
        const partnerKey = process.env.DOITHE1S_PARTNER_KEY;
        if (!partnerKey) return res.status(500).send('Config Error');

        // 2. Check chữ ký bảo mật
        const mySign = createSignature(partnerKey + data.code + data.serial);
        if (data.callback_sign !== mySign) {
            console.warn(`[SECURITY] Sai chữ ký Callback! ID: ${data.request_id}`);
            return res.status(400).json({ status: 'error', message: 'Invalid Signature' });
        }

        // 3. Tìm đơn hàng
        const [requests] = await db.query("SELECT * FROM card_requests WHERE request_id = ?", [data.request_id]);
        if (requests.length === 0) return res.status(404).json({ status: 'error', message: 'Order not found' });
        
        const request = requests[0];

        // 4. Nếu đơn đã xử lý rồi thì dừng
        if (request.status !== 'pending') {
            return res.json({ status: 'success', message: 'Already processed' });
        }

        const connection = await db.getConnection();
        await connection.beginTransaction();

        try {
            // Khởi tạo là 'failed', tuyệt đối không dùng 'error'
            let finalStatus = 'failed'; 
            let addedAmount = 0; 

            // --- TÍNH TOÁN TIỀN THỰC NHẬN ---
            const DISCOUNT_PERCENT = 14; 
            const declaredValue = parseInt(data.declared_value); 
            const realValue = parseInt(data.value); 

            const calculateMoney = (val) => {
                return val * (100 - DISCOUNT_PERCENT) / 100;
            };

            // TRƯỜNG HỢP 1: THẺ ĐÚNG (Status = 1)
            if (data.status == 1) {
                finalStatus = 'success';
                addedAmount = calculateMoney(realValue);
            } 
            // TRƯỜNG HỢP 2: THẺ SAI MỆNH GIÁ (Status = 2)
            else if (data.status == 2) {
                finalStatus = 'success'; 
                addedAmount = calculateMoney(realValue); 
            }
            // CÁC TRƯỜNG HỢP LỖI CÒN LẠI THÌ GIỮ NGUYÊN finalStatus = 'failed'

            // ============================================================
            // [ĐÃ FIX]: CỘNG TIỀN NẾU THÀNH CÔNG (CÓ OLD_BALANCE & NEW_BALANCE)
            // ============================================================
            if (finalStatus === 'success' && addedAmount > 0) {
                // Lấy số dư hiện tại và khóa dòng (tránh kẹt tiền nếu nạp 2 thẻ cùng lúc)
                const [userRows] = await connection.query("SELECT money FROM users WHERE id = ? FOR UPDATE", [request.user_id]);
                const oldBalance = userRows[0].money;
                const newBalance = oldBalance + addedAmount;

                // Cập nhật số dư mới
                await connection.query("UPDATE users SET money = ? WHERE id = ?", [newBalance, request.user_id]);
                
                // Ghi log chi tiết
                await connection.query(`
                    INSERT INTO transaction_logs (user_id, type, amount, old_balance, new_balance, description) 
                    VALUES (?, 'deposit', ?, ?, ?, ?)`, 
                    [request.user_id, addedAmount, oldBalance, newBalance, `Nạp thẻ ${request.network} ${new Intl.NumberFormat('vi-VN').format(realValue)}đ (Thực nhận)`]
                );
            }

            // CẬP NHẬT TRẠNG THÁI THẺ
            await connection.query("UPDATE card_requests SET status = ?, trans_id = ? WHERE id = ?", 
                [finalStatus, data.trans_id, request.id]);

            // ============================================================
            // KHIÊN LỚP 2: AUTO-BAN NẾU CỐ TÌNH SPAM THẺ SAI
            // ============================================================
            if (finalStatus === 'failed') {
                const [failCards] = await connection.query(`
                    SELECT COUNT(*) as failCount 
                    FROM card_requests 
                    WHERE user_id = ? AND status = 'failed' AND DATE(created_at) = CURDATE()
                `, [request.user_id]);
                
                if (failCards[0].failCount >= 5) { 
                    await connection.query(`
                        UPDATE users 
                        SET is_banned = 1, ban_reason = 'Hệ thống Auto-Ban: Cố tình spam thẻ sai quá 5 lần/ngày để phá hoại API' 
                        WHERE id = ?
                    `, [request.user_id]);
                    
                    console.log(`[SECURITY] 🛡️ ĐÃ BANNED USER ID ${request.user_id} VÌ SPAM THẺ RÁC.`);
                }
            }

            await connection.commit();
            res.json({ status: 'success', message: 'Updated successfully' });

        } catch (err) {
            await connection.rollback();
            console.error("Lỗi cập nhật Callback Transaction:", err);
            res.status(500).json({ status: 'error', message: 'Database error' });
        } finally {
            connection.release();
        }

    } catch (err) {
        console.error("Callback Error System:", err);
        res.status(500).send("Server Error");
    }
};