'use strict';

// ── Constants ────────────────────────────────────────────────────────────────

const API = '';
const CIRC = 2 * Math.PI * 84; // 527.79

// Design uses underscores for CSS classes; API uses hyphens in the type value
const TYPE_TO_API = { TRANSFER: 'TRANSFER', PAYMENT: 'PAYMENT', CASH_OUT: 'CASH-OUT', CASH_IN: 'CASH-IN', DEBIT: 'DEBIT' };
const TYPE_CSS    = { 'TRANSFER': 'TRANSFER', 'PAYMENT': 'PAYMENT', 'CASH-OUT': 'CASH_OUT', 'CASH-IN': 'CASH_IN', 'DEBIT': 'DEBIT' };

const FEAT_LABELS = {
  typeEncoded:         'typeEncoded',
  amount:              'amount',
  errorBalanceOrg:     'errorBalanceOrg',
  balanceDeltaOrg:     'balanceDeltaOrg',
  errorBalanceDest:    'errorBalanceDest',
  newbalanceOrig:      'newbalanceOrig',
  oldbalanceOrg:       'oldbalanceOrg',
  balanceDeltaDest:    'balanceDeltaDest',
  isZeroNewBalanceOrg: 'isZeroNewBalOrg',
  oldbalanceDest:      'oldbalanceDest',
  newbalanceDest:      'newbalanceDest',
  isZeroBalanceOrg:    'isZeroBalOrg',
  isZeroBalanceDest:   'isZeroBalDest',
};

// ── Helpers ──────────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);
const parseDollar = s => parseFloat(String(s).replace(/[,$\s]/g, '')) || 0;
const fmtDollar   = n => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const commas      = n => n.toLocaleString('en-US');
const shortTime   = iso => new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

// ── State ────────────────────────────────────────────────────────────────────

const logRows = [];

// ── Status badge ─────────────────────────────────────────────────────────────

function setStatus(state, text) {
  const badge = $('status-badge');
  const txt   = $('status-text');
  badge.className = 'status-badge ' + state;
  txt.textContent = text;
}

// ── Gauge & verdict ───────────────────────────────────────────────────────────

function colorFor(p) {
  if (p >= 0.6) return { c: '#ef4444', glow: 'rgba(239,68,68,0.55)' };
  if (p >= 0.3) return { c: '#f59e0b', glow: 'rgba(245,158,11,0.55)' };
  return { c: '#10b981', glow: 'rgba(16,185,129,0.55)' };
}

function animateGauge(targetP) {
  const arc = $('gauge-arc');
  const num = $('gauge-num');

  const startOffset = parseFloat(arc.style.strokeDashoffset) || CIRC;
  const targetOffset = CIRC * (1 - targetP);
  const startPct = Math.round((1 - startOffset / CIRC) * 100);
  const targetPct = Math.round(targetP * 100);

  const { c, glow } = colorFor(targetP);
  arc.setAttribute('stroke', c);
  arc.style.strokeDashoffset = targetOffset;
  num.style.color = c;
  num.style.textShadow = `0 0 18px ${glow}`;

  const t0 = performance.now();
  const dur = 900;
  (function step(t) {
    const k = Math.min(1, (t - t0) / dur);
    const ease = 1 - Math.pow(1 - k, 3);
    num.innerHTML = Math.round(startPct + (targetPct - startPct) * ease) + '<span class="pct">%</span>';
    if (k < 1) requestAnimationFrame(step);
  })(t0);
}

function updateVerdict(result, latencyMs) {
  const { isFraud, probability: p, confidence, riskFactors, recommendation } = result;

  // Scored-time sub-label
  if (latencyMs !== undefined) $('scored-time').textContent = `scored in ${latencyMs} ms`;

  // Gauge
  animateGauge(p);

  // Verdict badge
  const verdict = $('verdict');
  let label, vcolor, vbg, vborder, vglow, vshadow;
  if (p >= 0.6) {
    label = 'Fraud detected — block transaction';
    vcolor = '#ffd0d0'; vbg = 'rgba(239,68,68,0.12)'; vborder = 'rgba(239,68,68,0.35)'; vglow = 'rgba(239,68,68,0.55)';
    vshadow = `0 0 24px -6px ${vglow}, inset 0 1px 0 rgba(255,255,255,0.05)`;
  } else if (p >= 0.3) {
    label = 'Suspicious — hold for manual review';
    vcolor = '#fde0a8'; vbg = 'rgba(245,158,11,0.12)'; vborder = 'rgba(245,158,11,0.35)'; vglow = 'rgba(245,158,11,0.45)';
    vshadow = `0 0 24px -6px ${vglow}, inset 0 1px 0 rgba(255,255,255,0.05)`;
  } else {
    label = 'Legitimate — safe to approve';
    vcolor = '#bbf7d0'; vbg = 'rgba(16,185,129,0.12)'; vborder = 'rgba(16,185,129,0.35)'; vglow = 'rgba(16,185,129,0.45)';
    vshadow = `0 0 24px -6px ${vglow}, inset 0 1px 0 rgba(255,255,255,0.05)`;
  }
  Object.assign(verdict.style, { background: vbg, borderColor: vborder, color: vcolor, boxShadow: vshadow });
  verdict.querySelector('svg').style.color = colorFor(p).c;
  verdict.querySelector('span:last-child').textContent = label;

  // Recommendation pill
  const rec = $('rec-badge');
  const recState = p >= 0.6 ? 'fraud' : p >= 0.3 ? 'suspicious' : 'safe';
  rec.className = 'recommendation ' + recState;
  $('rec-text').textContent = recommendation + ' · ' + confidence.toLowerCase() + ' confidence';

  // Risk factors
  renderRiskFactors(riskFactors || [], p);
}

const RISK_ICON_HIGH = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>`;
const RISK_ICON_MED  = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>`;
const RISK_ICON_LOW  = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/></svg>`;

function riskSeverity(text) {
  const t = text.toLowerCase();
  if (t.includes('drain') || t.includes('zero') || t.includes('million') || t.includes('>$1m')) return 'high';
  if (t.includes('high-value') || t.includes('discrepancy') || t.includes('missing')) return 'med';
  return 'low';
}

function renderRiskFactors(factors, p) {
  const list = $('risk-list');
  if (!factors.length) {
    list.innerHTML = `<div class="risk low"><div class="risk-icon">${RISK_ICON_LOW}</div><div class="risk-text">No significant risk signals detected<small>Transaction appears within normal parameters</small></div><div class="risk-score">—</div></div>`;
    return;
  }
  const scores = ['+0.42', '+0.28', '+0.16', '+0.06'];
  list.innerHTML = factors.map((f, i) => {
    const sev  = riskSeverity(f);
    const icon = sev === 'high' ? RISK_ICON_HIGH : sev === 'med' ? RISK_ICON_MED : RISK_ICON_LOW;
    return `<div class="risk ${sev} rise" style="animation-delay:${i * 60}ms">
      <div class="risk-icon">${icon}</div>
      <div class="risk-text">${f}<small>${sev === 'high' ? 'High-impact signal' : sev === 'med' ? 'Moderate-impact signal' : 'Informational'}</small></div>
      <div class="risk-score">${scores[i] || '+0.03'}</div>
    </div>`;
  }).join('');
}

// ── Metrics display ───────────────────────────────────────────────────────────

function renderMetrics(m) {
  const acc  = (m.accuracy  * 100).toFixed(2);
  const prec = (m.precision * 100).toFixed(2);
  const rec  = (m.recall    * 100).toFixed(2);
  const f1   = m.f1.toFixed(4);
  const auc  = m.auc_roc.toFixed(4);

  $('met-accuracy').innerHTML  = `${acc}<span class="unit">%</span>`;
  $('met-precision').innerHTML = `${prec}<span class="unit">%</span>`;
  $('met-recall').innerHTML    = `${rec}<span class="unit">%</span>`;
  $('met-f1').textContent      = f1;
  $('met-auc').textContent     = auc;

  // Animated bars
  setTimeout(() => {
    $('bar-accuracy').style.width  = acc  + '%';
    $('bar-precision').style.width = prec + '%';
    $('bar-recall').style.width    = rec  + '%';
    $('bar-f1').style.width        = (m.f1 * 100).toFixed(1) + '%';
    $('bar-auc').style.width       = (m.auc_roc * 100).toFixed(1) + '%';
  }, 100);

  // Delta labels
  const deltaArrow = (pos) => `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${pos ? '<polyline points="18 15 12 9 6 15"/>' : '<polyline points="6 9 12 15 18 9"/>'}</svg>`;
  $('delta-accuracy').innerHTML  = deltaArrow(true) + ` ${acc}% accuracy on test set`;
  $('delta-precision').innerHTML = deltaArrow(true) + ` ${prec}% precision`;
  $('delta-recall').innerHTML    = deltaArrow(m.recall > 0.7) + ` ${rec}% recall`;
  $('delta-f1').innerHTML        = deltaArrow(true) + ` F1 = ${f1}`;
  $('delta-auc').innerHTML       = deltaArrow(true) + ` AUC = ${auc}`;

  // Confusion matrix
  const cm = m.confusion_matrix;
  const total = cm.tn + cm.fp + cm.fn + cm.tp;
  $('cm-total').textContent = commas(total);
  $('cm-tn-val').textContent = commas(cm.tn);
  $('cm-fp-val').textContent = commas(cm.fp);
  $('cm-fn-val').textContent = commas(cm.fn);
  $('cm-tp-val').textContent = commas(cm.tp);

  const legitTotal = cm.tn + cm.fp;
  const fraudTotal = cm.fn + cm.tp;
  $('cm-tn-pct').textContent = legitTotal ? ((cm.tn / legitTotal * 100).toFixed(1) + '% of legit') : '—';
  $('cm-fp-pct').textContent = legitTotal ? ((cm.fp / legitTotal * 100).toFixed(2) + '% — review queue') : '—';
  $('cm-fn-pct').textContent = fraudTotal ? ('missed · ' + (cm.fn / fraudTotal * 100).toFixed(2) + '%') : '—';
  $('cm-tp-pct').textContent = fraudTotal ? ('caught · ' + (cm.tp / fraudTotal * 100).toFixed(2) + '%') : '—';

  // Model info sidebar
  $('mi-algo').textContent        = m.model_type || 'XGBoost';
  $('mi-train-rows').textContent  = commas(m.training_samples || 0);
  $('mi-fraud-rate').textContent  = ((m.fraud_rate || 0) * 100).toFixed(3) + '%';
  $('mi-data-source').textContent = m.data_mode || '—';

  // Header meta
  $('meta-model-type').textContent = m.model_type || 'XGBoost';
  $('meta-data-source').textContent = m.data_mode || '—';

  // ROC
  if (m.roc_curve) renderROC(m.roc_curve, m.auc_roc);
}

// ── ROC curve ─────────────────────────────────────────────────────────────────

function renderROC(roc, auc) {
  $('roc-auc-val').textContent = auc.toFixed(4);

  const X0 = 40, Y0 = 246, W = 540, H = 232;
  const pts = roc.fpr.map((f, i) => `${(X0 + f * W).toFixed(1)},${(Y0 - roc.tpr[i] * H).toFixed(1)}`);

  $('roc-curve-path').setAttribute('d', 'M' + pts.join(' L'));
  $('roc-curve-fill').setAttribute('d', `M${X0},${Y0} L${pts.join(' L')} L${X0 + W},${Y0} Z`);
}

// ── Feature importance ────────────────────────────────────────────────────────

function renderFeatImportance(data) {
  const top = data.slice(0, 9);
  const maxImp = Math.max(...top.map(d => d.importance));
  const list = $('feat-list');

  list.innerHTML = top.map((d, i) => {
    const pctW = ((d.importance / maxImp) * 100).toFixed(1);
    const label = FEAT_LABELS[d.feature] || d.feature;
    const alt = i % 3 === 1 ? ' alt' : '';
    return `<div class="feat-row${alt}">
      <div class="feat-name">${label}</div>
      <div class="feat-bar"><i style="width:0%" data-target="${pctW}%"></i></div>
      <div class="feat-val">${d.importance.toFixed(3)}</div>
    </div>`;
  }).join('');

  // Animate bars in after paint
  requestAnimationFrame(() => {
    list.querySelectorAll('.feat-bar i').forEach(bar => {
      bar.style.width = bar.dataset.target;
    });
  });
}

// ── Transaction log ───────────────────────────────────────────────────────────

function addLogRow(result, tx) {
  logRows.unshift({ result, tx, time: new Date() });
  if (logRows.length > 40) logRows.pop();
  renderLog(currentFilter);
}

let currentFilter = 'all';

function renderLog(filter = 'all') {
  currentFilter = filter;
  const tbody = $('txn-body');
  const rows = filter === 'all' ? logRows
    : logRows.filter(r => filter === 'fraud' ? r.result.isFraud : !r.result.isFraud);

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:32px 0;color:var(--ink-3);font-size:12px;">No ${filter === 'all' ? '' : filter + ' '}transactions yet</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(({ result, tx, time }) => {
    const typeCSS = TYPE_CSS[tx.type] || tx.type;
    const st = result.isFraud ? 'fraud' : 'safe';
    const pctColor = result.probability >= 0.7 ? '#f87171' : result.probability >= 0.3 ? '#fbbf24' : '#34d399';
    const origFmt = tx.oldbalanceOrg !== undefined ? `$${fmtDollar(tx.oldbalanceOrg)}` : '—';
    const destFmt = tx.oldbalanceDest !== undefined ? `$${fmtDollar(tx.oldbalanceDest)}` : '—';
    return `<tr class="rise">
      <td class="id-cell">${shortTime(time.toISOString())}</td>
      <td><span class="type-badge type-${typeCSS}">${tx.type}</span></td>
      <td class="amt-cell">$${fmtDollar(tx.amount)}</td>
      <td class="id-cell">${origFmt} → ${destFmt}</td>
      <td style="text-align:right">
        <span class="status-chip ${st}">
          <span class="dot"></span>
          <span style="font-family:var(--mono);font-size:10.5px;margin-right:6px;color:${pctColor}">${(result.probability * 100).toFixed(1)}%</span>
          ${st === 'fraud' ? 'FRAUD' : 'LEGIT'}
        </span>
      </td>
    </tr>`;
  }).join('');
}

// ── API calls ─────────────────────────────────────────────────────────────────

async function apiGet(path) {
  const r = await fetch(API + path);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

async function apiPost(path, body) {
  const r = await fetch(API + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

// ── Form helpers ──────────────────────────────────────────────────────────────

function getFormPayload() {
  const type = $('tx-type').value;
  return {
    type:           TYPE_TO_API[type] || type,
    amount:         parseDollar($('tx-amount').value),
    oldbalanceOrg:  parseDollar($('tx-old-bal-org').value),
    newbalanceOrig: parseDollar($('tx-new-bal-org').value),
    oldbalanceDest: parseDollar($('tx-old-bal-dest').value),
    newbalanceDest: parseDollar($('tx-new-bal-dest').value),
  };
}

function fillForm(tx) {
  const typeSelect = $('tx-type');
  const cssType = TYPE_CSS[tx.type] || tx.type;
  // find matching option value
  Array.from(typeSelect.options).forEach(opt => {
    if (opt.value === cssType || opt.value === tx.type) typeSelect.value = opt.value;
  });
  $('tx-amount').value       = fmtDollar(tx.amount);
  $('tx-old-bal-org').value  = fmtDollar(tx.oldbalanceOrg);
  $('tx-new-bal-org').value  = fmtDollar(tx.newbalanceOrig);
  $('tx-old-bal-dest').value = fmtDollar(tx.oldbalanceDest);
  $('tx-new-bal-dest').value = fmtDollar(tx.newbalanceDest);
}

function clearForm() {
  ['tx-amount','tx-old-bal-org','tx-new-bal-org','tx-old-bal-dest','tx-new-bal-dest'].forEach(id => $$(id) && ($$(id).value = ''));
}
function $$(id) { return document.getElementById(id); }

function setAnalyzeLoading(on) {
  const btn = $('btn-analyze');
  btn.disabled = on;
  btn.innerHTML = on
    ? `<svg class="spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg> Analyzing…`
    : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg> Analyze transaction`;
}

function setSimulateLoading(on) {
  const btn = $('btn-simulate');
  btn.disabled = on;
  btn.innerHTML = on
    ? `<svg class="spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg> Simulating…`
    : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9"/><path d="M3 5v7h7"/></svg> Simulate random`;
}

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {

  // Load model data
  setStatus('loading', 'Loading model…');
  try {
    const [metrics, fi] = await Promise.all([apiGet('/api/metrics'), apiGet('/api/feature-importance')]);
    renderMetrics(metrics);
    renderFeatImportance(fi);
    setStatus('', `${metrics.model_type} — online`);
  } catch (e) {
    console.error(e);
    setStatus('error', 'Model unavailable');
  }

  // Analyze form submit
  $('tx-form').addEventListener('submit', async e => {
    e.preventDefault();
    const payload = getFormPayload();
    if (!payload.amount) { alert('Please enter a transaction amount.'); return; }
    setAnalyzeLoading(true);
    try {
      const t0 = performance.now();
      const result = await apiPost('/api/predict', payload);
      const ms = Math.round(performance.now() - t0);
      updateVerdict(result, ms);
      addLogRow(result, payload);
    } catch (err) {
      alert('Prediction error: ' + err.message);
    } finally {
      setAnalyzeLoading(false);
    }
  });

  // Simulate button
  $('btn-simulate').addEventListener('click', async () => {
    setSimulateLoading(true);
    try {
      const t0 = performance.now();
      const data = await apiPost('/api/simulate', {});
      const ms = Math.round(performance.now() - t0);
      fillForm(data.transaction);
      updateVerdict(data, ms);
      addLogRow(data, data.transaction);
    } catch (err) {
      alert('Simulation error: ' + err.message);
    } finally {
      setSimulateLoading(false);
    }
  });

  // Clear button
  $('btn-clear') && $('btn-clear').addEventListener('click', () => {
    ['tx-amount','tx-old-bal-org','tx-new-bal-org','tx-old-bal-dest','tx-new-bal-dest']
      .forEach(id => { const el = $(id); if (el) el.value = ''; });
  });

  // Chip filter
  document.querySelectorAll('.chip[data-filter]').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.chip[data-filter]').forEach(c => c.classList.remove('on'));
      chip.classList.add('on');
      renderLog(chip.dataset.filter);
    });
  });
});
