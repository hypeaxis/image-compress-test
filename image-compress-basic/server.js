const express = require("express");
const multer = require("multer");
const sharp = require("sharp");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { execFile } = require("child_process");
const zlib = require("zlib");
const archiver = require("archiver");

const app = express();
const PORT = process.env.PORT || 3000;

// ----- Cấu hình thư mục -----
const UPLOAD_DIR = path.join(__dirname, "public", "uploads");
const OUTPUT_DIR = path.join(__dirname, "public", "output");
[UPLOAD_DIR, OUTPUT_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ----- Cấu hình Multer: Ảnh -----
const uploadImage = multer({
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

// ----- Cấu hình Multer: PDF -----
const uploadPdf = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // giới hạn 50MB / file
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== "application/pdf") {
      return cb(new Error("Chỉ chấp nhận file PDF."));
    }
    cb(null, true);
  },
});

// ----- Cấu hình Multer: CSV -----
const uploadCsv = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024, // giới hạn 20MB / file
  },
  fileFilter: (req, file, cb) => {
    const allowed = ["text/csv", "application/vnd.ms-excel", "text/plain"];
    const isCsvExt = file.originalname.toLowerCase().endsWith(".csv");
    if (!allowed.includes(file.mimetype) && !isCsvExt) {
      return cb(new Error("Chỉ chấp nhận file CSV."));
    }
    cb(null, true);
  },
});

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

// =============================================
// API 1: Nén ảnh (giữ nguyên logic cũ)
// =============================================
app.post("/api/compress", uploadImage.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Không có file nào được gửi lên." });
    }

    const quality = Math.min(100, Math.max(1, parseInt(req.body.quality) || 70));
    const format = ["jpeg", "png", "webp"].includes(req.body.format)
      ? req.body.format
      : "jpeg";
    const width = req.body.width ? parseInt(req.body.width) : null;

    const originalSize = req.file.buffer.length;

    let pipeline = sharp(req.file.buffer, { limitInputPixels: 268402689 })
      .rotate();

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

// =============================================
// API 2: Nén PDF (Ghostscript)
// =============================================

/**
 * Tìm lệnh Ghostscript trên hệ thống.
 * Thử: gswin64c (Windows 64-bit) → gswin32c (Windows 32-bit) → gs (Linux/macOS)
 */
function findGhostscript() {
  const candidates = process.platform === "win32"
    ? ["gswin64c", "gswin32c", "gs"]
    : ["gs"];
  return candidates;
}

/**
 * Nén PDF bằng Ghostscript.
 * @param {string} inputPath  Đường dẫn file PDF gốc
 * @param {string} outputPath Đường dẫn file PDF output
 * @param {string} quality    Mức nén: screen | ebook | printer | prepress
 * @returns {Promise<void>}
 */
function compressPdfWithGhostscript(inputPath, outputPath, quality) {
  return new Promise((resolve, reject) => {
    const candidates = findGhostscript();
    let lastError = null;

    function tryCandidate(index) {
      if (index >= candidates.length) {
        return reject(
          new Error(
            "Không tìm thấy Ghostscript trên hệ thống. " +
            "Vui lòng cài đặt từ https://ghostscript.com/releases/gsdnld.html"
          )
        );
      }

      const gsCmd = candidates[index];
      const args = [
        "-sDEVICE=pdfwrite",
        "-dCompatibilityLevel=1.4",
        `-dPDFSETTINGS=/${quality}`,
        "-dNOPAUSE",
        "-dQUIET",
        "-dBATCH",
        `-sOutputFile=${outputPath}`,
        inputPath,
      ];

      execFile(gsCmd, args, { timeout: 120000 }, (error) => {
        if (error) {
          // Nếu lệnh không tìm thấy, thử candidate tiếp theo
          if (error.code === "ENOENT") {
            return tryCandidate(index + 1);
          }
          return reject(new Error(`Ghostscript lỗi: ${error.message}`));
        }
        resolve();
      });
    }

    tryCandidate(0);
  });
}

app.post("/api/compress-pdf", uploadPdf.single("pdf"), async (req, res) => {
  const tempInput = path.join(UPLOAD_DIR, `${crypto.randomUUID()}.pdf`);
  const outputFileName = `${crypto.randomUUID()}.pdf`;
  const tempOutput = path.join(OUTPUT_DIR, outputFileName);

  try {
    if (!req.file) {
      return res.status(400).json({ error: "Không có file PDF nào được gửi lên." });
    }

    // Mức nén: screen (72dpi), ebook (150dpi), printer (300dpi)
    const validQualities = ["screen", "ebook", "printer", "prepress"];
    const quality = validQualities.includes(req.body.quality)
      ? req.body.quality
      : "ebook";

    const originalSize = req.file.buffer.length;

    // Ghi file tạm để Ghostscript xử lý
    fs.writeFileSync(tempInput, req.file.buffer);

    await compressPdfWithGhostscript(tempInput, tempOutput, quality);

    const compressedSize = fs.statSync(tempOutput).size;
    const reductionPercent = (((originalSize - compressedSize) / originalSize) * 100).toFixed(1);

    res.json({
      success: true,
      originalSize,
      compressedSize,
      reductionPercent,
      url: `/output/${outputFileName}`,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Đã có lỗi xảy ra khi nén PDF." });
  } finally {
    // Dọn file tạm input
    if (fs.existsSync(tempInput)) {
      fs.unlinkSync(tempInput);
    }
  }
});

// =============================================
// API 3: Nén CSV (archiver/zlib)
// =============================================
app.post("/api/compress-csv", uploadCsv.single("csv"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Không có file CSV nào được gửi lên." });
    }

    const format = req.body.format === "gzip" ? "gzip" : "zip";
    const originalSize = req.file.buffer.length;
    const originalName = req.file.originalname || "data.csv";
    const baseName = path.parse(originalName).name;

    let outputFileName;
    let outputPath;

    if (format === "zip") {
      outputFileName = `${crypto.randomUUID()}.zip`;
      outputPath = path.join(OUTPUT_DIR, outputFileName);

      // Tạo file zip bằng archiver
      await new Promise((resolve, reject) => {
        const output = fs.createWriteStream(outputPath);
        const archive = archiver("zip", { zlib: { level: 9 } }); // nén tối đa

        output.on("close", resolve);
        archive.on("error", reject);

        archive.pipe(output);
        archive.append(req.file.buffer, { name: originalName });
        archive.finalize();
      });
    } else {
      // Gzip bằng zlib built-in
      outputFileName = `${crypto.randomUUID()}.csv.gz`;
      outputPath = path.join(OUTPUT_DIR, outputFileName);

      const compressed = await new Promise((resolve, reject) => {
        zlib.gzip(req.file.buffer, { level: 9 }, (err, result) => {
          if (err) return reject(err);
          resolve(result);
        });
      });

      fs.writeFileSync(outputPath, compressed);
    }

    const compressedSize = fs.statSync(outputPath).size;
    const reductionPercent = (((originalSize - compressedSize) / originalSize) * 100).toFixed(1);

    res.json({
      success: true,
      originalSize,
      compressedSize,
      reductionPercent,
      format,
      url: `/output/${outputFileName}`,
      downloadName: format === "zip" ? `${baseName}.zip` : `${baseName}.csv.gz`,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Đã có lỗi xảy ra khi nén CSV." });
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
