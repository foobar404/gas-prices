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
const MAX_SNAPSHOTS = 365;

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
    values.length ? Number((values.reduce((total, value) => total + value, 0) / values.length).toFixed(4)) : null
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

async function pruneOldSnapshots(bucket) {
  const [files] = await bucket.getFiles({ prefix: `${DATA_PREFIX}/` });
  const snapshots = files
    .filter((file) => file.name.endsWith('.json'))
    .sort((left, right) => left.name.localeCompare(right.name));
  const expiredSnapshots = snapshots.slice(0, Math.max(0, snapshots.length - MAX_SNAPSHOTS));
  await Promise.all(expiredSnapshots.map((file) => file.delete()));
}

async function getStablePriceInstances() {
  const bucket = getDataBucket();
  const [latestPointerContents] = await bucket.file(LATEST_FILE).download();
  const latestPointer = JSON.parse(latestPointerContents.toString());
  const [latestContents] = await bucket.file(latestPointer.snapshotPath).download();
  const latestSnapshot = JSON.parse(latestContents.toString());
  const latestTimestamp = Date.parse(latestSnapshot.scrapedAt || latestPointer.scrapedAt);
  if (!Number.isFinite(latestTimestamp)) throw new Error('Latest snapshot has no valid timestamp');

  const targetTimestamp = latestTimestamp - 25 * 24 * 60 * 60 * 1000;
  const [files] = await bucket.getFiles({ prefix: `${DATA_PREFIX}/` });
  const candidates = files
    .filter((file) => file.name.endsWith('.json') && file.name !== latestPointer.snapshotPath)
    .map((file) => {
      const match = file.name.match(/(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})/);
      const timestamp = match
        ? Date.parse(`${match[1].replace(/T(\d{2})-(\d{2})-(\d{2})/, 'T$1:$2:$3')}Z`)
        : NaN;
      return { file, timestamp };
    })
    .filter(({ timestamp }) => Number.isFinite(timestamp) && timestamp <= latestTimestamp)
    .sort((left, right) => Math.abs(left.timestamp - targetTimestamp) - Math.abs(right.timestamp - targetTimestamp));

  if (!candidates.length) throw new Error('No earlier snapshot is available for comparison');

  const [comparisonContents] = await candidates[0].file.download();
  const comparisonSnapshot = JSON.parse(comparisonContents.toString());
  const rowKey = (row) => JSON.stringify([row.state, row.municipality, row.Producto]);
  const comparisonRows = new Map((comparisonSnapshot.rows || []).map((row) => [rowKey(row), row]));
  const priceFields = ['average', 'min', 'max'];
  const instances = (latestSnapshot.rows || []).filter((row) => {
    const previousRow = comparisonRows.get(rowKey(row));
    return previousRow && priceFields.every((field) => (
      row[field] !== null
      && row[field] !== undefined
      && previousRow[field] !== null
      && previousRow[field] !== undefined
      && Number.isFinite(Number(row[field]))
      && Number(row[field]).toFixed(4) === Number(previousRow[field]).toFixed(4)
    ));
  });

  return {
    latestScrapedAt: latestSnapshot.scrapedAt || latestPointer.scrapedAt,
    comparisonScrapedAt: comparisonSnapshot.scrapedAt || new Date(candidates[0].timestamp).toISOString(),
    targetScrapedAt: new Date(targetTimestamp).toISOString(),
    count: instances.length,
    instances
  };
}

async function scrapeAndStore() {
  const data = await scrapeGasPrices();
  const payload = {
    source: data.source,
    scrapedAt: data.scrapedAt,
    totalCombos: data.totalCombos,
    scrapedCombos: data.scrapedCombos,
    parsedRecordCount: data.parsedRecordCount,
    rows: cleanGasPrices(data)
  };
  const snapshotName = `${payload.scrapedAt.replace(/[^0-9TZ-]/g, '-')}-${Date.now()}.json`;
  const snapshotPath = `${DATA_PREFIX}/${snapshotName}`;
  const bucket = getDataBucket();

  await bucket.file(snapshotPath).save(JSON.stringify(payload, null, 2), {
    contentType: 'application/json',
    metadata: { cacheControl: 'public,max-age=300' }
  });
  await bucket.file(LATEST_FILE).save(JSON.stringify({ snapshotPath, scrapedAt: payload.scrapedAt }), {
    contentType: 'application/json',
    metadata: { cacheControl: 'no-cache' }
  });
  await pruneOldSnapshots(bucket);

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

exports.getStablePrices = onRequest(async (request, response) => {
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
    response.type('application/json').send(JSON.stringify(await getStablePriceInstances()));
  } catch (error) {
    console.error(error);
    response.status(500).json({ error: 'Unable to compare gas price snapshots' });
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
