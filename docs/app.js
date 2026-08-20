// const apiUrl = 'http://localhost:3000/api/gas-prices';
const dataUrl = './gas-prices.json';
const refreshButton = document.querySelector('#refresh-button');
const refreshIcon = document.querySelector('#refresh-icon');
const tableMessage = document.querySelector('#table-message');
const tableHead = document.querySelector('#table-head');
const tableBody = document.querySelector('#table-body');
const stateTableMessage = document.querySelector('#state-table-message');
const stateTableHead = document.querySelector('#state-table-head');
const stateTableBody = document.querySelector('#state-table-body');
const downloadStateCsv = document.querySelector('#download-state-csv');
const downloadTableCsv = document.querySelector('#download-table-csv');
const sourceLink = document.querySelector('#source-link');
let stateAverageRows = [];
let fuelRows = [];

function escapeHtml(value) {
  return String(value ?? '-')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatPrice(value) {
  if (typeof value !== 'number') return value ?? '-';
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN'
  }).format(value);
}

function getFuelRows(data) {
  if (Array.isArray(data)) {
    return data.filter((row) => row.Producto).map((row) => ({
      State: row.state,
      Municipality: row.municipality,
      Product: row.Producto,
      Average: row.average,
      Minimum: row.min,
      Maximum: row.max
    }));
  }

  if (Array.isArray(data.rows)) {
    return data.rows.filter((row) => row.Producto).map((row) => ({
      State: row.state,
      Municipality: row.municipality,
      Product: row.Producto,
      Average: row.average,
      Minimum: row.min,
      Maximum: row.max
    }));
  }

  return (data.results || []).flatMap((result) => {
    const summaries = result.data?.Value || [];

    return summaries.filter((summary) => summary.Producto).map((summary) => ({
      State: result.state,
      Municipality: result.municipality,
      Product: summary.Producto,
      Average: summary.average,
      Minimum: summary.min,
      Maximum: summary.max
    }));
  });
}

function renderTable(rows) {
  tableHead.innerHTML = '';
  tableBody.innerHTML = '';

  if (!rows.length) {
    tableMessage.textContent = 'The data file returned no fuel price records.';
    return;
  }

  const headers = Object.keys(rows[0]);
  const headerLabels = {
    State: 'State',
    Municipality: 'Municipality',
    Product: 'Product',
    Average: 'Average price',
    Minimum: 'Minimum price',
    Maximum: 'Maximum price'
  };
  tableHead.innerHTML = `<tr>${headers.map((header) => `<th class="px-4 py-4 font-bold">${escapeHtml(headerLabels[header] || header)}</th>`).join('')}</tr>`;
  tableBody.innerHTML = rows.map((row) => `
    <tr class="transition hover:bg-cream/70">
      ${headers.map((header) => `<td class="max-w-[280px] px-4 py-4 align-top"><span class="line-clamp-3">${escapeHtml(['Average', 'Minimum', 'Maximum'].includes(header) ? formatPrice(row[header]) : row[header])}</span></td>`).join('')}
    </tr>
  `).join('');
  tableMessage.textContent = `Showing ${rows.length.toLocaleString()} product summaries by state and municipality.`;
}

function getStateAverages(rows) {
  const groups = new Map();

  rows.forEach((row) => {
    const key = `${row.State}|${row.Product}`;
    const values = groups.get(key) || { state: row.State, product: row.Product, averages: [] };
    values.averages.push(row.Average);
    groups.set(key, values);
  });

  return [...groups.values()].map((group) => ({
    State: group.state,
    Product: group.product,
    Average: group.averages.reduce((total, value) => total + value, 0) / group.averages.length
  }));
}

function renderStateAverages(rows) {
  stateTableHead.innerHTML = '<tr><th class="px-4 py-4 font-bold">State</th><th class="px-4 py-4 font-bold">Product</th><th class="px-4 py-4 font-bold">Average price</th></tr>';
  stateTableBody.innerHTML = rows.map((row) => `<tr class="transition hover:bg-cream/70"><td class="px-4 py-4">${escapeHtml(row.State)}</td><td class="px-4 py-4">${escapeHtml(row.Product)}</td><td class="px-4 py-4 font-bold">${escapeHtml(formatPrice(row.Average))}</td></tr>`).join('');
  stateTableMessage.textContent = `Showing ${rows.length.toLocaleString()} state and product averages.`;
}

function downloadCsv(rows, filename) {
  if (!rows.length) return;

  const headers = Object.keys(rows[0]);
  const csvValue = (value) => {
    const formattedValue = typeof value === 'number' && Number.isFinite(value)
      ? value.toFixed(2)
      : String(value ?? '');
    return `"${formattedValue.replaceAll('"', '""')}"`;
  };
  const csv = [
    headers.map(csvValue).join(','),
    ...rows.map((row) => headers.map((header) => csvValue(row[header])).join(','))
  ].join('\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

async function loadPrices() {
  refreshButton.disabled = true;
  refreshIcon.classList.add('animate-spin');
  tableMessage.textContent = 'Loading price data...';

  try {
    const response = await fetch(dataUrl);
    if (!response.ok) throw new Error('Local data request failed');
    const data = await response.json();
    const rows = getFuelRows(data);
    fuelRows = rows;
    stateAverageRows = getStateAverages(rows);
    renderStateAverages(stateAverageRows);
    renderTable(rows);
    sourceLink.href = data.source || '#';
  } catch (error) {
    tableMessage.textContent = 'Could not load the local gas-prices.json file.';
  } finally {
    refreshButton.disabled = false;
    refreshIcon.classList.remove('animate-spin');
  }
}

refreshButton.addEventListener('click', loadPrices);
downloadStateCsv.addEventListener('click', () => downloadCsv(stateAverageRows, 'state-averages.csv'));
downloadTableCsv.addEventListener('click', () => downloadCsv(fuelRows, 'municipality-prices.csv'));
loadPrices();
