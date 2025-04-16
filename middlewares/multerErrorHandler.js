const multer = require('multer');

const multerErrorHandler = (err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.handler.response(
                STATUS_CODES.BAD_REQUEST,
                "File size exceeds the limit"
            );
        }
        if (err.code === 'LIMIT_UNEXPECTED_FILE') {
            return res.handler.response(
                STATUS_CODES.BAD_REQUEST,
                "Unexpected file type"
            );
        }
        return res.handler.response(
            STATUS_CODES.BAD_REQUEST,
            err.message
        );
    } else if (err) {
        return res.handler.response(
            STATUS_CODES.SERVER_ERROR,
            "An unexpected error occurred"
        );
    }
    next();
};

module.exports = multerErrorHandler;
