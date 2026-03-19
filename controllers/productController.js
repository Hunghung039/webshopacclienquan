const db = require('../config/db');
const { createSlug } = require('../utils/seoHelper');

// ============================================================
// [BƯỚC 1] HIỂN THỊ TRANG CHỦ (TỐI ƯU SEO 100%, SỰ KIỆN ĐỘNG)
// ============================================================
exports.getHomePage = async (req, res) => {
    try {
        const theme = req.theme || 'default';
        
        // 1. CẤU HÌNH SỰ KIỆN ĐỘNG
        const eventConfig = {
            name: "CHUNG SỨC HẢO VẬN", 
            subTitle: "Săn Rương Violet Pháo Hoa - Yorn Long Thần Soái - 3 Skin SS",
            badge: "Hot 2026",
            mainReward: "CHẮC CHẮN NHẬN SKIN SS / HỮU HẠN",
            pack1: { id: "full_1000", name: "GÓI FULL 1000 ĐIỂM", desc: "Nhận ngay rương trang phục VIP", price: "40.000đ" },
            pack2: { id: "part_200", name: "GÓI LẺ 200 ĐIỂM", desc: "Cày thuê điểm lẻ theo yêu cầu", price: "20.000đ" }
        };

        // 2. NHẬN THAM SỐ BỘ LỌC VÀ PHÂN TRANG
        const page = parseInt(req.query.page) || 1; 
        const limit = 12; 
        const offset = (page - 1) * limit;
        const category = req.query.category || 'all';

        // LẤY DỮ LIỆU BANNER & QUICK ACTIONS
        const [banners] = await db.query("SELECT * FROM banners ORDER BY id DESC");
        const [quickActions] = await db.query("SELECT * FROM quick_actions ORDER BY sort_order ASC");

        // 3. XÂY DỰNG TRUY VẤN TÌM KIẾM
        let whereClause = "WHERE status = 'available'";
        let queryParams = [];

        if (category !== 'all') {
            if (category === 'vip') {
                whereClause += " AND price_new >= 500000"; 
            } else if (category === 'tui_mu' || category === '9k') {
                whereClause += " AND (category = 'tui_mu' OR category = '9k')"; 
            } else if (category === 'pet_linh_bao') {
                whereClause += " AND category = 'pet_linh_bao'"; 
            } else {
                whereClause += " AND category = ?";
                queryParams.push(category); 
            }
        }

        const countSql = `SELECT COUNT(*) as total FROM products ${whereClause}`;
        const [countResult] = await db.query(countSql, queryParams);
        const totalProducts = countResult[0].total;
        const totalPages = Math.ceil(totalProducts / limit);

        const sql = `SELECT * FROM products ${whereClause} ORDER BY id DESC LIMIT ? OFFSET ?`;
        const [products] = await db.query(sql, [...queryParams, limit, offset]);
        
        products.forEach(p => {
            if (p.details && typeof p.details === 'string') {
                try { p.details = JSON.parse(p.details); } catch(e) {}
            }
        });

        // Lấy Đơn sự kiện Live Feed (Realtime)
        const [recentOrders] = await db.query(`SELECT e.*, u.username FROM event_orders e JOIN users u ON e.user_id = u.id ORDER BY e.created_at DESC LIMIT 5`);

        // Lấy bài viết tin tức
        const [latestArticles] = await db.query(`SELECT id, title, slug, thumbnail, views, created_at FROM articles WHERE status = 'published' ORDER BY created_at DESC LIMIT 4`);
        const [popularArticles] = await db.query(`SELECT id, title, slug, thumbnail, views FROM articles WHERE status = 'published' ORDER BY views DESC LIMIT 3`);

        // Lấy Lịch Sử Thẻ Nạp của user
        let cardHistory = [];
        if (req.user) {
            const [cards] = await db.query("SELECT network, amount, status, created_at FROM card_requests WHERE user_id = ? ORDER BY id DESC LIMIT 3", [req.user.id]);
            cardHistory = cards;
        }

        // ============================================================
        // 4. BỘ TỪ KHÓA & SCHEMA SEO SIÊU MẠNH CHO TRANG CHỦ
        // ============================================================
        let pageTitle = 'Shop Acc Liên Quân | shoplienquan.site - SHOP LIÊN QUÂN GIÁ RẺ - UY TÍN SỐ 1';
        let pageDesc = 'Chuyên bán Acc Liên Quân uy tín, túi mù 9k, cày thuê rank, thuê acc VIP giá rẻ. Tham gia sự kiện Gieo Quẻ, Chung sức nhận Skin SS ngay hôm nay!';
        let seoKeywords = 'shoplienquan, shoplienquan site, shopmcuong,shopacclienquan,shoplychuotbach,shoptaienzo,shop liên quân, mua acc liên quân, shop acc uy tín, nạp thẻ garena, mua nick lq, túi mù 9k, thuê acc liên quân, cày thuê liên quân, vòng quay liên quân, săn acc 1đ';
        
        if (page > 1) {
            pageTitle += ` - Trang ${page}`;
            pageDesc += ` - Trang ${page}`;
        }

        // Schema.org tổng hợp cho trang chủ
        const seoSchema = {
            "@context": "https://schema.org",
            "@graph": [
                {
                    "@type": "WebSite",
                    "name": "Shop Liên Quân Chuyên Nghiệp",
                    "url": "https://shoplienquan.site/",
                    "potentialAction": {
                        "@type": "SearchAction",
                        "target": "https://shoplienquan.site/tai-khoan?category={search_term_string}",
                        "query-input": "required name=search_term_string"
                    }
                },
                {
                    "@type": "Organization",
                    "name": "ShopLienQuan.Site",
                    "url": "https://shoplienquan.site/",
                    "logo": "https://shoplienquan.site/images/logo.png",
                    "description": "Nền tảng mua bán tài khoản và dịch vụ game tự động.",
                    "aggregateRating": {
                        "@type": "AggregateRating",
                        "ratingValue": "4.9",
                        "reviewCount": "2458"
                    }
                }
            ]
        };

        // 5. TRẢ DỮ LIỆU RA GIAO DIỆN
        res.render(`themes/${theme}/index`, {
            title: pageTitle,
            description: pageDesc,
            keywords: seoKeywords,
            schemaData: JSON.stringify(seoSchema), // Ép Schema ra File Head
            eventConfig, 
            products,
            banners,          
            quickActions, 
            recentOrders,
            latestArticles,
            popularArticles,
            cardHistory,
            pagination: { page, totalPages },
            currentCategory: category,
            user: req.user
        });

    } catch (err) {
        console.error("Lỗi trang chủ:", err);
        res.status(500).send("Lỗi Server");
    }
};

// ============================================================
// [BƯỚC 2] TRANG CHI TIẾT TÀI KHOẢN (GIỮ NGUYÊN)
// ============================================================
exports.getProductDetail = async (req, res) => {
    try {
        const theme = req.theme || 'default';
        const slug = req.params.slug;
        
        const [rows] = await db.query("SELECT * FROM products WHERE slug = ?", [slug]);
        if (rows.length === 0) {
            return res.status(404).render(`themes/${theme}/404`, { title: "Không tìm thấy Acc", user: req.user });
        }
        const product = rows[0];

        try {
            if (product.details && typeof product.details === 'string') {
                product.details = JSON.parse(product.details);
            }
        } catch (e) {
            product.details = {}; 
        }

        const [relatedProducts] = await db.query(`
            SELECT id, title, slug, image_url, price_old, price_new 
            FROM products 
            WHERE category = ? AND id != ? AND status = 'available' 
            ORDER BY ABS(price_new - ?) ASC 
            LIMIT 4
        `, [product.category, product.id, product.price_new]);

        res.render(`themes/${theme}/detail`, {
            title: `${product.title} - Shop Liên Quân Uy Tín`, 
            product: product,
            relatedProducts: relatedProducts,
            user: req.user
        });

    } catch (err) {
        res.status(500).send("Lỗi tải chi tiết tài khoản!");
    }
};

exports.createProduct = async (req, res) => {
    try {
        const { title, category, price_old, price_new, acc_username, acc_password, image_url } = req.body;
        const slug = createSlug(title) + '-' + Date.now(); 
        const sql = `INSERT INTO products (title, slug, category, price_old, price_new, image_url, acc_username, acc_password) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
        await db.query(sql, [title, slug, category, price_old, price_new, image_url, acc_username, acc_password]);
        res.json({ message: "✅ Thêm sản phẩm thành công!", slug: slug });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// ============================================================
// [BƯỚC 3] TRANG KHO ACC (HIỂN THỊ DANH SÁCH & BỘ LỌC)
// ============================================================
exports.getAccountPage = async (req, res) => {
    try {
        const theme = req.theme || 'default';
        const page = parseInt(req.query.page) || 1;
        const limit = 16; 
        const offset = (page - 1) * limit;
        const priceRange = req.query.price || 'all';

        let whereClause = "WHERE status = 'available' AND category != 'tui_mu' AND category != 'pet_linh_bao'";
        if (priceRange === '100-300') whereClause += " AND price_new >= 100000 AND price_new <= 300000";
        else if (priceRange === '300-600') whereClause += " AND price_new > 300000 AND price_new <= 600000";
        else if (priceRange === '600-1m5') whereClause += " AND price_new > 600000 AND price_new <= 1500000";
        else if (priceRange === 'above-1m5') whereClause += " AND price_new > 1500000";

        const [hotProducts] = await db.query(`SELECT * FROM products WHERE status = 'available' AND is_hot = 1 LIMIT 4`);
        const [countResult] = await db.query(`SELECT COUNT(*) as total FROM products ${whereClause}`);
        const totalPages = Math.ceil(countResult[0].total / limit);
        const [products] = await db.query(`SELECT * FROM products ${whereClause} ORDER BY is_hot DESC, id DESC LIMIT ? OFFSET ?`, [limit, offset]);

        const [recentSales] = await db.query(`SELECT o.created_at, u.username, p.title FROM acc_orders o JOIN users u ON o.user_id = u.id JOIN products p ON o.product_id = p.id ORDER BY o.created_at DESC LIMIT 10`);

        // BỘ TỪ KHÓA & SCHEMA CHO KHO ACC
        const seoKeywords = "shoplienquan, shoplienquan site, shopmcuong,shopacclienquan,shoplychuotbach,shoptaienzo,tài khoản liên quân, mua acc liên quân trắng thông tin, nick liên quân vip, acc lq giá rẻ 50k, kho acc liên quân";
        
        const seoSchema = {
            "@context": "https://schema.org",
            "@type": "ItemList",
            "itemListElement": products.map((p, index) => ({
                "@type": "ListItem",
                "position": index + 1,
                "url": `https://shoplienquan.site/chi-tiet/${p.slug}`,
                "name": p.title
            }))
        };

        res.render(`themes/${theme}/accounts`, {
            title: page > 1 ? `Kho Tài Khoản Liên Quân Vip - Trang ${page}` : 'Danh Sách Acc Liên Quân Vip - Kho Tài Khoản Game Uy Tín',
            description: 'Khám phá hàng ngàn tài khoản Liên Quân Mobile giá siêu rẻ, từ nick tân thủ đến nick rank Thách Đấu trắng thông tin.',
            keywords: seoKeywords,
            schemaData: JSON.stringify(seoSchema),
            hotProducts,
            products,
            recentSales,
            pagination: { page, totalPages },
            currentPrice: priceRange,
            user: req.user
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Lỗi tải trang sản phẩm");
    }
};

// ============================================================
// [BƯỚC 4] TRANG SEO CLONE (CÁC TRANG LANDING PAGE PHỤ)
// ============================================================
exports.getClonePage = async (req, res) => {
    try {
        const theme = req.theme || 'default';
        const slug = req.params.slug;

        const [pages] = await db.query("SELECT * FROM seo_pages WHERE slug = ?", [slug]);
        if (pages.length === 0) return res.status(404).send("Trang không tồn tại");
        
        const config = pages[0];

        const page = parseInt(req.query.page) || 1;
        const limit = 16;
        const offset = (page - 1) * limit;
        const currentPrice = req.query.price || 'all';

        let whereClause = "WHERE status = 'available'";
        if (currentPrice === '100-300') whereClause += " AND price_new >= 100000 AND price_new <= 300000";
        else if (currentPrice === '300-600') whereClause += " AND price_new > 300000 AND price_new <= 600000";
        else if (currentPrice === 'above-1m5') whereClause += " AND price_new > 1500000";

        const [products] = await db.query(`SELECT * FROM products ${whereClause} ORDER BY is_hot DESC, id DESC LIMIT ? OFFSET ?`, [limit, offset]);
        const [countResult] = await db.query(`SELECT COUNT(*) as total FROM products ${whereClause}`);
        const totalPages = Math.ceil(countResult[0].total / limit);

        const [relatedArticles] = await db.query("SELECT id, title, slug, thumbnail, views FROM articles WHERE category = ? AND status = 'published' LIMIT 4", [config.article_category]);

        const [recentSales] = await db.query(`SELECT o.created_at, u.username, p.title FROM acc_orders o JOIN users u ON o.user_id = u.id JOIN products p ON o.product_id = p.id ORDER BY o.created_at DESC LIMIT 8`);

        // SCHEMA ĐỘNG DỰA TRÊN TÊN TRANG CLONE ĐỂ LẤY TOP GOOGLE
        const seoSchema = {
            "@context": "https://schema.org",
            "@type": "WebPage",
            "name": config.title,
            "description": config.description,
            "url": `https://shoplienquan.site/shop/${slug}`
        };

        res.render(`themes/${theme}/accounts`, {
            title: config.title, 
            description: config.description, 
            keywords: config.keywords || 'shop acc lq, mua nick lq vip',
            schemaData: JSON.stringify(seoSchema), // Ép Schema Clone
            customH1: config.h1_title, 
            seoContent: config.seo_content, 
            products, 
            relatedArticles, 
            recentSales,
            currentPrice,
            currentCategory: 'all', 
            pagination: { page, totalPages },
            user: req.user
        });

    } catch (err) {
        console.error(err);
        res.status(500).send("Lỗi hệ thống trang SEO");
    }
};