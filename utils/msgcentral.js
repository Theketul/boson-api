const axios = require("axios");

const BASE_URL = process.env.MESSAGE_CENTRAL_BASE_URL;
const CUSTOMER_ID = process.env.CUSTOMER_ID;
const API_KEY = process.env.KEY;

const OTP_CONFIG = {
    DEFAULT_LENGTH: 4,
    VERIFICATION_COMPLETE: "VERIFICATION_COMPLETED",
    RESPONSE_CODES: {
        SUCCESS: 200,
        INVALID_OTP: 702
    }
};

const axiosInstance = axios.create({
    baseURL: BASE_URL,
    headers: {
        accept: '*/*'
    }
});

const handleApiResponse = (response, errorMessage) => {
    if (response?.data?.status === 200 || 
        response?.data?.responseCode === 200) {
            return response.data;
        }
    console.error(response.data.error || response.data.message || errorMessage);
    throw new Error(errorMessage);
};

const handleApiError = (error, context) => {
    console.error(`Error in ${context}:`, error.response?.data || error.message);
    return {
        success: false,
        message: error.response?.data?.message || `Server error during ${context}`,
        error
    };
};

const generateToken = async (countryCode, email) => {
    try {
        const response = await axiosInstance.get('/auth/v1/authentication/token', {
            params: {
                customerId: CUSTOMER_ID,
                key: API_KEY,
                scope: 'NEW',
                countryCode
            }
        });
        const data = handleApiResponse(response, 'Token generation failed');
        return data.token;
    } catch (error) {
        throw handleApiError(error, 'token generation');
    }
};

const sendOTP = async (countryCode, authToken, mobileNumber) => {
    try {
        const response = await axiosInstance.post('/verification/v3/send', {}, {
            params: {
                countryCode,
                flowType: FLOW_TYPE.SMS,
                otpLength: OTP_CONFIG.DEFAULT_LENGTH,
                mobileNumber
            },
            headers: { authToken }
        });
        const data = handleApiResponse(response, 'OTP sending failed');
        return data.data.verificationId;
    } catch (error) {
        throw handleApiError(error, 'OTP sending');
    }
};

const validateOTP = async (authToken, verificationId, otpCode) => {
    try {
        const response = await axiosInstance.get('/verification/v3/validateOtp', {
            params: { verificationId, code: otpCode },
            headers: { authToken }
        });

        if (response.data.responseCode === OTP_CONFIG.RESPONSE_CODES.SUCCESS) {
            return {
                success: true,
                status: response.data.data.verificationStatus === OTP_CONFIG.VERIFICATION_COMPLETE
            };
        }

        if (response.data.responseCode === OTP_CONFIG.RESPONSE_CODES.INVALID_OTP) {
            return { success: false, message: 'Wrong OTP provided.' };
        }

        return { 
            success: false, 
            message: response.data.message || 'OTP validation failed.' 
        };

    } catch (error) {
        return handleApiError(error, 'OTP validation');
    }
};

const cacheControl = (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
};

module.exports = {
    generateToken,
    sendOTP,
    validateOTP,
    cacheControl,
    OTP_CONFIG
};