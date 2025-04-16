const BaseJoi = require('joi');
const DateExtension = require('joi-date-extensions');
const Joi = BaseJoi.extend(DateExtension);


export var validateBody = (schema) => {
    return (req, res, next) => {
        const result = req.method != 'GET' ? Joi.validate(req.body, schema) : Joi.validate(req.query, schema);
        if (result.error) {
            return res.handler.response(
                STATUS_CODES.BAD_REQUEST,
                "Invalid request",
                result.error
            );
        }

        if (!req.value) { req.value = {}; }
        req.value['body'] = result.value;
        next();
    }
}

export var schemas = {
    registerSchema: Joi.object().keys({
        firstName: Joi.string().required(),
        lastName: Joi.string().required(),
        email: Joi.string().email().required(),
        password: Joi.string().required(),
        phoneNo: Joi.number().required(),
        address: Joi.string().required(),
        role: Joi.string().required(),
        verify: Joi.string().required()
    }),
    loginSchema: Joi.object().keys({
        phoneNo: Joi.string().number().required(),
        password: Joi.string().required(),
    }),
}