// utils/imageUploader.js
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

// ==========================================
// 1. BẢO MẬT: BỘ LỌC CHỐNG UP SHELL/VIRUS
// ==========================================
const fileFilter = (req, file, cb) => {
    // Chỉ cho phép các định dạng ảnh chuẩn
    const allowedTypes = /jpeg|jpg|png|webp|gif/;
    
    // Kiểm tra đuôi file và Mime Type
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (extname && mimetype) {
        return cb(null, true);
    } else {
        return cb(new Error('Bảo mật: Chỉ cho phép tải lên định dạng hình ảnh (JPG, PNG, WEBP, GIF)!'), false);
    }
};

// ==========================================
// 2. CẤU HÌNH MULTER
// ==========================================
const storage = multer.memoryStorage(); // Lưu tạm RAM để Sharp xử lý

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 20 * 1024 * 1024 }, // Giữ nguyên 20MB theo ý sếp
    fileFilter: fileFilter // Kích hoạt khiên bảo mật
});

// ==========================================
// 3. MIDDLEWARE XỬ LÝ ẢNH (SHARP)
// ==========================================
const resizeAndConvert = async (req, res, next) => {
    if (!req.file) return next();

    try {
        // Chuẩn SEO & Chống ghi đè: Thêm dải số ngẫu nhiên vào tên file
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const filename = `acc-${uniqueSuffix}.webp`;
        
        const uploadDir = path.join(__dirname, '../public/uploads');
        const outputPath = path.join(uploadDir, filename);

        // Tự động tạo thư mục nếu chưa có (Đảm bảo VPS không bị crash)
        if (!fs.existsSync(uploadDir)){
            fs.mkdirSync(uploadDir, { recursive: true });
        }

        // Xử lý ảnh bằng Sharp
        await sharp(req.file.buffer)
            // withoutEnlargement: Bổ sung cái này để nếu ảnh sếp up nhỏ hơn 1200px, nó KHÔNG bị phóng to làm mờ/vỡ hạt
            .resize({ width: 1200, withoutEnlargement: true }) 
            .toFormat('webp', { quality: 85 })
            .toFile(outputPath);

        // Gán tên file chuẩn để Controller lưu vào Database
        req.file.filename = filename; 
        
        next();
    } catch (error) {
        console.error("Lỗi xử lý ảnh bằng Sharp:", error);
        // Trả về JSON để đồng bộ với các API của sếp
        res.status(500).json({
            success: false,
            message: "Lỗi hệ thống khi xử lý ảnh: " + error.message
        });
    }
};

module.exports = { upload, resizeAndConvert };