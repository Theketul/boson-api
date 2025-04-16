const express = require('express');
const path = require('path');
require('dotenv').config();
const dbConfig = require('./config/dbConfig');
const router = require('./routes');
const setupMiddleware = require('./middleware');
const setupSwagger = require('./swagger');
const multerErrorHandler = require('./middlewares/multerErrorHandler');
require('./config/responseHandler');
require('./config/globals');
require('./utils/cronJob');

const app = express();

dbConfig();
setupMiddleware(app);
setupSwagger(app);

app.get('/', (req, res) => {
    res.json({ message: 'hello' });
});

app.use('/', router);
app.use(multerErrorHandler);

if (process.env.NODE_ENV === 'production') {
    app.use('/', express.static('client/build'));
    app.get('*', (req, res) => {
        res.sendFile(path.resolve(__dirname, 'client/build/index.html'));
    });
}

const port = process.env.NODE_LOCAL_PORT || 6000;
app.listen(port, () => console.log(`Node Express Server Started at ${port}!`));
