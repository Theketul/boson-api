const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const ResponseHandler = require('./config/responseHandler');

const setupMiddleware = (app) => {
    app.use(bodyParser.json({ limit: '1000mb' }));
    app.use(bodyParser.urlencoded({ limit: '1000mb', extended: true }));
    app.use(bodyParser.urlencoded({ extended: false }));
    app.use(cors());
    app.use(express.json());
    app.use((req, res, next) => {
        res.handler = new ResponseHandler(req, res);
        next();
    });
    app.use((err, req, res, next) => {
        if (res.headersSent) {
            return next(err);
        }
        console.log('err', err);
        res.handler.serverError(err);
    });
};

module.exports = setupMiddleware;