const { onRequest } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { setGlobalOptions } = require('firebase-functions/v2');
const { getStorage } = require('firebase-admin/storage');
const admin = require('firebase-admin');
const { scrapeGasPrices, cleanGasPrices } = require('./scrapper');

admin.initializeApp();
setGlobalOptions({ region: 'us-central1' });

const DATA_PREFIX = 'gas-prices/snapshots';
const LATEST_FILE = 'gas-prices/latest.json';
const STORAGE_BUCKET = 'gas-prices-9b229.firebasestorage.app';

function allowCors(response) {
  response.set('Access-Control-Allow-Origin', '*');
  response.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  response.set('Access-Control-Allow-Headers', 'Content-Type');
}

function getDataBucket() {
  return getStorage().bucket(STORAGE_BUCKET);
}

function getRangeDays(range) {
  return { week: 7, month: 30, sixMonths: 180 }[range] || 7;
}

function getStateAverages(rows, state) {
  const products = new Map();
  rows
    .filter((row) => !state || row.state === state)
    .forEach((row) => {
      const values = products.get(row.Producto) || [];
      if (typeof row.average === 'number') values.push(row.average);
      products.set(row.Producto, values);
    });

  return Object.fromEntries([...products.entries()].map(([product, values]) => [
    product,
    values.length ? Number((values.reduce((total, value) => total + value, 0) / values.length).toFixed(2)) : null
  ]));
}

async function getTimeline(range, state) {
  const [files] = await getDataBucket().getFiles({ prefix: `${DATA_PREFIX}/` });
  const cutoff = Date.now() - getRangeDays(range) * 24 * 60 * 60 * 1000;
  const snapshots = files
    .filter((file) => file.name.endsWith('.json'))
    .map((file) => ({ file, scrapedAt: file.name.match(/(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})/)?.[1] }))
    .filter(({ scrapedAt }) => scrapedAt && new Date(scrapedAt.replace(/-/g, (match, offset) => offset > 9 ? ':' : match)).getTime() >= cutoff);

  const stateNames = new Set();
  const points = await Promise.all(snapshots.map(async ({ file, scrapedAt }) => {
    const [contents] = await file.download();
    const payload = JSON.parse(contents.toString());
    payload.rows.forEach((row) => stateNames.add(row.state));
    return { scrapedAt: payload.scrapedAt || scrapedAt, ...getStateAverages(payload.rows, state) };
  }));

  return {
    range,
    state: state || 'All states',
    states: [...stateNames].sort(),
    snapshots: points.sort((left, right) => new Date(left.scrapedAt) - new Date(right.scrapedAt))
  };
}

async function scrapeAndStore() {
  const data = await scrapeGasPrices();
  const payload = {
    source: data.source,
    scrapedAt: data.scrapedAt,
    totalCombos: data.totalCombos,
    scrapedCombos: data.scrapedCombos,
    rows: cleanGasPrices(data)
  };
  const snapshotName = `${payload.scrapedAt.replace(/[^0-9TZ-]/g, '-')}-${Date.now()}.json`;
  const snapshotPath = `${DATA_PREFIX}/${snapshotName}`;

  await getDataBucket().file(snapshotPath).save(JSON.stringify(payload, null, 2), {
    contentType: 'application/json',
    metadata: { cacheControl: 'public,max-age=300' }
  });
  await getDataBucket().file(LATEST_FILE).save(JSON.stringify({ snapshotPath, scrapedAt: payload.scrapedAt }), {
    contentType: 'application/json',
    metadata: { cacheControl: 'no-cache' }
  });

  return { ...payload, snapshotPath };
}

exports.getGasPrices = onRequest(async (request, response) => {
  allowCors(response);
  if (request.method === 'OPTIONS') {
    response.status(204).send('');
    return;
  }
  if (request.method !== 'GET') {
    response.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const bucket = getDataBucket();
    const [latestContents] = await bucket.file(LATEST_FILE).download();
    const { snapshotPath } = JSON.parse(latestContents.toString());
    const [contents] = await bucket.file(snapshotPath).download();
    response.type('application/json').send(contents);
  } catch (error) {
    console.error(error);
    response.status(404).json({ error: 'No gas prices file has been stored yet' });
  }
});

exports.getGasPriceHistory = onRequest(async (request, response) => {
  allowCors(response);
  if (request.method === 'OPTIONS') {
    response.status(204).send('');
    return;
  }
  if (request.method !== 'GET') {
    response.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const range = request.query.range || 'week';
    const state = request.query.state || '';
    response.type('application/json').send(JSON.stringify(await getTimeline(range, state)));
  } catch (error) {
    console.error(error);
    response.status(500).json({ error: 'Unable to load gas prices history' });
  }
});

exports.dailyGasPrices = onSchedule({
  schedule: '0 0 * * *',
  timeZone: 'America/Mexico_City',
  timeoutSeconds: 540,
  memory: '1GiB'
}, async () => {
  await scrapeAndStore();
});
