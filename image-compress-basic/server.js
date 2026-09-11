const express = require("express");
const multer = require("multer");
const sharp = require("sharp");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

// ----- Cấu hình thư mục -----
const UPLOAD_DIR = path.join(__dirname, "public", "uploads");
const OUTPUT_DIR = path.join(__dirname, "public", "output");
[UPLOAD_DIR, OUTPUT_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ----- Cấu hình Multer (lưu file tạm trong RAM, không ghi trực tiếp ra đĩa với tên gốc) -----
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // giới hạn 10MB / file
  },
  fileFilter: (req, file, cb) => {
    const allowedMimeTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!allowedMimeTypes.includes(file.mimetype)) {
      return cb(new Error("Chỉ chấp nhận file JPEG, PNG hoặc WebP."));
    }
    cb(null, true);
  },
});

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

// ----- API: Nén 1 ảnh -----
app.post("/api/compress", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Không có file nào được gửi lên." });
    }

    // Đọc tham số nén từ query/body, có giá trị mặc định an toàn
    const quality = Math.min(100, Math.max(1, parseInt(req.body.quality) || 70));
    const format = ["jpeg", "png", "webp"].includes(req.body.format)
      ? req.body.format
      : "jpeg";
    const width = req.body.width ? parseInt(req.body.width) : null;

    const originalSize = req.file.buffer.length;

    // Xử lý ảnh bằng Sharp
    let pipeline = sharp(req.file.buffer, { limitInputPixels: 268402689 }) // chặn ảnh có độ phân giải bất thường
      .rotate(); // tự động xoay đúng chiều theo EXIF trước khi xử lý

    if (width) {
      pipeline = pipeline.resize({ width, withoutEnlargement: true });
    }

    if (format === "jpeg") {
      pipeline = pipeline.jpeg({ quality });
    } else if (format === "webp") {
      pipeline = pipeline.webp({ quality });
    } else if (format === "png") {
      pipeline = pipeline.png({ quality });
    }

    const outputBuffer = await pipeline.toBuffer();

    // Đặt tên file ngẫu nhiên, không dùng tên gốc do người dùng cung cấp
    const fileName = `${crypto.randomUUID()}.${format === "jpeg" ? "jpg" : format}`;
    const outputPath = path.join(OUTPUT_DIR, fileName);
    fs.writeFileSync(outputPath, outputBuffer);

    const compressedSize = outputBuffer.length;
    const reductionPercent = (((originalSize - compressedSize) / originalSize) * 100).toFixed(1);

    res.json({
      success: true,
      originalSize,
      compressedSize,
      reductionPercent,
      url: `/output/${fileName}`,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Đã có lỗi xảy ra khi xử lý ảnh." });
  }
});

// Xử lý lỗi từ Multer (VD: file quá lớn, sai định dạng)
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || err) {
    return res.status(400).json({ error: err.message });
  }
  next();
});

app.listen(PORT, () => {
  console.log(`Server đang chạy tại http://localhost:${PORT}`);
});
