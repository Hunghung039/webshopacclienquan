// routes/blogRoutes.js
const express = require('express');
const router = express.Router();
const blogController = require('../controllers/blogController');

// 1. Link danh sách bài viết: https://shoplienquan.site/tin-tuc
router.get('/', blogController.getBlogList);

// 2. Link đọc bài chi tiết: https://shoplienquan.site/tin-tuc/slug-bai-viet-cuc-dep
router.get('/:slug', blogController.getArticleDetail);

module.exports = router;