const express = require('express');
const router = express.Router();
const roomController = require('../controllers/matchmaking/roomController');
const vipController = require('../controllers/matchmaking/vipController');
const actionController = require('../controllers/matchmaking/actionController'); // File mới
const { ensureAuthenticated } = require('../middleware/authMiddleware');
const voteController = require('../controllers/matchmaking/voteController');

router.get('/', roomController.getLobby);
router.post('/create', ensureAuthenticated, roomController.createRoom);
router.post('/unlock', ensureAuthenticated, vipController.unlockRoom);
router.post('/vote', ensureAuthenticated, voteController.submitVote);

// 3 ROUTE MỚI CHO LOGIC PHÒNG ẢO
router.post('/join', ensureAuthenticated, actionController.joinRoom);
router.post('/leave', ensureAuthenticated, actionController.leaveRoom);
router.post('/report', ensureAuthenticated, actionController.reportRoom);

module.exports = router;