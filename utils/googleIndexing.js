const { google } = require('googleapis');
const path = require('path');

// Trỏ chính xác đường dẫn tới file chìa khóa JSON
const keyPath = path.join(__dirname, '../config/google-seo-key.json');

async function notifyGoogle(url, type = 'URL_UPDATED') {
    try {
        // Dùng GoogleAuth chuẩn mực: Tự động đọc và parse file JSON
        const auth = new google.auth.GoogleAuth({
            keyFilename: keyPath,
            scopes: ['https://www.googleapis.com/auth/indexing'],
        });

        // Lấy thông tin xác thực
        const authClient = await auth.getClient();

        // Khởi tạo dịch vụ Indexing
        const indexing = google.indexing({
            version: 'v3',
            auth: authClient,
        });

        // Bắn lệnh Ping thẳng lên Google
        const res = await indexing.urlNotifications.publish({
            requestBody: {
                url: url,
                type: type,
            },
        });

        console.log(`[SEO BOT 🚀] Đã Ping Google thành công: ${url}`);
        
    } catch (error) {
        console.error(`[SEO BOT ❌] Lỗi Ping Google cho ${url}:`, error.message);
        // In ra chi tiết lỗi từ Google để dễ bắt bệnh (nếu có)
        if (error.response && error.response.data) {
            console.error("Chi tiết từ Google:", JSON.stringify(error.response.data, null, 2));
        }
    }
}

module.exports = notifyGoogle;