const db = require('../config/db');

// =========================================================================
// 1. LẤY DANH SÁCH BÀI VIẾT (TRANG BLOG CHÍNH) - TỐI ƯU SEO CATEGORY
// =========================================================================
exports.getBlogList = async (req, res) => {
    try {
        const theme = req.theme || 'default';
        
        // --- LOGIC PHÂN TRANG ---
        const page = parseInt(req.query.page) || 1; 
        const limit = 9; // Hiển thị 9 bài mỗi trang cho đẹp lưới (Grid 3x3)
        const offset = (page - 1) * limit;

        const [countResult] = await db.query("SELECT COUNT(*) as total FROM articles WHERE status = 'published'");
        const totalArticles = countResult[0].total;
        const totalPages = Math.ceil(totalArticles / limit);

        // Chỉ lấy các trường cần thiết để web load nhẹ nhất, tốc độ bàn thờ
        const [articles] = await db.query(`
            SELECT id, title, slug, thumbnail, summary, tags, views, created_at 
            FROM articles 
            WHERE status = 'published' 
            ORDER BY created_at DESC 
            LIMIT ? OFFSET ?`, [limit, offset]
        );

        // --- BỘ TỪ KHÓA SEO ĐỈNH CAO CHO TRANG MỤC LỤC TIN TỨC ---
        const seoKeywords = "tin tức liên quân, hướng dẫn chơi liên quân, mẹo leo rank liên quân, sự kiện liên quân, blog game liên quân, cập nhật liên quân mới nhất, cẩm nang liên quân mobile";

        // --- SCHEMA.ORG: BÁO CÁO VỚI GOOGLE ĐÂY LÀ DANH SÁCH BÀI VIẾT ---
        const seoSchema = {
            "@context": "https://schema.org",
            "@type": "ItemList",
            "itemListElement": articles.map((art, index) => ({
                "@type": "ListItem",
                "position": index + 1,
                "url": `https://shoplienquan.site/tin-tuc/${art.slug}`,
                "name": art.title
            }))
        };

        // --- TRẢ VỀ GIAO DIỆN ---
        res.render(`themes/${theme}/blog`, {
            title: page > 1 ? `Tin Tức & Hướng Dẫn Game Liên Quân - Trang ${page}` : 'Tin Tức & Hướng Dẫn Game Liên Quân | ShopLienQuan',
            description: page > 1 ? `Tổng hợp các mẹo chơi, hướng dẫn Liên Quân Mobile - Trang ${page}` : 'Tổng hợp các mẹo chơi, hướng dẫn lên đồ, bảng ngọc và cập nhật sự kiện Liên Quân Mobile mới nhất. Đọc ngay để thành cao thủ.',
            keywords: seoKeywords,
            schemaData: JSON.stringify(seoSchema), // Truyền Schema ra Header
            articles: articles,
            pagination: { page, totalPages },
            currentUrl: req.originalUrl, // Dành cho Canonical Tag
            user: req.user
        });

    } catch (err) {
        console.error("Lỗi lấy danh sách blog:", err);
        res.status(500).send("Lỗi server tải danh sách bài viết");
    }
};

// =========================================================================
// 2. LẤY CHI TIẾT BÀI VIẾT (ĐỌC BÀI) - TỐI ƯU SIÊU SEO BÀI VIẾT
// =========================================================================
exports.getArticleDetail = async (req, res) => {
    try {
        const theme = req.theme || 'default';
        const slug = req.params.slug;

        // Tìm bài viết dựa trên Slug thân thiện
        const [rows] = await db.query("SELECT * FROM articles WHERE slug = ? AND status = 'published'", [slug]);
        
        // Nếu không có bài, trả về trang 404
        if (rows.length === 0) {
            return res.status(404).render(`themes/${theme}/404`, { title: "Không tìm thấy bài viết", user: req.user });
        }

        const article = rows[0];

        // --- TĂNG LƯỢT XEM KHÔNG CHỜ (Tăng view ngầm) ---
        db.query("UPDATE articles SET views = views + 1 WHERE id = ?", [article.id]).catch(console.error);

        // --- ĐIỀU HƯỚNG INTERNAL LINKING (Lấy bài liên quan giữ chân khách) ---
        const [relatedArticles] = await db.query(`
            SELECT title, slug, thumbnail, views, created_at 
            FROM articles 
            WHERE id != ? AND status = 'published' 
            ORDER BY created_at DESC LIMIT 5`, [article.id]
        );

        // --- XỬ LÝ TỪ KHÓA SEO ĐỘNG (Lấy từ Tags của bài viết + Tên bài) ---
        let seoKeywords = article.tags || "hướng dẫn liên quân, mẹo chơi liên quân mobile, tin tức game";
        // Bơm thêm chính cái tiêu đề bài viết vào Keywords để tạo từ khóa dài (Long-tail Keyword)
        seoKeywords += `, ${article.title.toLowerCase()}`;

        // Xử lý link ảnh chuẩn tuyệt đối cho Schema & Facebook Share
        const absoluteImageUrl = article.thumbnail.startsWith('http') 
            ? article.thumbnail 
            : `https://shoplienquan.site${article.thumbnail}`;

        // --- SCHEMA.ORG DẠNG NEWS ARTICLE (BÀI BÁO) CHUẨN GOOGLE NEWS ---
        const seoSchema = {
            "@context": "https://schema.org",
            "@type": "NewsArticle",
            "mainEntityOfPage": {
                "@type": "WebPage",
                "@id": `https://shoplienquan.site/tin-tuc/${article.slug}`
            },
            "headline": article.title,
            "description": article.summary,
            "image": [absoluteImageUrl],
            "datePublished": new Date(article.created_at).toISOString(),
            "dateModified": new Date(article.updated_at || article.created_at).toISOString(), // Rất quan trọng để Google biết bài có được cập nhật mới không
            "author": {
                "@type": "Organization", // Nếu web sếp có tên tác giả thì đổi thành Person
                "name": "ShopLienQuan",
                "url": "https://shoplienquan.site/"
            },
            "publisher": {
                "@type": "Organization",
                "name": "ShopLienQuan.Site",
                "logo": {
                    "@type": "ImageObject",
                    "url": "https://shoplienquan.site/images/logo.png"
                }
            }
        };

        // --- TRẢ VỀ GIAO DIỆN ---
        res.render(`themes/${theme}/article_detail`, {
            title: `${article.title} | ShopLienQuan`,
            description: article.summary, 
            keywords: seoKeywords, // Truyền từ khóa động vào Header
            schemaData: JSON.stringify(seoSchema), // Ép Schema ra File Head
            image: absoluteImageUrl, // Bắt ảnh share lên Facebook/Zalo không bị lỗi
            article: article,
            relatedArticles: relatedArticles,
            user: req.user,
            originalUrl: `/tin-tuc/${article.slug}`, // Truyền ra để làm thẻ Canonical
            currentUrl: `/tin-tuc/${article.slug}`
        });

    } catch (err) {
        console.error("Lỗi đọc bài viết:", err);
        res.status(500).send("Lỗi server tải chi tiết bài viết");
    }
};