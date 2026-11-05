/* Pi Monitor: Home Screens plugin bundle.
 * Hand-written IIFE, no build step. React and the SDK are host globals. */
(function () {
  var React = window.React;
  var h = React.createElement;
  var useState = React.useState;
  var useEffect = React.useEffect;

  var PLUGIN_ID = 'pi-monitor';
  var DEFAULT_URL = 'http://127.0.0.1:8765/stats';

  var GREEN = '#4ade80';
  var AMBER = '#fbbf24';
  var RED = '#f87171';

  function sdk() {
    return window.__HS_SDK__ || {};
  }

  function formatBytes(n) {
    if (n == null) return '–';
    var gb = n / (1024 * 1024 * 1024);
    if (gb >= 1) return gb.toFixed(1) + ' GB';
    return Math.round(n / (1024 * 1024)) + ' MB';
  }

  function formatUptime(sec) {
    if (sec == null) return '–';
    var d = Math.floor(sec / 86400);
    var hrs = Math.floor((sec % 86400) / 3600);
    var m = Math.floor((sec % 3600) / 60);
    if (d > 0) return d + 'd ' + hrs + 'h';
    if (hrs > 0) return hrs + 'h ' + m + 'm';
    return m + 'm';
  }

  function usageColor(pct) {
    if (pct >= 90) return RED;
    if (pct >= 75) return AMBER;
    return GREEN;
  }

  function tempLevel(tempC, cfg) {
    var warn = Number(cfg.warnTemp) || 70;
    var crit = Number(cfg.critTemp) || 80;
    if (tempC >= crit) return 'critical';
    if (tempC >= warn) return 'warn';
    return 'ok';
  }

  function levelColor(level) {
    return level === 'critical' ? RED : level === 'warn' ? AMBER : GREEN;
  }

  function isThrottled(t) {
    return !!(t && (t.underVoltageNow || t.throttledNow || t.freqCappedNow || t.softTempLimitNow));
  }

  function Bar(props) {
    var pct = Math.max(0, Math.min(100, props.pct || 0));
    return h('div', { style: { marginBottom: '0.55em' } },
      h('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '0.85em', opacity: 0.9, marginBottom: 3 } },
        h('span', null, props.label),
        h('span', { style: { fontVariantNumeric: 'tabular-nums' } }, props.value)
      ),
      h('div', { style: { height: 8, borderRadius: 4, background: 'rgba(255,255,255,0.18)', overflow: 'hidden' } },
        h('div', {
          style: {
            width: pct + '%', height: '100%', borderRadius: 4,
            background: props.color || usageColor(pct),
            transition: 'width 0.6s ease, background 0.6s ease'
          }
        })
      )
    );
  }

  function Badge(props) {
    return h('span', {
      style: {
        display: 'inline-block', padding: '2px 8px', borderRadius: 999,
        fontSize: '0.75em', fontWeight: 600, color: '#111',
        background: props.color, marginRight: 6, marginTop: 4
      }
    }, props.children);
  }

  function powerBadges(t) {
    if (!t) return null;
    var out = [];
    if (t.underVoltageNow) out.push(h(Badge, { key: 'uv', color: RED }, 'Under-voltage'));
    if (t.throttledNow) out.push(h(Badge, { key: 'th', color: RED }, 'Throttled'));
    if (t.softTempLimitNow) out.push(h(Badge, { key: 'st', color: AMBER }, 'Temp limit'));
    if (t.freqCappedNow && !t.throttledNow) out.push(h(Badge, { key: 'fc', color: AMBER }, 'Freq capped'));
    if (!out.length) {
      if (t.underVoltageEver || t.throttledEver || t.softTempLimitEver || t.freqCappedEver) {
        out.push(h(Badge, { key: 'ev', color: AMBER }, 'Throttled since boot'));
      } else {
        out.push(h(Badge, { key: 'ok', color: GREEN }, 'Power OK'));
      }
    }
    return out;
  }

  function PiMonitor(props) {
    var config = props.config || {};
    var interval = Math.max(2, Number(config.refreshInterval) || 5);

    var dataState = useState(null);
    var data = dataState[0], setData = dataState[1];
    var errorState = useState(undefined);
    var error = errorState[0], setError = errorState[1];

    useEffect(function () {
      var alive = true;
      var failedSince = null;
      var S = sdk();

      function report(status) {
        try { if (S.reportProviderHealth) S.reportProviderHealth(PLUGIN_ID, status); } catch (e) { /* ignore */ }
      }

      function load() {
        var settings = {};
        try { settings = (S.getPluginSettings && S.getPluginSettings(PLUGIN_ID)) || {}; } catch (e) { /* ignore */ }
        var url = settings.statsUrl || DEFAULT_URL;

        S.pluginFetch(PLUGIN_ID, { url: url, cacheTtlMs: 0 })
          .then(function (res) {
            if (!res.ok) throw new Error('Stats service answered ' + res.status);
            return res.json();
          })
          .then(function (json) {
            if (!alive) return;
            setData(json);
            setError(undefined);
            if (failedSince !== null) {
              failedSince = null;
              report({ ok: true });
            }
          })
          .catch(function (err) {
            if (!alive) return;
            var msg = err && err.message ? err.message : String(err);
            setError("Can't reach the Pi stats service (" + msg + ')');
            if (failedSince === null) failedSince = Date.now();
            report({ ok: false, message: "Pi stats service isn't responding", since: failedSince });
          });
      }

      load();
      var id = setInterval(load, interval * 1000);
      return function () { alive = false; clearInterval(id); };
    }, [interval]);

    // Publish values other modules can use in visibility conditions.
    // (Never cleared on unmount: the host drops them on uninstall/disable.)
    useEffect(function () {
      if (!data) return;
      var S = sdk();
      try {
        if (S.publishState) {
          if (typeof data.tempC === 'number') {
            S.publishState(PLUGIN_ID, 'temp_level', tempLevel(data.tempC, config));
          }
          if (data.throttle) {
            S.publishState(PLUGIN_ID, 'throttled', isThrottled(data.throttle) ? 'true' : 'false');
          }
        }
      } catch (e) { /* ignore */ }
    }, [data, config.warnTemp, config.critTemp]);

    var S = sdk();
    var Loading = S.ModuleLoadingState;

    var content = null;
    if (data) {
      var units = 'metric';
      try { units = (S.getHostSettings && S.getHostSettings().units) || 'metric'; } catch (e) { /* ignore */ }
      var unit = config.tempUnit === 'C' || config.tempUnit === 'F'
        ? config.tempUnit
        : (units === 'imperial' ? 'F' : 'C');

      var rows = [];

      if (config.showTemperature !== false && typeof data.tempC === 'number') {
        var level = tempLevel(data.tempC, config);
        var shown = unit === 'F' ? data.tempC * 9 / 5 + 32 : data.tempC;
        rows.push(h('div', { key: 'temp', style: { display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: '0.5em' } },
          h('span', {
            style: { fontSize: '2.6em', fontWeight: 700, lineHeight: 1, color: levelColor(level), fontVariantNumeric: 'tabular-nums' }
          }, shown.toFixed(0) + '°' + unit),
          h('span', { style: { fontSize: '0.85em', opacity: 0.8 } },
            level === 'critical' ? 'Too hot' : level === 'warn' ? 'Running warm' : 'CPU temp')
        ));
      }

      if (config.showCpu !== false && data.cpu && typeof data.cpu.percent === 'number') {
        var freq = data.cpu.freqMhz ? ' · ' + data.cpu.freqMhz + ' MHz' : '';
        rows.push(h(Bar, { key: 'cpu', label: 'CPU', value: data.cpu.percent.toFixed(0) + '%' + freq, pct: data.cpu.percent }));
      }

      if (config.showMemory !== false && data.memory) {
        rows.push(h(Bar, {
          key: 'mem', label: 'Memory',
          value: formatBytes(data.memory.usedBytes) + ' / ' + formatBytes(data.memory.totalBytes),
          pct: data.memory.percent
        }));
      }

      if (config.showDisk !== false && data.disk) {
        rows.push(h(Bar, {
          key: 'disk', label: 'Disk',
          value: formatBytes(data.disk.usedBytes) + ' / ' + formatBytes(data.disk.totalBytes),
          pct: data.disk.percent
        }));
      }

      if (config.showUptime !== false) {
        var load = data.cpu && data.cpu.loadAvg ? data.cpu.loadAvg[0].toFixed(2) : '–';
        rows.push(h('div', { key: 'up', style: { display: 'flex', justifyContent: 'space-between', fontSize: '0.85em', opacity: 0.85, marginTop: '0.3em' } },
          h('span', null, 'Up ' + formatUptime(data.uptimeSec)),
          h('span', null, 'Load ' + load)
        ));
      }

      if (config.showPowerStatus !== false && data.throttle) {
        rows.push(h('div', { key: 'pw' }, powerBadges(data.throttle)));
      }

      content = h('div', { style: { padding: 16, color: 'inherit' } },
        h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.6em' } },
          h('span', { style: { fontSize: '0.95em', fontWeight: 600 } }, data.model ? data.model.replace(/^Raspberry Pi /, 'Pi ') : 'Raspberry Pi'),
          error ? h('span', { style: { fontSize: '0.75em', color: AMBER } }, 'stale') : null
        ),
        rows
      );
    }

    if (Loading) {
      return h(Loading, { loading: !data, error: data ? undefined : error }, content);
    }
    return content || h('div', { style: { padding: 16 } }, error || 'Loading…');
  }

  window.__HS_PLUGIN__ = { default: PiMonitor };
})();
