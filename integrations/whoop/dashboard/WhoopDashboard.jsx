import { useEffect, useState } from 'react';
import { Activity, ArrowUpRight, CircleHelp, HeartPulse, Moon, RefreshCw, ShieldCheck, Unplug } from 'lucide-react';
import { disconnectWhoop, getConnectionStatus, getSnapshot, refreshSnapshot, startConnection } from './local-api.js';

function initialPeriod() {
  return new Date().getHours() < 12 ? 'morning' : 'evening';
}

function displayNumber(value, suffix = '') {
  return value === null || value === undefined ? '—' : `${value}${suffix}`;
}

function duration(milliseconds) {
  if (milliseconds === null || milliseconds === undefined) return '—';
  const hours = Math.floor(milliseconds / 3600000);
  const minutes = Math.round((milliseconds % 3600000) / 60000);
  return `${hours}h ${minutes}m`;
}

function dateAtOffset(timestamp, offset, options) {
  if (!timestamp) return '—';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '—';
  const match = typeof offset === 'string' ? /^([+-])(\d{2}):(\d{2})$/.exec(offset) : null;
  if (!match && offset !== 'Z') return date.toLocaleString([], options);
  const minutes = offset === 'Z' ? 0 : (Number(match[2]) * 60 + Number(match[3])) * (match[1] === '+' ? 1 : -1);
  const shifted = new Date(date.getTime() + minutes * 60000);
  return new Intl.DateTimeFormat([], { ...options, timeZone: 'UTC' }).format(shifted);
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
      <div className="metric-grid">
        <Metric label="Sleep performance" value={displayNumber(sleep?.values?.sleep_performance_percentage, '%')} detail={sleep?.start ? `Ended ${dateAtOffset(sleep.end, sleep.timezoneOffset, { hour: 'numeric', minute: '2-digit' })} · ${sleep.timezoneOffset ?? 'local time'}` : 'No sleep recorded'} accent />
        <Metric label="Recovery" value={displayNumber(recovery?.values?.recovery_score, '%')} detail={recovery?.state === 'SCORED' ? 'WHOOP recovery score' : recovery?.state?.replaceAll('_', ' ') ?? 'No recovery yet'} />
        <Metric label="HRV · RMSSD" value={displayNumber(recovery?.values?.hrv_rmssd_milli, ' ms')} detail="Milliseconds" />
        <Metric label="Resting heart rate" value={displayNumber(recovery?.values?.resting_heart_rate, ' bpm')} detail="Beats per minute" />
        <Metric label="Sleep · REM" value={duration(stage?.total_rem_sleep_time_milli)} detail="REM sleep" />
        <Metric label="Total sleep" value={duration(totalSleepMilliseconds(stage))} detail="Light, deep and REM" />
        <Metric label="Body mass" value={displayNumber(weight, ' kg')} detail={body?.heightMeter ? `Height ${body.heightMeter} m` : 'Body measurements'} />
        <Metric label="Max heart rate" value={displayNumber(body?.maxHeartRate, ' bpm')} detail="WHOOP measurement" />
      </div>
      {!body && <p className="subtle-note">Body measurements are not available yet.</p>}
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
        <Metric label="Day strain" value={displayNumber(cycle.values?.strain)} detail={cycle.state === 'SCORED' ? 'WHOOP scale · 0 to 21' : cycle.state?.replaceAll('_', ' ') ?? 'No score yet'} accent />
        <Metric label="Steps" value={displayNumber(cycle.stepCount?.toLocaleString())} detail="This cycle" />
        <Metric label="Energy" value={displayNumber(cycle.values?.kilojoule, ' kJ')} detail="Kilojoules" />
        <Metric label="Average heart rate" value={displayNumber(cycle.values?.average_heart_rate, ' bpm')} detail="Across the cycle" />
        <Metric label="Peak heart rate" value={displayNumber(cycle.values?.max_heart_rate, ' bpm')} detail="Across the cycle" />
        <Metric label="Cycle time" value={dateAtOffset(cycle.start, cycle.timezoneOffset, { month: 'short', day: 'numeric' })} detail={cycle.timezoneOffset ? `Offset ${cycle.timezoneOffset}` : 'Local cycle date'} />
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

export default function WhoopDashboard() {
  const [period, setPeriod] = useState(initialPeriod);
  const [connection, setConnection] = useState('loading');
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
        setConnection(status.connection);
        setSnapshots({ morning: morning.snapshot, evening: evening.snapshot });
      })
      .catch(() => setConnection('unavailable'));
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
      const today = `${current.getFullYear()}-${current.getMonth()}-${current.getDate()}`;
      setSnapshots((existing) => {
        const next = { ...existing };
        for (const [name, snapshot] of Object.entries(existing)) {
          if (!snapshot?.fetchedAt) continue;
          const fetched = new Date(snapshot.fetchedAt);
          const fetchedDay = `${fetched.getFullYear()}-${fetched.getMonth()}-${fetched.getDate()}`;
          if (fetchedDay !== today || (name === 'morning' && current.getHours() >= 12)) next[name] = null;
        }
        return next;
      });
    }, 30000);
    return () => window.clearInterval(timer);
  }, []);

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
      setConnection('connected');
      setMessage('');
    } catch (error) {
      setRefreshError(errorText(error));
      if (error.status === 429) setRetryAt(Date.now() + (error.retryAfterSeconds ?? 60) * 1000);
      if (error.status === 401) setConnection('reconnect_required');
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
      <div className="intro-row">
        <div><p className="eyebrow">YOUR PERSONAL DASHBOARD</p><h1>Read the day.</h1></div>
        <div className="freshness"><ShieldCheck size={16} aria-hidden="true" /><span>{activeSnapshot?.fetchedAt ? `Updated ${new Date(activeSnapshot.fetchedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'No fresh data'}</span></div>
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
          {connection === 'connected' && <button className="button button--refresh" type="button" onClick={refresh} disabled={busy || retryWait > 0}><RefreshCw size={17} className={busy ? 'spin' : ''} />{busy ? 'Refreshing' : retryWait > 0 ? `Retry in ${retryWait}s` : 'Refresh summary'}</button>}
        </div>
      </footer>
      {(message || refreshError) && <p className={`feedback${refreshError ? ' feedback--error' : ''}`} role="status">{refreshError || message}</p>}
    </div>
  </main>;
}