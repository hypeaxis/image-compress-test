# Kế hoạch Phát triển: Dịch vụ Nén Ảnh Cơ bản (Basic Version)

> **Phạm vi:** Xây dựng 1 Backend cơ bản (Express + Multer + Sharp) và 1 Frontend cơ bản (HTML/JS thuần) để upload và nén ảnh — **không** bao gồm queue, worker, cloud storage, batch processing. Mục tiêu là chạy đúng, gọn, dễ hiểu, dễ bảo trì.

---

## 1. Mục tiêu

- Người dùng chọn/kéo-thả 1 ảnh → chỉnh quality/định dạng → nhận lại ảnh đã nén.
- Xử lý đồng bộ trong 1 request (không cần hạ tầng phức tạp).
- Đủ an toàn cơ bản để không bị lỗi/crash khi dùng thực tế trong phạm vi nhỏ (cá nhân, nội bộ, demo).

---

## 2. Kiến trúc (đơn giản hóa)

```
[Trình duyệt]
   │  1. Chọn ảnh, chỉnh quality/format
   │  2. Gửi POST /api/compress (multipart/form-data)
   ▼
[Express Server]
   │  3. Multer nhận file vào memory (buffer)
   │  4. Validate: MIME type, size, giới hạn pixel
   │  5. Sharp xử lý: resize (nếu có) → set quality → convert format
   │  6. Lưu file kết quả vào /public/output với tên UUID
   │  7. Trả JSON: { url, originalSize, compressedSize, reductionPercent }
   ▼
[Trình duyệt]
   │  8. Hiển thị ảnh Before/After + % giảm dung lượng
```

Không dùng Queue/Worker/S3 ở giai đoạn này — vì với 1 ảnh/lần, xử lý đồng bộ trong request là đủ. Đây là điểm khác biệt chính so với bản kế hoạch "production-ready" đầy đủ.

---

## 3. Các bước triển khai (Task list)

### Bước 1 — Backend cơ bản
- [x] Setup Express server, route `POST /api/compress`.
- [x] Cấu hình Multer: `memoryStorage`, giới hạn `fileSize` (VD 10MB).
- [x] Validate MIME type qua whitelist (`image/jpeg`, `image/png`, `image/webp`).
- [x] Xử lý ảnh bằng Sharp: `quality`, `format` (jpeg/png/webp), resize theo `width` (tùy chọn).
- [x] Auto-rotate theo EXIF trước khi xử lý.
- [x] Đặt tên file output bằng UUID (không dùng tên gốc do user gửi).
- [x] Trả về thống kê: dung lượng gốc, dung lượng sau nén, % giảm.
- [x] Middleware xử lý lỗi (file quá lớn, sai định dạng, lỗi xử lý ảnh).

### Bước 2 — Frontend cơ bản
- [x] Vùng kéo-thả + chọn file (drag & drop).
- [x] Điều khiển: slider quality, dropdown chọn định dạng output.
- [x] Gọi API bằng `fetch` + `FormData`.
- [x] Hiển thị ảnh Before/After song song.
- [x] Hiển thị % giảm dung lượng.
- [x] Nút tải ảnh đã nén về máy.
- [x] Thông báo lỗi rõ ràng khi upload thất bại.

### Bước 3 — Kiểm thử thủ công (đủ dùng ở quy mô nhỏ)
- [ ] Test với ảnh JPEG, PNG, WebP kích thước khác nhau (nhỏ, vừa, ~10MB).
- [ ] Test file sai định dạng (VD đổi đuôi `.txt` thành `.jpg`) → phải bị chặn.
- [ ] Test file vượt quá 10MB → phải trả lỗi rõ ràng, không crash server.
- [ ] Test ảnh có kích thước pixel cực lớn (ảnh "bomb") → phải bị chặn bởi `limitInputPixels`.
- [ ] Test trên trình duyệt khác nhau (Chrome, Safari, Firefox) và trên mobile.

### Bước 4 — Dọn dẹp & vận hành cơ bản
- [ ] Thêm cron job hoặc script dọn định kỳ thư mục `public/output` (tránh đầy ổ đĩa theo thời gian) — VD xóa file cũ hơn X ngày.
- [ ] Thêm biến môi trường (`.env`) cho các giá trị cấu hình: max file size, port, quality mặc định — tránh hardcode.
- [ ] Ghi log cơ bản (request nào, file nào, thành công/thất bại) để dễ debug khi có lỗi.

---

## 4. Những gì đã cố tình lược bỏ (so với bản Production-ready)

Để giữ đúng tinh thần "cơ bản", các hạng mục sau **chưa cần làm ngay**, chỉ nên cân nhắc khi có nhu cầu thực tế phát sinh:

| Hạng mục | Khi nào mới cần |
|---|---|
| Message Queue (BullMQ/RabbitMQ) + Worker riêng | Khi có nhiều user dùng đồng thời, xử lý ảnh bắt đầu làm chậm server |
| Cloud Storage (S3) + CDN | Khi cần lưu trữ lâu dài, phục vụ nhiều người dùng, hoặc deploy nhiều server |
| Batch processing (nén nhiều ảnh cùng lúc) | Khi người dùng có nhu cầu xử lý hàng loạt |
| Rate limiting, authentication | Khi mở public cho nhiều người dùng không kiểm soát |
| Load test, APM/monitoring | Khi chuẩn bị scale lên traffic thật |

Việc lược bỏ này là chủ đích — tránh over-engineering cho một tính năng đang ở quy mô nhỏ, nhưng bảng trên có thể dùng làm "danh sách nâng cấp" khi cần mở rộng sau này.

---

## 5. Ràng buộc & an toàn tối thiểu (vẫn giữ dù là bản cơ bản)

Dù đơn giản, vẫn nên giữ các ràng buộc sau vì chi phí triển khai thấp nhưng rủi ro nếu bỏ qua là cao:

- Giới hạn kích thước file (`fileSize` trong Multer).
- Whitelist MIME type (không dùng blacklist).
- Giới hạn pixel đầu vào (`limitInputPixels` trong Sharp) — chống ảnh "bomb" gây treo server.
- Không lưu file với tên gốc do user đặt (dùng UUID) — tránh path traversal.
- Không serve trực tiếp thư mục upload gốc (nếu sau này giữ lại ảnh gốc).

---

## 6. Kết quả bàn giao

- 1 thư mục project chạy được bằng `npm install && npm start`.
- 1 endpoint `POST /api/compress` nhận ảnh, trả về ảnh đã nén + thống kê.
- 1 trang `index.html` cho phép thao tác toàn bộ luồng trên trình duyệt, không cần công cụ ngoài.

Khi nào cần mở rộng thêm (nhiều người dùng, nén hàng loạt, deploy production thật), có thể quay lại dùng bản kế hoạch đầy đủ ở phần trước làm lộ trình nâng cấp.
