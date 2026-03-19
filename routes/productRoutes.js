const express = require('express');
const router = express.Router();

const productController = require('../controllers/productController');
const cardController = require('../controllers/cardController');
const blindBoxController = require('../controllers/blindBoxController');
const flashSaleController = require('../controllers/flashSaleController');
const trustController = require('../controllers/trustController');
const minigameController = require('../controllers/minigameController');
const chungsucController = require('../controllers/chungsucController');
const xinxamController = require('../controllers/xinxamController');
const boostController = require('../controllers/boostController');
const rentController = require('../controllers/rentController');
const apiController = require('../controllers/apiController');

const { ensureAuthenticated } = require('../middleware/authMiddleware');

// ==========================================
// 1. TRANG CHỦ & SẢN PHẨM
// ==========================================
router.get('/', productController.getHomePage);
router.get('/chi-tiet/:slug', productController.getProductDetail);
router.get('/tai-khoan', productController.getAccountPage);
router.get('/shop/:slug', productController.getClonePage);

// ==========================================
// 2. THÔNG TIN TĨNH & UY TÍN
// ==========================================
router.get('/check-uy-tin', trustController.getTrustPage);

router.get('/huong-dan', (req, res) => {
    const theme = req.theme || 'default';
    res.render(`themes/${theme}/guide`, { user: req.user });
});

router.get('/chinh-sach', (req, res) => {
    const theme = req.theme || 'default';
    res.render(`themes/${theme}/policy`, { user: req.user });
});

// ==========================================
// 3. DỊCH VỤ NẠP THẺ 
// ==========================================
router.get('/mua-the', cardController.getBuyCardPage);
router.post('/mua-the', ensureAuthenticated, cardController.processBuyCard);

// ==========================================
// 4. HỆ SINH THÁI TÚI MÙ (BLIND BOX)
// ==========================================
router.get('/tui-mu', blindBoxController.getStorePage);
router.post('/tui-mu/buy', ensureAuthenticated, blindBoxController.buyBlindBox);

router.get('/unbox/:orderCode', ensureAuthenticated, blindBoxController.getUnboxRoom);
router.post('/unbox/process', ensureAuthenticated, blindBoxController.processUnbox);

router.get('/kho-vip', blindBoxController.getVipVault);
router.post('/kho-vip/exchange', ensureAuthenticated, blindBoxController.exchangeVipAcc);

router.get('/tu-do', ensureAuthenticated, blindBoxController.getInventory);

// ==========================================
// 5. ĐƯỜNG DẪN SĂN ACC 1Đ
// ==========================================
router.get('/san-acc-1d', flashSaleController.getFlashSalePage);
router.post('/san-acc-1d/buy', ensureAuthenticated, flashSaleController.buyFlashSaleAcc);

// ==========================================
// 6. HỆ SINH THÁI GACHA (MINIGAMES)
// ==========================================
router.get('/minigame', minigameController.getLobby); // Sảnh Gacha
router.get('/minigame/:slug', minigameController.getMinigamePage); // Vào chơi 1 game cụ thể
router.post('/minigame/play', ensureAuthenticated, minigameController.playGame); // Bấm quay (Cần đăng nhập)
router.get('/api/minigame/recent-winners', minigameController.getRecentWinners);

// ==========================================
// 7. HỆ SINH THÁI ĐA SỰ KIỆN CHUNG SỨC
// ==========================================
router.get('/chung-suc', chungsucController.getLobby);
router.get('/chung-suc/:slug', chungsucController.getPage);
router.post('/api/chungsuc/spin', ensureAuthenticated, chungsucController.spin);
router.post('/api/chungsuc/reveal', ensureAuthenticated, chungsucController.reveal);

// ==========================================
// 8. SỰ KIỆN ĐI CHÙA / GIEO QUẺ (BÁN THẺ)
// ==========================================
router.get('/gieo-que', xinxamController.getPage);
router.post('/api/xinxam/free-spin', ensureAuthenticated, xinxamController.freeSpin);
router.post('/api/xinxam/free-reveal', ensureAuthenticated, xinxamController.freeReveal);
router.post('/api/xinxam/buy-paid', ensureAuthenticated, xinxamController.buyPaidCard);


router.get('/cay-thue', boostController.getBoostPage);
router.post('/cay-thue/book', ensureAuthenticated, boostController.bookOrder);


router.get('/thue-acc', rentController.getRentPage);
router.post('/thue-acc/book', ensureAuthenticated, rentController.bookRent);
// API lấy lịch sử giao dịch thật cho Popup Thông Báo (Không cần đăng nhập)
router.get('/api/public/recent-logs', apiController.getRecentPublicLogs);
module.exports = router;