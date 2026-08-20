const http = require('http');
const fs = require('fs/promises');
const { OUTPUT_FILE, scrapeAndSave } = require('./scrapper');

const port = process.env.PORT || 3000;

function sendGasPrices(response) {
    fs.readFile(OUTPUT_FILE, 'utf8')
        .then((gasPricesJson) => {
            response.writeHead(200);
            response.end(JSON.stringify({ rows: JSON.parse(gasPricesJson) }));
        })
        .catch((error) => {
            console.error(error);
            response.writeHead(500);
            response.end(JSON.stringify({ error: 'Unable to read gas prices data' }));
        });
}

function refreshGasPrices(response) {
    scrapeAndSave()
        .then(({ data }) => {
            response.writeHead(200);
            response.end(JSON.stringify({ rows: data }));
        })
        .catch((error) => {
            console.error(error);
            response.writeHead(500);
            response.end(JSON.stringify({ error: 'Unable to refresh gas prices data' }));
        });
}

const server = http.createServer((request, response) => {
    const requestUrl = new URL(request.url, `http://${request.headers.host || 'localhost'}`);

    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Content-Type', 'application/json');

    if (request.method === 'GET' && requestUrl.pathname === '/api/health') {
        response.writeHead(200);
        response.end(JSON.stringify({ status: 'ok' }));
        return;
    }

    if (request.method === 'GET' && requestUrl.pathname === '/api/gas-prices' && requestUrl.searchParams.get('refresh') === 'true') {
        refreshGasPrices(response);
        return;
    }

    if (request.method === 'GET' && (requestUrl.pathname === '/' || requestUrl.pathname === '/api/gas-prices')) {
        sendGasPrices(response);
        return;
    }

    response.writeHead(404);
    response.end(JSON.stringify({ error: 'Route not found' }));
});

server.listen(port, () => {
    console.log(`API running at http://localhost:${port}`);
});
