const { S3Client, PutObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const multer = require("multer");
const multerS3 = require("multer-s3");

const S3_CONFIG = {
    BUCKET: process.env.AWS_BUCKET_NAME,
    REGION: process.env.AWS_REGION,
    FOLDERS: {
        IMAGES: 'images',
        DOCS: 'docs',
        VIDEOS: 'videos' // New folder for videos
    },
    MAX_FILE_SIZE: 50 * 1024 * 1024, // 50MB limit for videos
    ALLOWED_MIME_TYPES : {
        IMAGES: [
          'image/jpeg',   // .jpg, .jpeg
          'image/png',    // .png
          'image/webp',   // .webp (modern, good compression)
          'image/svg+xml' // .svg (logos/icons)
        ],
      
        DOCS: [
          'application/pdf', // .pdf
          'application/msword', // .doc
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
          'application/vnd.ms-excel', // .xls
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
          'text/plain', // .txt
          'text/csv' // .csv
        ],
      
        VIDEOS: [
          'video/mp4',    // .mp4
          'video/mpeg',   // .mpeg
          'video/quicktime', // .mov
          'video/webm'    // .webm (modern browsers)
        ]
      },
      
};

const s3Client = new S3Client({
    region: S3_CONFIG.REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    },
    forcePathStyle: true
});

const validateFile = (file) => {
    const isValidSize = file.size <= S3_CONFIG.MAX_FILE_SIZE;
    const isValidType = [
        ...S3_CONFIG.ALLOWED_MIME_TYPES.IMAGES,
        ...S3_CONFIG.ALLOWED_MIME_TYPES.DOCS,
        ...S3_CONFIG.ALLOWED_MIME_TYPES.VIDEOS // Allow videos
    ].includes(file.mimetype);

    if (!isValidSize) throw new Error('File size exceeds limit');
    if (!isValidType) throw new Error('Invalid file type');
    
    return true;
};

const getFileFolder = (mimetype) => {
    if (mimetype.includes('image')) return S3_CONFIG.FOLDERS.IMAGES;
    if (mimetype.includes('video')) return S3_CONFIG.FOLDERS.VIDEOS; // Added video folder
    return S3_CONFIG.FOLDERS.DOCS;
};

const generateFileName = (originalName, folder) => 
    `${folder}/${Date.now()}_${originalName.replace(/\s+/g, '_')}`;

const upload = multer({
    storage: multerS3({
        s3: s3Client,
        bucket: S3_CONFIG.BUCKET,
        contentType: multerS3.AUTO_CONTENT_TYPE,
        key: (req, file, cb) => {
            try {
                const folder = getFileFolder(file.mimetype);
                const fileName = generateFileName(file.originalname, folder);
                cb(null, fileName);
            } catch (error) {
                cb(error);
            }
        }
    }),
    limits: {
        fileSize: S3_CONFIG.MAX_FILE_SIZE
    },
    fileFilter: (req, file, cb) => {
        const isValidType = [
            ...S3_CONFIG.ALLOWED_MIME_TYPES.IMAGES,
            ...S3_CONFIG.ALLOWED_MIME_TYPES.DOCS,
            ...S3_CONFIG.ALLOWED_MIME_TYPES.VIDEOS // Added video types
        ].includes(file.mimetype);

        if (isValidType) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type'), false);
        }
    }
});

const deleteFileFromS3 = async (fileUrl) => {
    try {
        if (!fileUrl) return { success: true, message: 'No file to delete' };

        const fileKey = fileUrl.split('/').slice(-2).join('/');
        const deleteParams = {
            Bucket: S3_CONFIG.BUCKET,
            Key: fileKey
        };

        await s3Client.send(new DeleteObjectCommand(deleteParams));
        
        return {
            success: true,
            message: `File ${fileKey} deleted successfully`
        };
    } catch (error) {
        console.error('S3 Delete Error:', error.message);
        throw new Error(`Failed to delete file: ${error.message}`);
    }
};

const handleS3Error = (error, req, res, next) => {
    console.error('S3 Operation Error:', error);
    res.status(500).json({
        success: false,
        message: 'File operation failed',
        error: error.message
    });
};

module.exports = {
    upload,
    s3Client,
    deleteFileFromS3,
};