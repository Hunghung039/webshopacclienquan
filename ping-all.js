require('dotenv').config();
const db = require('./config/db');
const notifyGoogle = require('./utils/googleIndexing');

// Sếp tự thay lại bằng tên miền thật nếu chưa setup trong .env nhé
const DOMAIN = process.env.BASE_URL || 'https://shoplienquan.site'; 

// Hàm nghỉ giữa các lần bắn (Tránh bị Google hiểu nhầm là DDoS)
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function runBulkPing() {
    try {
        console.log("🔍 Đang gom toàn bộ Link từ Database...");
        let urlsToPing = [];
 
        // 3. Gom link Trang SEO
        const [seoPages] = await db.query("SELECT slug FROM seo_pages");
        seoPages.forEach(s => urlsToPing.push(`${DOMAIN}/shop/${s.slug}`));
        // 2. Gom link Bài viết
        const [blogs] = await db.query("SELECT slug FROM articles");
        blogs.forEach(b => urlsToPing.push(`${DOMAIN}/tin-tuc/${b.slug}`));
// 1. Gom link Acc Game (Chỉ lấy acc đang bán)
        const [products] = await db.query("SELECT slug FROM products WHERE status = 'available'");
        products.forEach(p => urlsToPing.push(`${DOMAIN}/chi-tiet/${p.slug}`));
       

        console.log(`🎯 Tìm thấy tổng cộng: ${urlsToPing.length} trang.`);
        console.log(`⚠️ LƯU Ý: Google chỉ cho phép Ping tối đa 200 link/ngày.`);
        
        // Cắt lấy 200 link đầu tiên để chạy hôm nay (Sếp có thể sửa số 200 thành 500 nếu muốn Google báo lỗi Quota để thử)
        const batchUrls = urlsToPing.slice(190, 380); 
        console.log(`🚀 Bắt đầu Ping ${batchUrls.length} trang lên Google...\n`);

        for (let i = 0; i < batchUrls.length; i++) {
            const url = batchUrls[i];
            console.log(`[${i + 1}/${batchUrls.length}] Đang Ping: ${url}`);
            
            // Gọi hàm Ping Google
            await notifyGoogle(url, 'URL_UPDATED');
            
            // Đợi 1.5 giây rồi mới bắn link tiếp theo cho an toàn
            await delay(1500); 
        }

        console.log(`\n=================================`);
        console.log(`🎉 HOÀN TẤT BẮN PING ${batchUrls.length} TRANG!`);
        console.log(`👉 Nếu sếp còn trang dư, hãy quay lại chạy Tool này vào ngày mai nhé!`);
        console.log(`=================================`);
        
        process.exit(0);

    } catch (error) {
        console.error("❌ Lỗi hệ thống:", error);
        process.exit(1);
    }
}

runBulkPing();