const firebaseFunctionsUrl = 'https://us-central1-gas-prices-9b229.cloudfunctions.net';
const dataUrl = `${firebaseFunctionsUrl}/getGasPrices`;
const tableMessage = document.querySelector('#table-message');
const tableHead = document.querySelector('#table-head');
const tableBody = document.querySelector('#table-body');
const stateTableMessage = document.querySelector('#state-table-message');
const stateTableHead = document.querySelector('#state-table-head');
const stateTableBody = document.querySelector('#state-table-body');
const downloadStateCsv = document.querySelector('#download-state-csv');
const downloadTableCsv = document.querySelector('#download-table-csv');
const sourceLink = document.querySelector('#source-link');
const fuelChartMessage = document.querySelector('#fuel-chart-message');
const stateChartMessage = document.querySelector('#state-chart-message');
const stateChartProduct = document.querySelector('#state-chart-product');
const timelineRange = document.querySelector('#timeline-range');
const timelineState = document.querySelector('#timeline-state');
const timelineMessage = document.querySelector('#timeline-message');
const mapMessage = document.querySelector('#map-message');
const mapLegend = document.querySelector('#map-legend');
const mapProductToggle = document.querySelector('#map-product-toggle');
const mapHighlights = document.querySelector('#map-highlights');
const cheapestState = document.querySelector('#cheapest-state');
const cheapestStateValue = document.querySelector('#cheapest-state-value');
const expensiveState = document.querySelector('#expensive-state');
const expensiveStateValue = document.querySelector('#expensive-state-value');
const biggestSpreadState = document.querySelector('#biggest-spread-state');
const biggestSpreadValue = document.querySelector('#biggest-spread-value');
const nationalAverages = document.querySelector('#national-averages');
const lastUpdated = document.querySelector('#last-updated');
let fuelChart;
let stateChart;
let timelineChart;
let mexicoMap;
let mexicoLayer;
let mapProduct = 'Regular';
let stateAverageRows = [];
let fuelRows = [];
let scrapedAt;

const mapUrl = 'https://raw.githubusercontent.com/angelnmara/geojson/master/mexicoHigh.json';
const historyUrl = `${firebaseFunctionsUrl}/getGasPriceHistory`;

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
      Product: row.Producto.trim(),
      Average: row.average,
      Minimum: row.min,
      Maximum: row.max
    }));
  }

  if (Array.isArray(data.rows)) {
    return data.rows.filter((row) => row.Producto).map((row) => ({
      State: row.state,
      Municipality: row.municipality,
      Product: row.Producto.trim(),
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
      Product: summary.Producto.trim(),
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
  const stateRows = new Map();
  rows.forEach((row) => {
    const values = stateRows.get(row.State) || { State: row.State, Regular: null, Premium: null, Diesel: null };
    const productColumn = row.Product === 'Diésel' ? 'Diesel' : row.Product;
    if (productColumn in values) values[productColumn] = row.Average;
    stateRows.set(row.State, values);
  });
  const columns = ['State', 'Regular', 'Premium', 'Diesel'];
  stateTableHead.innerHTML = `<tr>${columns.map((column) => `<th class="px-4 py-4 font-bold">${escapeHtml(column)}</th>`).join('')}</tr>`;
  stateTableBody.innerHTML = [...stateRows.values()].map((row) => `<tr class="transition hover:bg-cream/70">${columns.map((column) => `<td class="px-4 py-4${column !== 'State' ? ' font-bold' : ''}">${escapeHtml(column === 'State' ? row[column] : formatPrice(row[column]))}</td>`).join('')}</tr>`).join('');
  stateTableMessage.textContent = `Showing ${stateRows.size.toLocaleString()} state averages.`;
}

function getProductSummaries(rows) {
  const groups = new Map();
  rows.forEach((row) => {
    const values = groups.get(row.Product) || { min: [], average: [], max: [] };
    values.min.push(row.Minimum);
    values.average.push(row.Average);
    values.max.push(row.Maximum);
    groups.set(row.Product, values);
  });

  return [...groups.entries()].map(([product, values]) => ({
    product,
    minimum: values.min.reduce((total, value) => total + value, 0) / values.min.length,
    average: values.average.reduce((total, value) => total + value, 0) / values.average.length,
    maximum: values.max.reduce((total, value) => total + value, 0) / values.max.length
  }));
}

function getStateMetrics(averages, product) {
  const rows = averages.filter((row) => row.Product === product);
  const cheapest = rows.reduce((best, row) => !best || row.Average < best.Average ? row : best, null);
  const expensive = rows.reduce((best, row) => !best || row.Average > best.Average ? row : best, null);
  const spread = cheapest && expensive ? { state: `${cheapest.State} - ${expensive.State}`, spread: expensive.Average - cheapest.Average } : null;
  return { cheapest, expensive, spread };
}

function renderSummaryCards(averages, product) {
  const metrics = getStateMetrics(averages, product);
  if (!metrics.cheapest || !metrics.expensive) return;
  cheapestState.textContent = metrics.cheapest.State;
  cheapestStateValue.textContent = `${product}: ${formatPrice(metrics.cheapest.Average)} / L`;
  expensiveState.textContent = metrics.expensive.State;
  expensiveStateValue.textContent = `${product}: ${formatPrice(metrics.expensive.Average)} / L`;
  biggestSpreadState.textContent = metrics.spread.state;
  biggestSpreadValue.textContent = `${product}: ${formatPrice(metrics.spread.spread)} difference`;
  nationalAverages.innerHTML = getProductSummaries(fuelRows).map((summary) => `<div class="flex justify-between gap-3"><span>${escapeHtml(summary.product)}</span><span>${escapeHtml(formatPrice(summary.average))}</span></div>`).join('');
}

function normalizeStateName(name) {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(' de Zaragoza', '')
    .replace(' de Ignacio de la Llave', '')
    .replace(' de Ocampo', '')
    .toLowerCase();
}

function getMapColor(value, minimum, maximum) {
  if (!Number.isFinite(value)) return '#d8ded8';
  const ratio = maximum === minimum ? 0.5 : (value - minimum) / (maximum - minimum);
  const red = Math.round(104 + ratio * 128);
  const green = Math.round(154 - ratio * 65);
  const blue = Math.round(91 - ratio * 42);
  return `rgb(${red}, ${green}, ${blue})`;
}

function renderMap(averages) {
  if (!window.L || !averages.length) return;

  const stateValues = new Map(averages
    .filter((row) => row.Product === mapProduct)
    .map((row) => [normalizeStateName(row.State), row]));
  const values = [...stateValues.values()].map((row) => row.Average);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const cheapest = [...stateValues.values()].find((row) => row.Average === minimum);
  const expensive = [...stateValues.values()].find((row) => row.Average === maximum);
  mapMessage.textContent = `${stateValues.size} states mapped for ${mapProduct}. Hover over a state for its average.`;
  mapLegend.innerHTML = `<span>Lower</span><i class="h-2 w-20 rounded-full" style="background: linear-gradient(90deg, ${getMapColor(minimum, minimum, maximum)}, ${getMapColor(maximum, minimum, maximum)})"></i><span>Higher</span>`;
  mapHighlights.innerHTML = `<span class="rounded-full bg-[#dcebdc] px-3 py-1 text-[#315d45]">Lowest: ${escapeHtml(cheapest?.State || '-')} ${escapeHtml(formatPrice(minimum))}</span><span class="rounded-full bg-[#f9e0d8] px-3 py-1 text-[#a84f35]">Highest: ${escapeHtml(expensive?.State || '-')} ${escapeHtml(formatPrice(maximum))}</span>`;
  renderSummaryCards(averages, mapProduct);

  if (!mexicoMap) {
    mexicoMap = L.map('mexico-map', { zoomControl: false, attributionControl: true }).setView([23.7, -102.5], 5);
    L.control.zoom({ position: 'bottomright' }).addTo(mexicoMap);
  }

  const featureStyle = (feature) => {
    const featureName = feature.properties.id === 'MX-CMX' ? 'ciudad de mexico' : feature.properties.name;
    const row = stateValues.get(normalizeStateName(featureName));
    return {
      fillColor: getMapColor(row?.Average, minimum, maximum),
      weight: row?.Average === minimum || row?.Average === maximum ? 2 : 1,
      color: row?.Average === minimum ? '#315d45' : row?.Average === maximum ? '#c84f4f' : '#ffffff',
      fillOpacity: 0.9
    };
  };

  const onEachFeature = (feature, layer) => {
    const featureName = feature.properties.id === 'MX-CMX' ? 'Ciudad de México' : feature.properties.name;
    const row = stateValues.get(normalizeStateName(featureName));
    const highlight = row?.Average === Math.min(...values) ? 'Lowest price' : row?.Average === Math.max(...values) ? 'Highest price' : '';
    layer.bindTooltip(`<strong>${escapeHtml(featureName)}</strong><br>${row ? escapeHtml(formatPrice(row.Average)) + ' / L' : 'No data'}${highlight ? `<br><strong>${highlight}</strong>` : ''}`, { sticky: true });
    layer.on({ mouseover: (event) => event.target.setStyle({ weight: 2, color: '#17211b', fillOpacity: 1 }), mouseout: (event) => mexicoLayer.resetStyle(event.target) });
  };

  const updateLayer = (geojson) => {
    mexicoLayer?.remove();
    mexicoLayer = L.geoJSON(geojson, { style: featureStyle, onEachFeature }).addTo(mexicoMap);
    mexicoMap.fitBounds(mexicoLayer.getBounds(), { padding: [12, 12] });
  };

  if (mexicoMap._geojson) updateLayer(mexicoMap._geojson);
  else fetch(mapUrl).then((response) => response.json()).then((geojson) => { mexicoMap._geojson = geojson; updateLayer(geojson); }).catch(() => { mapMessage.textContent = 'The map boundary data could not be loaded.'; });
}

function renderMapProductToggle(products, averages) {
  const orderedProducts = ['Diésel', 'Regular', 'Premium'].filter((product) => products.includes(product));
  mapProduct = orderedProducts.includes(mapProduct) ? mapProduct : orderedProducts[0];
  mapProductToggle.innerHTML = orderedProducts.map((product) => `<button type="button" data-map-product="${escapeHtml(product)}" aria-pressed="${product === mapProduct}" class="rounded-full px-3 py-1.5 text-xs font-bold transition focus:outline-none focus:ring-2 focus:ring-moss/40 ${product === mapProduct ? 'bg-ink text-white' : 'text-ink/60 hover:text-ink'}">${escapeHtml(product)}</button>`).join('');
  mapProductToggle.querySelectorAll('[data-map-product]').forEach((button) => {
    button.addEventListener('click', () => {
      mapProduct = button.dataset.mapProduct;
      mapProductToggle.querySelectorAll('[data-map-product]').forEach((option) => {
        const isActive = option.dataset.mapProduct === mapProduct;
        option.setAttribute('aria-pressed', isActive);
        option.classList.toggle('bg-ink', isActive);
        option.classList.toggle('text-white', isActive);
        option.classList.toggle('text-ink/60', !isActive);
      });
      renderMap(averages);
    });
  });
}

function renderCharts(rows, averages) {
  if (!window.Chart || !rows.length) return;

  const productSummaries = getProductSummaries(rows);
  const products = productSummaries.map((summary) => summary.product);
  stateChartProduct.innerHTML = products.map((product) => `<option value="${escapeHtml(product)}">${escapeHtml(product)}</option>`).join('');
  renderMapProductToggle(products, averages);
  fuelChartMessage.textContent = `Average values across ${rows.length.toLocaleString()} listings.`;

  fuelChart?.destroy();
  fuelChart = new Chart(document.querySelector('#fuel-chart'), {
    type: 'bar',
    data: {
      labels: products,
      datasets: [
        { label: 'Minimum', data: productSummaries.map((summary) => summary.minimum), backgroundColor: '#a9bd91', borderRadius: 4 },
        { label: 'Average', data: productSummaries.map((summary) => summary.average), backgroundColor: '#d9e86c', borderRadius: 4 },
        { label: 'Maximum', data: productSummaries.map((summary) => summary.maximum), backgroundColor: '#f28f6b', borderRadius: 4 }
      ]
    },
    options: {
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#ffffff', usePointStyle: true, boxWidth: 8 } } },
      scales: {
        x: { ticks: { color: '#ffffff' }, grid: { display: false } },
        y: { ticks: { color: '#ffffff', callback: (value) => `$${value}` }, grid: { color: 'rgba(255,255,255,0.12)' } }
      }
    }
  });

  const updateStateChart = () => {
    const product = stateChartProduct.value;
    const stateRows = averages.filter((row) => row.Product === product).sort((a, b) => b.Average - a.Average);
    stateChartMessage.textContent = `${stateRows.length} states, ranked highest to lowest.`;
    stateChart?.destroy();
    const stateCanvas = document.querySelector('#state-chart');
    stateCanvas.style.height = `${Math.max(720, stateRows.length * 24)}px`;
    stateChart = new Chart(stateCanvas, {
      type: 'bar',
      data: { labels: stateRows.map((row) => row.State), datasets: [{ label: `${product} average`, data: stateRows.map((row) => row.Average), backgroundColor: '#e3c84a', borderColor: '#b4962f', borderWidth: 1, borderRadius: 4, barThickness: 6 }] },
      options: {
        indexAxis: 'y', maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: '#17211b', callback: (value) => `$${value}` }, grid: { color: 'rgba(23,33,27,0.08)' } },
          y: { ticks: { color: '#17211b', font: { size: 10 }, autoSkip: false }, grid: { display: false } }
        }
      }
    });
  };
  stateChartProduct.onchange = updateStateChart;
  updateStateChart();
  renderMap(averages);
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

function renderTimeline(data) {
  const products = ['Regular', 'Premium', 'Diésel'];
  const colors = { Regular: '#d9e86c', Premium: '#f28f6b', Diésel: '#9fc7ba' };
  const snapshots = data.snapshots || [];
  timelineMessage.textContent = snapshots.length
    ? `${snapshots.length} snapshot${snapshots.length === 1 ? '' : 's'} for ${data.state}.`
    : 'No snapshots are available for this period yet.';
  timelineChart?.destroy();
  timelineChart = new Chart(document.querySelector('#timeline-chart'), {
    type: 'line',
    data: {
      labels: snapshots.map((snapshot) => new Intl.DateTimeFormat('en-MX', { month: 'short', day: 'numeric' }).format(new Date(snapshot.scrapedAt))),
      datasets: products.map((product) => ({
        label: product,
        data: snapshots.map((snapshot) => snapshot[product] ?? null),
        borderColor: colors[product],
        backgroundColor: colors[product],
        pointRadius: snapshots.length === 1 ? 5 : 3,
        pointHoverRadius: 6,
        borderWidth: 3,
        tension: 0.35,
        spanGaps: true
      }))
    },
    options: {
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { labels: { color: '#ffffff', usePointStyle: true, boxWidth: 8 } } },
      scales: {
        x: { ticks: { color: '#ffffff' }, grid: { color: 'rgba(255,255,255,0.08)' } },
        y: { ticks: { color: '#ffffff', callback: (value) => `$${value}` }, grid: { color: 'rgba(255,255,255,0.12)' } }
      }
    }
  });
}

async function loadTimeline() {
  const params = new URLSearchParams({ range: timelineRange.value });
  if (timelineState.value) params.set('state', timelineState.value);
  try {
    const response = await fetch(`${historyUrl}?${params}`);
    if (!response.ok) throw new Error('History request failed');
    const data = await response.json();
    if (!timelineState.dataset.loaded) {
      timelineState.innerHTML = '<option value="">All states</option>' + data.states.map((state) => `<option value="${escapeHtml(state)}">${escapeHtml(state)}</option>`).join('');
      timelineState.dataset.loaded = 'true';
    }
    renderTimeline(data);
  } catch (error) {
    timelineMessage.textContent = 'Could not load historical gas prices.';
  }
}

async function loadPrices() {
  tableMessage.textContent = 'Loading price data...';

  try {
    const response = await fetch(dataUrl);
    if (!response.ok) throw new Error('Gas prices request failed');
    const data = await response.json();
    scrapedAt = data.scrapedAt;
    lastUpdated.textContent = scrapedAt
      ? `Last updated ${new Intl.DateTimeFormat('en-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(scrapedAt))}`
      : 'Last updated unavailable';
    const rows = getFuelRows(data);
    fuelRows = rows;
    stateAverageRows = getStateAverages(rows);
    renderStateAverages(stateAverageRows);
    renderTable(rows);
    renderCharts(rows, stateAverageRows);
    sourceLink.href = data.source || '#';
  } catch (error) {
    tableMessage.textContent = 'Could not load the latest gas prices file.';
  }
}

downloadStateCsv.addEventListener('click', () => downloadCsv(stateAverageRows, 'state-averages.csv'));
downloadTableCsv.addEventListener('click', () => downloadCsv(fuelRows, 'municipality-prices.csv'));
timelineRange.addEventListener('change', loadTimeline);
timelineState.addEventListener('change', loadTimeline);
loadPrices();
loadTimeline();
