const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController'); // Dùng chung controller
const { ensureAuthenticated } = require('../middleware/authMiddleware');
const { orderLimiter } = require('../middleware/apiSecurity');

// Route Sự kiện: POST /api/event/join
// Bây giờ server đã hiểu ensureAuthenticated và orderLimiter là gì
router.post('/join', ensureAuthenticated, orderLimiter, orderController.joinEvent);

module.exports = router;