HƯỚNG DẪN DEPLOY WEBSITE NODE.JS LÊN VPS (UBUNTU)
Dự án: ShopLienQuan.Site

GIAI ĐOẠN 1: CHUẨN BỊ Ở MÁY TÍNH CÁ NHÂN (LOCAL)
Trước khi đụng vào VPS, bạn cần đóng gói hành lý gọn gàng.

Bước 1: Xuất dữ liệu (Database)
Mở XAMPP, bật MySQL, vào http://localhost/phpmyadmin.

Bấm vào tên database của bạn (shop_genz_db hoặc tên bạn đã đặt).

Trên thanh menu trên cùng, chọn tab Export (Xuất).

Bấm nút Export (hoặc Thực hiện).

Bạn sẽ tải về một file tên là shop_genz_db.sql. Đổi tên nó thành data.sql cho ngắn gọn.

Bước 2: Đóng gói Code
Vào thư mục chứa code dự án của bạn.

QUAN TRỌNG: Tìm thư mục node_modules và BỎ QUA NÓ (Không nén thư mục này, vì nó rất nặng và lên VPS sẽ cài lại sau).

Chọn tất cả các file/thư mục còn lại (bao gồm controllers, views, public, server.js, package.json...) -> Chuột phải -> Add to archive (Nén) -> Chọn định dạng .ZIP.

Đặt tên file là: code.zip.

👉 Kết quả Giai đoạn 1: Bạn có 2 file quan trọng: data.sql và code.zip.

GIAI ĐOẠN 2: KẾT NỐI VÀ CÀI ĐẶT MÔI TRƯỜNG VPS
Bước 1: Tải phần mềm kết nối
Tải và cài đặt phần mềm MobaXterm (Bản Home Free). Đây là phần mềm tốt nhất vì nó cho phép bạn vừa gõ lệnh, vừa kéo thả file upload dễ dàng.

Bước 2: Đăng nhập VPS
Mở MobaXterm.

Chọn Session -> SSH.

Remote host: Nhập địa chỉ IP của VPS (Ví dụ: 103.123.xxx.xxx).

Specify username: Tick vào và nhập root.

Bấm OK.

Nó sẽ hỏi mật khẩu (Password). Bạn nhập mật khẩu VPS vào (Lưu ý: Khi nhập mật khẩu Linux sẽ không hiện dấu sao, cứ nhập đúng rồi Enter).

Bước 3: Cài đặt các phần mềm cần thiết
Copy từng dòng lệnh dưới đây, dán vào màn hình đen của VPS (Chuột phải để dán) rồi Enter.

Cập nhật VPS:

Bash
sudo apt update && sudo apt upgrade -y
Cài đặt Node.js (Bản 18):

Bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs
Kiểm tra cài xong chưa bằng lệnh: node -v (Nếu hiện v18.x.x là ok).

Cài đặt MySQL (Cơ sở dữ liệu):

Bash
sudo apt install mysql-server -y
Cài đặt Nginx (Phần mềm máy chủ web):

Bash
sudo apt install nginx -y
Cài đặt PM2 (Công cụ giúp web chạy vĩnh viễn):

Bash
sudo npm install -g pm2
Cài đặt Unzip (Để giải nén file):

Bash
sudo apt install unzip -y
GIAI ĐOẠN 3: UPLOAD CODE VÀ DỮ LIỆU
Bước 1: Upload file
Nhìn sang cột bên trái của MobaXterm (Tab SFTP).

Gõ vào thanh địa chỉ thư mục: /var/www/ rồi Enter.

Chuột phải vào khoảng trắng -> New Folder -> Đặt tên shoplienquan.

Mở thư mục shoplienquan vừa tạo.

Kéo 2 file code.zip và data.sql từ máy tính của bạn thả vào ô bên trái này. Đợi nó chạy xong 100%.

Bước 2: Giải nén
Quay lại màn hình đen bên phải, gõ lệnh:

Bash
cd /var/www/shoplienquan
unzip code.zip
(Bây giờ code đã nằm trên VPS).

GIAI ĐOẠN 4: CẤU HÌNH DATABASE
Bước 1: Tạo Database & User
Gõ lệnh để vào MySQL:

Bash
sudo mysql
Trong giao diện MySQL (có chữ mysql>), copy đoạn này dán vào (Nhớ sửa MAT_KHAU_CUA_BAN thành mật khẩu bạn muốn đặt cho DB):

SQL
-- 1. Tạo Database
CREATE DATABASE shop_genz_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 2. Tạo User quản lý DB (để bảo mật hơn root)
CREATE USER 'admin_shop'@'localhost' IDENTIFIED WITH mysql_native_password BY 'MAT_KHAU_CUA_BAN';

-- 3. Cấp quyền cho User
GRANT ALL PRIVILEGES ON shop_genz_db.* TO 'admin_shop'@'localhost';
FLUSH PRIVILEGES;

-- 4. Thoát
EXIT;
Bước 2: Nhập dữ liệu (Import)
Gõ lệnh sau để đổ dữ liệu từ file data.sql vào database mới tạo:

Bash
mysql -u admin_shop -p shop_genz_db < data.sql
(Nó sẽ hỏi pass, nhập cái MAT_KHAU_CUA_BAN bạn vừa tạo ở trên).

GIAI ĐOẠN 5: CẤU HÌNH DỰ ÁN
Bước 1: Cài thư viện (node_modules)
Vẫn đang ở thư mục /var/www/shoplienquan, gõ lệnh:

Bash
npm install
(Chờ nó chạy một lúc để tải các thư viện về).

Bước 2: Tạo file cấu hình môi trường (.env)
Gõ lệnh:

Bash
nano .env
Nó sẽ mở ra một trình soạn thảo. Bạn copy nội dung sau dán vào:

Đoạn mã
PORT=3000
DB_HOST=localhost
DB_USER=admin_shop
DB_PASS=MAT_KHAU_CUA_BAN
DB_NAME=shop_genz_db
SESSION_SECRET=chuoi_ky_tu_bi_mat_bat_ky
(Thay MAT_KHAU_CUA_BAN cho khớp với bước tạo DB).

Cách lưu và thoát:

Bấm Ctrl + O (chữ O) -> Bấm Enter (Để lưu).

Bấm Ctrl + X (Để thoát).

Bước 3: Chạy thử
Gõ lệnh:

Bash
pm2 start server.js --name "shop-main"
pm2 save
pm2 startup
(Nếu thấy hiện chữ online màu xanh lá là web đã chạy).

GIAI ĐOẠN 6: TRỎ TÊN MIỀN (DOMAIN) VÀ HTTPS
Bước 1: Cấu hình DNS (Tại nơi bạn mua tên miền)
Vào trang quản lý tên miền (như Tenten, Pavietnam, Godaddy...), tạo 2 bản ghi:

Loại A, Tên: @, Giá trị: IP_VPS_CUA_BAN

Loại A, Tên: www, Giá trị: IP_VPS_CUA_BAN

Bước 2: Cấu hình Nginx (Cổng chào)
Gõ lệnh tạo file cấu hình:

Bash
sudo nano /etc/nginx/sites-available/shoplienquan.site
Dán nội dung sau vào:

Nginx
server {
    listen 80;
    server_name shoplienquan.site www.shoplienquan.site;

    location / {
        proxy_pass http://localhost:3000; # Chuyển hướng vào Node.js đang chạy
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
(Lưu lại: Ctrl+O -> Enter -> Ctrl+X)

Bước 3: Kích hoạt Nginx
Chạy lần lượt các lệnh:

Bash
# Tạo liên kết
sudo ln -s /etc/nginx/sites-available/shoplienquan.site /etc/nginx/sites-enabled/

# Kiểm tra lỗi
sudo nginx -t 

# Khởi động lại Nginx
sudo systemctl restart nginx
Bước 4: Cài SSL (Ổ khóa xanh bảo mật)
Chạy lệnh:

Bash
sudo apt install certbot python3-certbot-nginx -y
sudo certbot --nginx -d shoplienquan.site -d www.shoplienquan.site
Nó hỏi email: Nhập email bạn.

Nó hỏi Agree (A): Gõ A rồi Enter.

Nó hỏi Share Email: Gõ N rồi Enter.

Nếu thành công, nó sẽ báo Congratulations!.

🎉 HOÀN TẤT!
Bây giờ hãy mở trình duyệt và vào: https://shoplienquan.site.

Web của bạn đã online, có bảo mật SSL, chạy tự động 24/7.
Nếu cần sửa code:

Sửa ở máy tính.

Upload file đã sửa đè lên file cũ bằng MobaXterm.

Gõ lệnh pm2 restart shop-main để cập nhật.

Chúc bạn kiếm thật nhiều tiền với Shop mới này nhé!




1. Lỗi Khách Hàng Không Xem Được Pass Acc (LỖI LOGIC - Ưu tiên 1)
Vấn đề: Ở file adminController.js, ta đã Mã hóa AES mật khẩu game trước khi lưu vào Data. Thế nhưng, ở file userController.js (hàm getProfile), ta lại QUÊN chưa Giải mã nó ra.

Hậu quả: Khách nạp tiền -> Mua acc thành công -> Vào Lịch sử mua hàng xem thì thấy mật khẩu là một chuỗi loằng ngoằng dài dằng dặc (Mã AES) chứ không phải mật khẩu thật. Khách sẽ chửi shop lừa đảo ngay!

Giải pháp: Cần bổ sung cryptoHelper.decrypt() vào hàm lấy thông tin lịch sử của userController.js.

2. Lỗ Hổng Nạp Thẻ (BẢO MẬT API - Ưu tiên 2)
Vấn đề: Trong rechargeRoutes.js, đường dẫn /api/recharge/callback đang mở tự do (chỉ có giới hạn tốc độ callbackLimiter). Mặc dù bạn có check chữ ký MD5, nhưng để an toàn tuyệt đối 100%, bạn phải chặn tất cả các IP lạ.

Hậu quả: Kẻ gian có thể dùng Tool dò tìm chữ ký để bắn tin nhắn nạp thẻ giả vào Server của bạn.

Giải pháp: Viết thêm 1 Middleware nhỏ ipWhitelist chỉ cho phép IP của máy chủ doithe1s.vn (hoặc đối tác gạch thẻ) được phép gọi vào route này.

3. Cấu hình Session Bị Rớt Khi Lên HTTPS (VẬN HÀNH - Ưu tiên 3)
Vấn đề: Khi bạn chạy Localhost (http://localhost) thì không sao. Nhưng khi đưa lên Tên miền thật (https://shoplienquan.site), trình duyệt (đặc biệt là Chrome, Safari bản mới) sẽ chặn Cookie nếu bạn không set cờ Secure.

Hậu quả: Khách đăng nhập xong, chuyển sang trang khác lại bị văng ra (bắt đăng nhập lại). Tính năng Nạp thẻ cũng lỗi vì mất Session.

Giải pháp: Vào file server.js, trong phần cấu hình express-session, cần bật secure: true và sameSite: 'lax'.