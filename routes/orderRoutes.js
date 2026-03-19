const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController'); // Import controller
const { ensureAuthenticated } = require('../middleware/authMiddleware');
const { orderLimiter } = require('../middleware/apiSecurity');

router.post('/buy', ensureAuthenticated, orderLimiter, orderController.buyAccount);

module.exports = router;