const db = require('../config/db');
const fs = require('fs');
const path = require('path');

// =========================================================================
// HÀM HELPER: Parse JSON ảnh an toàn
// =========================================================================
const parseImages = (reviews) => {
    reviews.forEach(r => {
        // Fix lỗi: Nếu image_url bị NULL trong DB sẽ không bị crash
        if (!r.image_url) {
            r.images = [];
            return;
        }
        try { 
            r.images = JSON.parse(r.image_url); 
        } catch(e) { 
            r.images = [r.image_url]; // Backup cho dữ liệu cũ (chuỗi đơn)
        } 
    });
};

// =========================================================================
// 1. TRANG KHÁCH HÀNG (HIỂN THỊ DANH SÁCH UY TÍN & TỐI ƯU SEO)
// =========================================================================
exports.getTrustPage = async (req, res) => {
    try {
        const [reviews] = await db.query("SELECT * FROM trust_reviews ORDER BY id DESC");
        parseImages(reviews);

        // BỘ TỪ KHÓA SEO ĐỈNH CAO (Đánh trúng tâm lý search của khách)
        const seoKeywords = "check uy tín shop liên quân, shop liên quân uy tín, đánh giá shop liên quân, mua acc liên quân uy tín, bằng chứng giao dịch shop liên quân, shop liên quân có lừa đảo không, phốt shop liên quân, mua nick liên quân an toàn, giao dịch thành công";

        // Tự động tạo số lượng đánh giá dựa trên DB thực tế (Giúp Schema trông thật hơn)
        // Cộng thêm một số base (VD: 1589) để số lượng trông hoành tráng
        const dynamicReviewCount = reviews.length > 0 ? (reviews.length + 1589) : 1589;

        // SCHEMA.ORG: GIÚP GOOGLE HIỂN THỊ ĐÁNH GIÁ 5 SAO TRÊN KẾT QUẢ TÌM KIẾM
        const seoSchema = {
            "@context": "https://schema.org",
            "@type": "Organization",
            "name": "ShopLienQuan.Site",
            "url": "https://shoplienquan.site/",
            "logo": "https://shoplienquan.site/images/logo.png",
            "description": "Bằng chứng giao dịch thành công, đánh giá và check độ uy tín của ShopLienQuan.Site. Cam kết 100% không lừa đảo, bảo hành trọn đời.",
            "aggregateRating": {
                "@type": "AggregateRating",
                "ratingValue": "4.9",
                "reviewCount": dynamicReviewCount.toString(),
                "bestRating": "5",
                "worstRating": "1"
            }
        };

        res.render(`themes/${req.theme || 'default'}/trust`, {
            title: 'Check Uy Tín - Bằng Chứng Giao Dịch Thành Công | ShopLienQuan',
            description: 'Hàng ngàn giao dịch thành công và đánh giá tích cực từ khách hàng. Kiểm tra độ uy tín của ShopLienQuan ngay tại đây. Cam kết tự động, an toàn 100%.',
            keywords: seoKeywords,
            schemaData: JSON.stringify(seoSchema), // Truyền thẳng Schema ra Header
            reviews: reviews,
            user: req.user
        });
    } catch (err) { 
        console.error("Lỗi getTrustPage:", err);
        res.status(500).send("Lỗi tải trang Check Uy Tín"); 
    }
};

// =========================================================================
// 2. TRANG ADMIN QUẢN LÝ
// =========================================================================
exports.getAdminTrust = async (req, res) => {
    try {
        const [reviews] = await db.query("SELECT * FROM trust_reviews ORDER BY id DESC");
        parseImages(reviews);
        res.render('admin/trust_manager', { 
            layout: 'admin', 
            page: 'trust', 
            reviews: reviews, 
            user: req.user 
        });
    } catch (err) { 
        console.error("Lỗi getAdminTrust:", err);
        res.status(500).send("Lỗi tải trang admin"); 
    }
};

// =========================================================================
// 3. ADMIN: THÊM BÀI ĐĂNG UY TÍN (HỖ TRỢ NHIỀU ẢNH)
// =========================================================================
exports.addReview = async (req, res) => {
    try {
        const { customer_name, description } = req.body;
        
        // Kiểm tra xem có file ảnh được upload lên không
        if (!req.files || req.files.length === 0) {
            return res.redirect('/admin/trust?msg=Chưa chọn ảnh!&type=error');
        }
        
        // Chuyển đổi lưu đường dẫn vào thư mục /images/
        const imageUrls = req.files.map(file => `/images/${file.filename}`);
        const image_url_json = JSON.stringify(imageUrls); // Ép thành chuỗi JSON để lưu Database
        
        await db.query(
            "INSERT INTO trust_reviews (customer_name, image_url, description) VALUES (?, ?, ?)",
            [customer_name, image_url_json, description]
        );
        res.redirect('/admin/trust?msg=Đã thêm bài đăng uy tín thành công!&type=success');
    } catch (err) { 
        console.error("Lỗi addReview:", err);
        res.redirect('/admin/trust?msg=Lỗi hệ thống khi thêm ảnh!&type=error');
    }
};

// =========================================================================
// 4. ADMIN: XÓA BÀI ĐĂNG VÀ DỌN DẸP ẢNH RÁC TRÊN Ổ CỨNG
// =========================================================================
exports.deleteReview = async (req, res) => {
    try {
        const [reviews] = await db.query("SELECT image_url FROM trust_reviews WHERE id = ?", [req.params.id]);
        
        // Xóa file vật lý trên máy chủ (Tránh đầy ổ cứng VPS)
        if (reviews.length > 0 && reviews[0].image_url) {
            let images = [];
            try { 
                images = JSON.parse(reviews[0].image_url); 
            } catch(e) { 
                images = [reviews[0].image_url]; 
            }

            images.forEach(img => {
                // Loại bỏ dấu gạch chéo đầu tiên (VD: "/images/a.jpg" -> "images/a.jpg")
                const cleanPath = img.startsWith('/') ? img.substring(1) : img;
                const imagePath = path.join(__dirname, '../public', cleanPath);
                
                // Nếu file tồn tại thì xóa
                if (fs.existsSync(imagePath)) {
                    fs.unlinkSync(imagePath); 
                }
            });
        }
        
        // Xóa data trong Database
        await db.query("DELETE FROM trust_reviews WHERE id = ?", [req.params.id]);
        res.redirect('/admin/trust?msg=Đã xóa bài đăng và dọn dẹp ảnh!&type=success');
    } catch (err) { 
        console.error("Lỗi deleteReview:", err);
        res.redirect('/admin/trust?msg=Lỗi hệ thống khi xóa bài!&type=error');
    }
};