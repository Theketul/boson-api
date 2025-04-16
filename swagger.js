const swaggerUi = require('swagger-ui-express');
const postmanToOpenApi = require('postman-to-openapi');
const yaml = require('yamljs');

const setupSwagger = (app) => {
    const swaggerDocument = yaml.load('./swagger/swagger.yaml');
    
    app.get('/generate-yml', async (req, res) => {
        const postmanCollection = 'BOSON.postman_collection.json';
        const outputFile = './swagger/swagger.yaml';
        try {
            console.log('Generating OpenAPI specs...');
            const result = await postmanToOpenApi(postmanCollection, outputFile, {
                defaultTag: 'General',
            });
            const result2 = await postmanToOpenApi(postmanCollection, null, {
                defaultTag: 'General',
            });
            console.log(`OpenAPI specs: ${result}`);
            return res.send('swagger file generated');
        } catch (err) {
            console.log(err);
        }
    });

    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));
};

module.exports = setupSwagger;