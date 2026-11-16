import React, { useEffect, useState } from 'react';
import { Activity, ArrowUpRight, CircleHelp, HeartPulse, Moon, RefreshCw, ShieldCheck, Unplug } from 'lucide-react';
import { disconnectWhoop, getConnectionStatus, getSnapshot, refreshSnapshot, startConnection } from './local-api.js';
import { formatTimeInZone, hourInTimeZone } from './dashboard-time.mjs';
import { shouldExpireSnapshot } from './snapshot-expiry.mjs';

function displayNumber(value, suffix = '') {
  return value === null || value === undefined ? '—' : `${value}${suffix}`;
}

function duration(milliseconds) {
  if (milliseconds === null || milliseconds === undefined) return '—';
  const hours = Math.floor(milliseconds / 3600000);
  const minutes = Math.round((milliseconds % 3600000) / 60000);
  return `${hours}h ${minutes}m`;
}

function totalSleepMilliseconds(stage) {
  if (!stage) return null;
  const values = [stage.total_light_sleep_time_milli, stage.total_slow_wave_sleep_time_milli, stage.total_rem_sleep_time_milli];
  return values.every(Number.isFinite) ? values.reduce((total, value) => total + value, 0) : null;
}

function StateNote({ state }) {
  if (!state || state === 'SCORED') return null;
  const label = state === 'PENDING_SCORE' ? 'WHOOP is still scoring this period' : state === 'UNSCORABLE' ? 'WHOOP could not score this period' : 'Data has not arrived yet';
  return <p className="state-note"><CircleHelp size={17} aria-hidden="true" />{label}</p>;
}

function Metric({ label, value, detail, accent = false }) {
  return <div className={`metric${accent ? ' metric--accent' : ''}`}>
    <span className="metric__label">{label}</span>
    <strong className="metric__value">{value}</strong>
    {detail && <span className="metric__detail">{detail}</span>}
  </div>;
}

function Morning({ snapshot }) {
  const data = snapshot?.data;
  const sleep = data?.sleep;
  const recovery = data?.recovery;
  const body = data?.body;
  const stage = sleep?.values?.stage_summary;
  const weight = body?.weightKilogram;

  return <section className="summary" aria-label="Morning summary">
    <div className="summary__heading">
      <div><p className="eyebrow">01 / RESET</p><h2>Morning, in focus.</h2></div>
      <div className="summary__glyph"><Moon size={21} strokeWidth={1.7} aria-hidden="true" /></div>
    </div>
    {!data && <div className="empty-state"><span className="empty-state__mark"><Moon size={23} /></span><div><strong>Morning data is waiting</strong><p>Refresh once WHOOP has finished syncing your sleep.</p></div></div>}
    {data && <>
      <StateNote state={sleep?.state} />
      <div className="metric-grid metric-grid--morning">
        <Metric label="Sleep score" value={displayNumber(sleep?.values?.sleep_performance_percentage, '%')} accent />
        <Metric label="Recovery" value={displayNumber(recovery?.values?.recovery_score, '%')} />
        <Metric label="Sleep duration" value={duration(totalSleepMilliseconds(stage))} />
        <Metric label="HRV" value={displayNumber(recovery?.values?.hrv_rmssd_milli, ' ms')} />
        <Metric label="Resting heart rate" value={displayNumber(recovery?.values?.resting_heart_rate, ' bpm')} />
        <Metric label="Body mass" value={displayNumber(weight, ' kg')} />
      </div>
    </>}
  </section>;
}

function Evening({ snapshot }) {
  const cycle = snapshot?.data?.cycle;
  return <section className="summary" aria-label="Evening summary">
    <div className="summary__heading">
      <div><p className="eyebrow">02 / THE DAY</p><h2>Today, as it happened.</h2></div>
      <div className="summary__glyph summary__glyph--orange"><Activity size={21} strokeWidth={1.7} aria-hidden="true" /></div>
    </div>
    {!cycle && <div className="empty-state"><span className="empty-state__mark empty-state__mark--orange"><Activity size={23} /></span><div><strong>Cycle data is waiting</strong><p>Refresh when WHOOP has updated today's cycle.</p></div></div>}
    {cycle && <>
      <StateNote state={cycle.state} />
      <div className="metric-grid metric-grid--evening">
        <Metric label="Strain" value={displayNumber(cycle.values?.strain)} accent />
        <Metric label="Steps" value={displayNumber(cycle.stepCount?.toLocaleString())} />
        <Metric label="Energy output" value={displayNumber(cycle.values?.kilojoule, ' kJ')} />
      </div>
    </>}
  </section>;
}

const errorText = (error) => {
  if (error.status === 429) return `WHOOP is rate limiting requests${error.retryAfterSeconds ? `; try again in ${error.retryAfterSeconds}s` : ''}.`;
  if (error.status === 403) return 'WHOOP did not grant a required permission. Reconnect and approve all requested data scopes.';
  if (error.status === 404) return 'WHOOP has no data for this period yet.';
  if (error.status === 401) return 'Reconnect WHOOP to continue.';
  return 'WHOOP could not be reached. Try again later.';
};

export default function WhoopDashboard({ persistentContent = null }) {
  const [period, setPeriod] = useState('morning');
  const [timeZone, setTimeZone] = useState('UTC');
  const [connection, setConnection] = useState('loading');
  const [canFetch, setCanFetch] = useState(false);
  const [snapshots, setSnapshots] = useState({ morning: null, evening: null });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [refreshError, setRefreshError] = useState('');
  const [retryAt, setRetryAt] = useState(0);
  const [retryWait, setRetryWait] = useState(0);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const callbackResult = params.get('whoop');
    if (callbackResult) {
      const callbackMessages = {
        connected: 'WHOOP connected.',
        denied: 'WHOOP access was not approved.',
        missing_scopes: 'Required WHOOP permissions were not granted.',
        invalid_state: 'The authorization expired or was already used. Start again.',
      };
      setMessage(callbackMessages[callbackResult] ?? 'WHOOP could not complete authorization.');
      history.replaceState(null, '', location.pathname);
    }
    Promise.all([getConnectionStatus(), getSnapshot('morning'), getSnapshot('evening')])
      .then(([status, morning, evening]) => {
        const configuredTimeZone = status.timeZone ?? 'UTC';
        setTimeZone(configuredTimeZone);
        setPeriod(hourInTimeZone(new Date(), configuredTimeZone) < 12 ? 'morning' : 'evening');
        setConnection(status.connection);
        setCanFetch(Boolean(status.canFetch));
        setSnapshots({ morning: morning.snapshot, evening: evening.snapshot });
      })
      .catch(() => {
        setConnection('unavailable');
        setCanFetch(false);
      });
  }, []);

  useEffect(() => {
    if (!retryAt) return undefined;
    const update = () => {
      const remaining = Math.max(0, Math.ceil((retryAt - Date.now()) / 1000));
      setRetryWait(remaining);
      if (remaining === 0) setRetryAt(0);
    };
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [retryAt]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const current = new Date();
      setSnapshots((existing) => {
        const next = { ...existing };
        for (const [name, snapshot] of Object.entries(existing)) {
          if (shouldExpireSnapshot(name, snapshot, current, timeZone)) next[name] = null;
        }
        return next;
      });
    }, 30000);
    return () => window.clearInterval(timer);
  }, [timeZone]);

  async function connect() {
    setBusy(true);
    setMessage('');
    try {
      const { authorizationUrl } = await startConnection();
      location.assign(authorizationUrl);
    } catch (error) {
      setMessage(errorText(error));
      setBusy(false);
    }
  }

  async function refresh() {
    setBusy(true);
    setRefreshError('');
    try {
      const result = await refreshSnapshot(period);
      setSnapshots((current) => ({ ...current, [period]: { data: result.snapshot.data, fetchedAt: result.snapshot.fetchedAt } }));
      const status = await getConnectionStatus();
      setConnection(status.connection);
      setCanFetch(Boolean(status.canFetch));
      setMessage('');
    } catch (error) {
      setRefreshError(errorText(error));
      if (error.status === 429) setRetryAt(Date.now() + (error.retryAfterSeconds ?? 60) * 1000);
      if (error.status === 401) {
        setConnection('reconnect_required');
        setCanFetch(false);
      }
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!window.confirm('Disconnect WHOOP and erase locally stored tokens and dashboard data?')) return;
    setBusy(true);
    try {
      await disconnectWhoop();
      setSnapshots({ morning: null, evening: null });
      setConnection('disconnected');
      setCanFetch(false);
      setMessage('WHOOP disconnected. Local tokens and cached summaries were cleared.');
      setRefreshError('');
      setRetryAt(0);
    } catch {
      setMessage('Disconnect could not be completed. Local cleanup is retried on the next action.');
    } finally {
      setBusy(false);
    }
  }

  const activeSnapshot = snapshots[period];
  const connectionLabel = {
    loading: 'Checking connection',
    connected: 'WHOOP connected',
    reconnect_required: 'Reconnect needed',
    disconnected: 'Not connected',
    unavailable: 'API unavailable',
  }[connection] ?? 'Connection unavailable';

  return <main className="dashboard-shell">
    <header className="topbar">
      <div className="brand"><div className="brand__symbol"><HeartPulse size={21} strokeWidth={1.9} /></div><div><span className="brand__name">WHOOP</span><span className="brand__caption">DAILY SIGNAL</span></div></div>
      <div className="topbar__right">
        <div className={`connection connection--${connection}`}><span className="connection__dot" />{connectionLabel}</div>
        <button className="icon-button" type="button" title="Disconnect WHOOP" aria-label="Disconnect WHOOP" disabled={busy || connection === 'disconnected'} onClick={disconnect}><Unplug size={18} /></button>
      </div>
    </header>

    <div className="dashboard-content">
      <section className="whoop-workspace" aria-label="WHOOP summary">
        <div className="intro-row">
          <div><p className="eyebrow">YOUR PERSONAL DASHBOARD</p><h1>Read the day.</h1></div>
          <div className="freshness"><ShieldCheck size={16} aria-hidden="true" /><span>{activeSnapshot?.fetchedAt ? `Updated ${formatTimeInZone(activeSnapshot.fetchedAt, timeZone, { hour: 'numeric', minute: '2-digit' })}` : 'No fresh data'}</span></div>
        </div>

        <nav className="period-switch" aria-label="Summary period">
          <button type="button" className={period === 'morning' ? 'period-switch__item is-active' : 'period-switch__item'} onClick={() => { setPeriod('morning'); setRefreshError(''); }}><Moon size={17} />Morning</button>
          <button type="button" className={period === 'evening' ? 'period-switch__item is-active' : 'period-switch__item'} onClick={() => { setPeriod('evening'); setRefreshError(''); }}><Activity size={17} />Evening</button>
        </nav>

        {period === 'morning' ? <Morning snapshot={activeSnapshot} /> : <Evening snapshot={activeSnapshot} />}

        <footer className="action-row">
          <div className="disclaimer"><span>PERSONAL WELLNESS DATA</span><span>Not medical advice</span></div>
          <div className="actions">
            {connection !== 'connected' && <button className="button button--connect" type="button" onClick={connect} disabled={busy}><ArrowUpRight size={17} />{connection === 'reconnect_required' ? 'Reconnect' : 'Connect WHOOP'}</button>}
            {(connection === 'connected' || canFetch) && <button className="button button--refresh" type="button" onClick={refresh} disabled={busy || retryWait > 0}><RefreshCw size={17} className={busy ? 'spin' : ''} />{busy ? 'Refreshing' : retryWait > 0 ? `Retry in ${retryWait}s` : 'Refresh summary'}</button>}
          </div>
        </footer>
        {(message || refreshError) && <p className={`feedback${refreshError ? ' feedback--error' : ''}`} role="status">{refreshError || message}</p>}
      </section>
      <aside className="weather-workspace" aria-label="Weather summary">{persistentContent}</aside>
    </div>
  </main>;
}