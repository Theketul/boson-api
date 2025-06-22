const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const ResponseHandler = require('./config/responseHandler');

const setupMiddleware = (app) => {
    app.use(bodyParser.json({ limit: '1000mb' }));
    app.use(bodyParser.urlencoded({ limit: '1000mb', extended: true }));

    const allowedOrigins = [
        'https://boson-app.vercel.app',     // staging
        'https://ops.waters.co.in'          // production
    ];

    const corsOptions = {
        origin: function (origin, callback) {
            if (
                !origin || // allow non-browser tools like Postman
                allowedOrigins.includes(origin) || // known frontends
                /^http:\/\/localhost(:\d+)?$/.test(origin) // any localhost:<port>
            ) {
                callback(null, true);
            } else {
                console.warn(`CORS blocked origin: ${origin}`);
                callback(new Error('Not allowed by CORS'));
            }
        },
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization'],
        credentials: true
    };

    app.use(cors(corsOptions));
    app.options('*', cors(corsOptions)); // preflight handling
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