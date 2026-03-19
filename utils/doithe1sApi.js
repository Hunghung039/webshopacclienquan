const crypto = require('crypto');
const axios = require('axios');

class Doithe1sAPI {
    constructor() {
        this.partner_id = process.env.DOITHE1S_MERCHANT_ID;
        this.partner_key = process.env.DOITHE1S_MERCHANT_KEY;
        this.wallet_number = process.env.DOITHE1S_WALLET;
        this.post_url = 'https://api.doithe1s.vn/api/cardws';
    }

    // Hàm tạo chữ ký MD5 bảo mật
    createSign(command, request_id = '') {
        const rawString = this.partner_key + this.partner_id + command + request_id;
        return crypto.createHash('md5').update(rawString).digest('hex');
    }

    // API: Mua thẻ
    async buyCard(service_code, value) {
        const request_id = Date.now().toString() + Math.floor(Math.random() * 1000);
        const command = 'buycard';
        
        const payload = {
            partner_id: this.partner_id,
            command: command,
            request_id: request_id,
            service_code: service_code,
            wallet_number: this.wallet_number,
            value: value.toString(),
            qty: 1,
            sign: this.createSign(command, request_id)
        };

        try {
            const response = await axios.post(this.post_url, payload);
            return response.data; // Trả về JSON cho Controller xử lý
        } catch (error) {
            console.error("Lỗi gọi API Doithe1s:", error.message);
            return { status: 0, message: "Mất kết nối đến nhà cung cấp thẻ!" };
        }
    }
}

module.exports = new Doithe1sAPI();