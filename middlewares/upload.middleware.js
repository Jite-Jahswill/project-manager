const multer = require("multer");
const path = require("path");
const admin = require("firebase-admin");
require("dotenv").config();

// ✅ Initialize Firebase using environment variables
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    }),
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  });
  console.log("Firebase initialized successfully");
}

const bucket = admin.storage().bucket();

// ✅ Configure multer to store files in memory
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB per file
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      "image/jpeg",
      "image/png",
      "image/webp",
      "application/pdf",
      "video/mp4",
      "text/plain",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ];
    if (allowedTypes.includes(file.mimetype)) cb(null, true);
    else cb(new Error("File type not allowed!"), false);
  },
}).array("files", 10); // support multiple files

// ✅ Middleware to upload files to Firebase
const uploadToFirebase = async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) return next();

    const uploadPromises = req.files.map((file) => {
      return new Promise((resolve, reject) => {
        const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
        const ext = path.extname(file.originalname);
        const filename = `uploads/${file.fieldname}-${uniqueSuffix}${ext}`;

        const blob = bucket.file(filename);
        const blobStream = blob.createWriteStream({
          metadata: { contentType: file.mimetype },
        });

        blobStream.on("error", (err) => reject(err));

        blobStream.on("finish", async () => {
          try {
            await blob.makePublic();
            const publicUrl = `https://storage.googleapis.com/${bucket.name}/${blob.name}`;
            resolve({
              originalname: file.originalname,
              mimetype: file.mimetype,
              size: file.size,
              firebaseUrl: publicUrl,
              filename: blob.name,
            });
          } catch (err) {
            reject(err);
          }
        });

        blobStream.end(file.buffer);
      });
    });

    const uploadedFiles = await Promise.all(uploadPromises);
    req.uploadedFiles = uploadedFiles;
    next();
  } catch (err) {
    next(err);
  }
};

module.exports = { upload, uploadToFirebase };
