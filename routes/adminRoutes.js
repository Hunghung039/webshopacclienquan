const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp'); // Thư viện chuyển đổi ảnh WebP

const adminController = require('../controllers/adminController');
const blindBoxController = require('../controllers/blindBoxController');
const flashSaleController = require('../controllers/flashSaleController');
const trustController = require('../controllers/trustController');
const adminMinigameController = require('../controllers/adminMinigameController');
const { ensureAuthenticated, isAdmin } = require('../middleware/authMiddleware');
const adminChungsucController = require('../controllers/adminChungsucController');
const adminXinxamController = require('../controllers/adminXinxamController');
const bulkProductController = require('../controllers/bulkProductController');
const adminMatchmakingController = require('../controllers/matchmaking/adminRoomController');
const adminBoostController = require('../controllers/adminBoostController');
const adminRentController = require('../controllers/adminRentController');
// ============================================================
// 1. CẤU HÌNH UPLOAD VÀ XỬ LÝ ẢNH WEBP (TỐI ƯU SEO)
// ============================================================
const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 20 * 1024 * 1024 }, // 20MB/file
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) cb(null, true);
        else cb(new Error('Chỉ được phép tải lên hình ảnh!'));
    }
});

const resizeAndConvert = async (req, res, next) => {
    // Nhận diện xem có file nào tải lên không (Hỗ trợ cả single, array và fields)
    const hasFile = req.file;
    const hasFilesArray = req.files && Array.isArray(req.files) && req.files.length > 0;
    const hasFilesObject = req.files && !Array.isArray(req.files) && Object.keys(req.files).length > 0;

    if (!hasFile && !hasFilesArray && !hasFilesObject) return next(); 

    // Đổi sang lưu vào /images/ để đồng bộ với đường dẫn đọc ảnh của toàn bộ giao diện
    const uploadDir = path.join(__dirname, '../public/images/');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

    // Hàm xử lý chung cho 1 file
    const processFile = async (file) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const filename = 'img-' + uniqueSuffix + '.webp';
        const outputPath = path.join(uploadDir, filename);
        await sharp(file.buffer).webp({ quality: 80 }).toFile(outputPath);
        file.filename = filename;
        file.path = outputPath;
        file.mimetype = 'image/webp';
    };

    try {
        const promises = [];
        
        if (hasFile) { 
            // Up 1 ảnh (upload.single)
            promises.push(processFile(req.file));
        } 
        if (hasFilesArray) { 
            // Up mảng ảnh (upload.array)
            req.files.forEach(file => promises.push(processFile(file)));
        }
        if (hasFilesObject) {
            // Up nhiều ảnh theo trường (upload.fields - dành cho form Chung Sức mới)
            for (const key in req.files) {
                req.files[key].forEach(file => promises.push(processFile(file)));
            }
        }

        await Promise.all(promises);
        next();
    } catch (error) {
        console.error("❌ Lỗi convert ảnh WebP:", error);
        return res.status(500).json({ success: false, message: "Lỗi xử lý hình ảnh!" });
    }
};

// ============================================================
// 2. MIDDLEWARE BẢO MẬT: CHỈ CHO PHÉP ADMIN ĐI QUA
// ============================================================
// Áp dụng khiên cho TẤT CẢ các link bắt đầu bằng /admin/...
router.use(ensureAuthenticated, isAdmin); 

// ============================================================
// 3. DASHBOARD & THỐNG KÊ
// ============================================================
router.get('/', adminController.getDashboard);

// ============================================================
// 4. QUẢN LÝ SẢN PHẨM (ACC GAME)
// ============================================================
router.get('/products', adminController.getProducts);
router.post('/products/add', upload.single('image'), resizeAndConvert, adminController.createProduct);
// ĐOẠN ĐÃ FIX ĐÚNG TÊN MIDDLEWARE
router.get('/bulk-add', ensureAuthenticated, isAdmin, bulkProductController.getBulkAddPage);
router.post('/bulk-add', ensureAuthenticated, isAdmin, upload.array('images', 50), resizeAndConvert, bulkProductController.postBulkAdd);
router.get('/products/edit/:id', adminController.getProductEdit); 
router.post('/products/update/:id', upload.single('image'), resizeAndConvert, adminController.updateProduct);
router.post('/products/delete/:id', adminController.deleteProduct);

// ============================================================
// 5. QUẢN LÝ ĐƠN HÀNG (SỰ KIỆN & MUA ACC)
// ============================================================
router.get('/orders', adminController.getOrders);
router.post('/orders/event/update', express.json(), adminController.updateEventOrder);
router.post('/orders/delete/:id', adminController.deleteOrder);

// ============================================================
// 6. QUẢN LÝ THÀNH VIÊN (USERS)
// ============================================================
router.get('/users', adminController.getUsers);
router.get('/users/:id', adminController.getUserDetail);

// API Xử lý nhanh bằng AJAX
router.post('/users/money', express.json(), adminController.updateUserMoney);
router.post('/users/password', express.json(), adminController.resetUserPassword);
router.post('/users/ban', express.json(), adminController.banUser);

// ============================================================
// 7. CẤU HÌNH HỆ THỐNG (SETTINGS & UI)
// ============================================================
router.get('/settings', adminController.getSettings);
router.post('/settings/save', express.json(), adminController.saveSettings);

// QUẢN LÝ BANNER SLIDER
router.post('/banners/delete/:id', adminController.deleteBanner);
router.post('/banners/add', upload.single('banner_file'), resizeAndConvert, adminController.addBanner);

// ============================================================
// 8. QUẢN LÝ BÀI VIẾT (BLOG / TIN TỨC)
// ============================================================
router.get('/blogs', adminController.getBlogs);
router.post('/blogs/add', upload.single('thumbnail'), resizeAndConvert, adminController.createBlog);
router.get('/blogs/edit/:id', adminController.getBlogEdit);
router.post('/blogs/update/:id', upload.single('thumbnail'), resizeAndConvert, adminController.updateBlog);
router.post('/blogs/delete/:id', adminController.deleteBlog);

// ============================================================
// 9. QUẢN LÝ TRANG SEO CLONE (PROGRAMMATIC SEO)
// ============================================================
router.get('/seo-pages', adminController.getSeoPages);
router.post('/seo-pages/add', express.json(), adminController.addSeoPage);
router.post('/seo-pages/update/:id', express.json(), adminController.updateSeoPage);
router.post('/seo-pages/delete/:id', adminController.deleteSeoPage);

// ============================================================
// 10. QUẢN LÝ KHO HÌNH ẢNH (MEDIA)
// ============================================================
router.get('/images', adminController.getImageManager);
router.post('/images/upload', upload.single('image_file'), resizeAndConvert, adminController.uploadImage);
router.post('/images/delete', express.json(), adminController.deleteImage);

// ============================================================
// 11. HỆ SINH THÁI GACHA & KHUYẾN MÃI
// ============================================================
// TRANG BÀN BÓC LIVE CỦA ADMIN
router.get('/live-unbox', blindBoxController.getLiveUnboxPage);
router.post('/live-unbox/process', blindBoxController.processLiveUnbox);

// QUẢN LÝ KHO TÚI MÙ
router.get('/blind-box', blindBoxController.getAdminManager);
router.post('/blind-box/category/add', blindBoxController.addCategory);
router.post('/blind-box/category/delete/:id', blindBoxController.deleteCategory);
router.post('/blind-box/account/add', blindBoxController.addAccount);
router.post('/blind-box/account/delete/:id', blindBoxController.deleteAccount);
router.post('/blind-box/vip/update', blindBoxController.updateVipCards);
router.post('/blind-box/accounts/bulk-delete', isAdmin, blindBoxController.bulkDeleteAccounts);
// QUẢN LÝ SỰ KIỆN SĂN ACC 1Đ
router.get('/flash-sale', flashSaleController.getAdminFlashSale);
router.post('/flash-sale/add', flashSaleController.addFlashSaleAcc);
router.post('/flash-sale/delete/:id', flashSaleController.deleteFlashSaleAcc);

// ============================================================
// 12. QUẢN LÝ CHECK UY TÍN 
// ============================================================
router.get('/trust', trustController.getAdminTrust);
router.post('/trust/add', upload.array('images', 10), resizeAndConvert, trustController.addReview); 
router.post('/trust/delete/:id', trustController.deleteReview);

// ============================================================
// 13. QUẢN LÝ HỆ SINH THÁI GACHA (MINIGAMES)
// ============================================================
router.get('/minigames', adminMinigameController.getManager);
// Dùng chung middleware upload và resizeAndConvert để tự nén ảnh Gacha thành WebP
router.post('/minigames/game/add', upload.single('image'), resizeAndConvert, adminMinigameController.addGame);
router.post('/minigames/game/delete/:id', adminMinigameController.deleteGame);

router.post('/minigames/prize/add', upload.single('image'), resizeAndConvert, adminMinigameController.addPrize);
router.post('/minigames/prize/delete/:id', adminMinigameController.deletePrize);
router.get('/minigames/logs', adminMinigameController.getLogs);

// ============================================================
// 14. QUẢN LÝ ĐA SỰ KIỆN CHUNG SỨC
// ============================================================
router.get('/chung-suc', adminChungsucController.getManager);
router.post('/chung-suc/event/add', adminChungsucController.addEvent); 
router.post('/chung-suc/add', adminChungsucController.addCodes);
router.post('/chung-suc/delete/:id', adminChungsucController.deleteCode);
router.post('/chung-suc/delete-all', adminChungsucController.deleteAllCodes);

// API Sửa sự kiện: Lồng ghép upload.fields() và bộ nén ảnh WebP của sếp
router.get('/chung-suc/event/edit/:id', adminChungsucController.editEventPage);
router.post('/chung-suc/event/edit/:id', 
    upload.fields([
        { name: 'banner_file', maxCount: 1 },
        { name: 'back_file', maxCount: 1 },
        { name: 'rare_file', maxCount: 1 },
        { name: 'trash_files', maxCount: 20 } // Cho phép tải lên 1 lúc 20 ảnh rác
    ]), 
    resizeAndConvert, 
    adminChungsucController.updateEvent
);

router.post('/chung-suc/event/delete/:id', adminChungsucController.deleteEvent);
// ============================================================
// 15. QUẢN LÝ SỰ KIỆN GIEO QUẺ (64 THẺ)
// ============================================================

router.get('/xinxam', adminXinxamController.getManager);

// Route cấu hình (Upload Ảnh bìa & Mặt úp thẻ)
router.post('/xinxam/config', upload.fields([
    { name: 'banner_file', maxCount: 1 },
    { name: 'back_file', maxCount: 1 }
]), resizeAndConvert, adminXinxamController.updateConfig);

// Route nạp nhiều thẻ cùng lúc (Tối đa 100 ảnh 1 lần)
router.post('/xinxam/cards/add', upload.array('card_files', 100), resizeAndConvert, adminXinxamController.addCards);
router.post('/xinxam/codes/add', adminXinxamController.addCodesToCard);
router.post('/xinxam/cards/price/:id', adminXinxamController.updateCardPrice);
router.post('/xinxam/cards/delete-all', adminXinxamController.deleteAllCards);
router.post('/xinxam/cards/delete/:id', adminXinxamController.deleteSingleCard);
// Thêm dòng này để nhận dữ liệu nạp thông minh
router.post('/xinxam/codes/import-raw', adminXinxamController.importRawCodes);


// Quản lý Trạm Ghép Đội
router.get('/matchmaking', isAdmin, adminMatchmakingController.getManager);
router.post('/matchmaking/room/delete/:id', isAdmin, adminMatchmakingController.deleteRoom);
router.post('/matchmaking/booster/toggle', isAdmin, adminMatchmakingController.toggleBooster);
router.post('/matchmaking/booster/manual-grant', isAdmin, adminMatchmakingController.manualGrantBooster);


router.get('/cay-thue', isAdmin, adminBoostController.getManager);
router.post('/cay-thue/update', isAdmin, adminBoostController.updateOrder);
router.post('/cay-thue/settings', isAdmin, adminBoostController.updateSettings);
router.post('/cay-thue/delete', isAdmin, adminBoostController.deleteOrder);

router.get('/thue-acc', isAdmin, adminRentController.getManager);
router.post('/thue-acc/add', isAdmin, adminRentController.addAccount);
router.post('/thue-acc/delete/:id', isAdmin, adminRentController.deleteAccount);
router.post('/thue-acc/unlock', isAdmin, adminRentController.forceUnlock);
router.post('/thue-acc/packages', isAdmin, adminRentController.updatePackages);
router.post('/thue-acc/order/delete/:id', isAdmin, adminRentController.deleteRentOrder);
module.exports = router;