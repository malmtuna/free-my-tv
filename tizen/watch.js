/*
 * Free My TV's background helper on Samsung TVs: a Tizen web service (FreeMyTVio.FreeMyTVWatch), packed with the
 * app as watch.js and started by it.
 *
 * Samsung keeps the Home button: it opens Samsung's own home screen and no app may register for it (unlike Android
 * TV, where Free My TV is the home app). This service stands in for that, from its own process, so a frozen page
 * under a heavy app doesn't stop it.
 *
 * The page tells it the two things the TV won't:
 *   /here            the page is on screen (it says so on every visibilitychange).
 *   /away?app=<id>   the page lost the screen, and which app it was opening (TV Settings and the inputs have
 *                    no queryable id and are passed as org.tizen.menu / org.tizen.tv-viewer).
 * The TV's own services (port 8001, which answers only callers on the TV) supply the rest:
 *   /api/v2/applications/<id>  { running, visible }: it answers for store apps, so the app the person opened is
 *                              followed until it is no longer visible, and Free My TV then comes back.
 *   /api/v2/                   PowerState, so a TV switched off isn't switched back on.
 * Our own app it will NOT report as visible: on a 2026 S85H (Tizen 10) `visible` stays false for a web app even
 * with it in front, which is why the page, not the TV, says when Free My TV has the screen.
 *
 * When it decides the Home button was pressed (or an app closed), it opens Free My TV again through Samsung's
 * `eden_resume` app control, so it resumes instead of reloading. The idea, and the app-control names, are
 * Skylight's (github.com/SaudSatopay/skylight-tizen, MIT), which does the same for its own home screen.
 *
 * The home screen turns it off (Home Settings > Home button) over its port and as a service request. Its state is
 * served at /state (readable from the TV; the commands are only taken from the TV itself).
 */
'use strict';

var http = require('http');

var APP = 'FreeMyTVio.FreeMyTV';
var PORT = 8131;          // ours; 8130 is Skylight's, if it is installed too
var GAP_MS = 6000;        // between two attempts: the TV needs a moment to bring the app up
var AWAY_MS = 900;        // off screen for longer than this counts as having left it
var BURST = 8;            // attempts in a minute that leave us still off screen: back off
var PAUSE_MS = 120000;
var BLIND = 4;            // attempts in a row that never bring the page back: stand down
var MAX_QUERIES = 12;     // store apps to ask about in one pass
var LOG_MAX = 80;

// Samsung's own screens: an input, its menu. Neither can be asked about, so a page that opened one is left alone.
var TAKEN = ['org.tizen.tv-viewer', 'org.tizen.menu'];

var lines = [];
var guard = { on: true, pausedUntil: 0, busy: false, since: '', timer: null, here: true, awayAt: 0,
              lastAttempt: 0, attempts: [], launches: 0, watch: '', watchedSeen: false,
              last: { power: '', apps: 0, screen: '', action: 'starting' } };

function log(text) {
  var t = new Date();
  var two = function (n) { return (n < 10 ? '0' : '') + n; };
  lines.push(two(t.getHours()) + ':' + two(t.getMinutes()) + ':' + two(t.getSeconds()) + '  ' + text);
  if (lines.length > LOG_MAX) lines.shift();
  try { console.log('[FreeMyTV watch] ' + text); } catch (e) {}
}

// MARK: - Asking the TV

/** One GET on the TV itself; done(status, body), with 0 for no answer. */
function get(port, path, done) {
  var finished = false;
  function finish(status, body) { if (!finished) { finished = true; done(status, body); } }
  var req = http.get({ host: '127.0.0.1', port: port, path: path, headers: { 'Cache-Control': 'no-cache' } }, function (res) {
    var body = '';
    res.setEncoding('utf8');
    res.on('data', function (chunk) { body += chunk; });
    res.on('end', function () { finish(res.statusCode, body); });
  });
  req.setTimeout(1500, function () { req.abort(); finish(0, ''); });
  req.on('error', function () { finish(0, ''); });
}

/** The TV's own status for one app: { running, visible }, or null where it won't say (Samsung's own screens). */
function appState(id, done) {
  get(8001, '/api/v2/applications/' + id, function (status, body) {
    var info = null;
    try { info = JSON.parse(body); } catch (e) {}
    done(status === 200 && info && typeof info.running === 'boolean' ? { running: info.running, visible: !!info.visible } : null);
  });
}

/** The TV's power state ('on', 'off', ...), or '' when it won't say. */
function powerState(done) {
  get(8001, '/api/v2/', function (status, body) {
    var info = null;
    try { info = JSON.parse(body); } catch (e) {}
    done(status === 200 && info && info.device ? String(info.device.PowerState || '') : '');
  });
}

/** The apps running now, as ids, or null when the TV won't list them. */
function runningIds(done) {
  try {
    tizen.application.getAppsContext(function (list) {
      var ids = [];
      for (var i = 0; i < list.length; i++) ids.push(list[i].appId);
      done(ids);
    }, function (e) {
      log('the TV did not list its running apps: ' + (e && e.name));
      done(null);
    });
  } catch (e) {
    log('getAppsContext threw: ' + (e && e.name));
    done(null);
  }
}

/** Whether an id is the TV's own machinery rather than an app the person opened. */
function isSystem(id) {
  return /^(com\.samsung\.|org\.tizen\.|com\.sausng\.)/i.test(id) || /tvplus/i.test(id) ||
         TAKEN.indexOf(id) >= 0;
}

/** The running apps the person could have opened: store apps, not Samsung's own pieces. */
function appsToAsk(ids) {
  var out = [];
  for (var i = 0; i < ids.length && out.length < MAX_QUERIES; i++) {
    var id = ids[i];
    if (!id || id === APP || isSystem(id)) continue;
    out.push(id);
  }
  return out;
}

/** Which of these apps the TV says has the screen right now (the first that does, or ''). */
function anyVisible(ids, done) {
  var left = ids.length, found = '';
  if (!left) { done(''); return; }
  for (var i = 0; i < ids.length; i++) {
    (function (id) {
      appState(id, function (state) {
        if (!found && state && state.running && state.visible) found = id;
        if (--left === 0) done(found);
      });
    })(ids[i]);
  }
}

// MARK: - Deciding

function tick() {
  if (!guard.on || guard.busy) return;
  var now = Date.now();
  if (guard.here || !guard.awayAt) return;                                  // the page says it is on screen
  if (now < guard.pausedUntil || now - guard.lastAttempt < GAP_MS) return;
  if (now - guard.awayAt < AWAY_MS) return;                                 // give the TV a moment to settle
  guard.busy = true;
  powerState(function (power) {
    guard.last.power = power;
    if (power !== 'on') { guard.awayAt = 0; guard.last.action = 'the TV is not on'; guard.busy = false; return; }
    if (guard.watch) { followWatched(); return; }
    runningIds(function (ids) {
      if (!ids) { guard.last.action = 'the TV would not list its apps'; guard.busy = false; open(); return; }
      var ask = appsToAsk(ids);
      guard.last.apps = ask.length;
      anyVisible(ask, function (shown) {
        guard.busy = false;
        guard.last.screen = shown || '';
        if (shown) {
          guard.watch = shown;
          guard.last.action = shown + ' has the screen';
          log('an app has the screen (' + shown + '): staying away until it lets go');
          return;
        }
        open();
      });
    });
  });
}

/** An app the page opened: while the TV says it has the screen, stay away; then come back. */
function followWatched() {
  var id = guard.watch;
  // The TV's own settings and the inputs can't be asked about: leave them alone until the page is back.
  if (isSystem(id)) { guard.busy = false; guard.last.action = 'the TV\'s own screen (' + id + ')'; return; }
  appState(id, function (state) {
    guard.busy = false;
    if (state && state.visible) { guard.watchedSeen = true; guard.last.action = id + ' has the screen'; return; }
    if (!state && !guard.watchedSeen) { guard.last.action = id + ' cannot be asked about yet'; return; }
    guard.watch = '';
    guard.watchedSeen = false;
    guard.last.screen = '';
    log(id + (state ? ' left the screen' : ' is not running any more'));
    open();
  });
}

function open() {
  guard.last.action = 'opening Free My TV';
  if (++guard.launches > BLIND) {
    guard.on = false;
    guard.last.action = 'stood down';
    log('Free My TV would not come back after ' + BLIND + ' tries: leaving the Home button to the TV');
    return;
  }
  var now = Date.now();
  guard.attempts.push(now);
  while (guard.attempts.length && now - guard.attempts[0] > 60000) guard.attempts.shift();
  if (guard.attempts.length > BURST) {
    guard.attempts = [];
    guard.pausedUntil = now + PAUSE_MS;
    log('Free My TV would not stay in front: leaving the screen alone for two minutes');
    return;
  }
  guard.lastAttempt = now;
  log('nothing of ours is on screen: opening Free My TV');
  // The same request Samsung's own home makes to resume an app (`eden_resume`, declared in config.xml with
  // reload="disable"), so Free My TV comes back as it was instead of reloading. Plain launch where that fails.
  try {
    var resume = new tizen.ApplicationControl('http://samsung.com/appcontrol/operation/eden_resume');
    tizen.application.launchAppControl(resume, APP, function () { log('Free My TV is opening'); },
      function (e) {
        log('resume refused (' + (e && e.name) + '): opening it the plain way');
        plainOpen();
      });
  } catch (e) {
    plainOpen();
  }
}

function plainOpen() {
  try {
    tizen.application.launch(APP, function () { log('Free My TV is opening'); },
      function (e) { log('the TV would not open Free My TV: ' + (e && e.name)); });
  } catch (e) {
    log('launch threw: ' + (e && e.name));
  }
}

// MARK: - What the page and the settings screen say

function query(url) {
  var out = {}, at = String(url || '').indexOf('?');
  if (at < 0) return out;
  var pairs = url.slice(at + 1).split('&');
  for (var i = 0; i < pairs.length; i++) {
    if (!pairs[i]) continue;
    var eq = pairs[i].indexOf('=');
    var key = eq < 0 ? pairs[i] : pairs[i].slice(0, eq);
    var value = eq < 0 ? '' : decodeURIComponent(pairs[i].slice(eq + 1).replace(/\+/g, ' '));
    out[decodeURIComponent(key)] = value;
  }
  return out;
}

function handle(cmd, params) {
  if (cmd === 'on') {
    guard.on = true;
    guard.pausedUntil = 0;
    guard.attempts = [];
    guard.launches = 0;
    guard.watch = '';
    guard.awayAt = 0;
    guard.here = true;
    log('holding the Home button: Samsung\'s screen goes back to Free My TV');
  } else if (cmd === 'off') {
    guard.on = false;
    log('leaving the Home button to the TV: Samsung\'s screen stays');
  } else if (cmd === 'here') {
    guard.here = true;
    guard.awayAt = 0;
    guard.watch = '';
    guard.launches = 0;
    guard.last.action = 'the page is on screen';
  } else if (cmd === 'away') {
    guard.here = false;
    guard.awayAt = Date.now();
    guard.watch = params.app || '';
    guard.watchedSeen = false;
    guard.last.action = guard.watch ? 'the page left for ' + guard.watch : 'the page left the screen';
  } else if (cmd === 'pause') {
    var seconds = parseInt(params.seconds, 10) || 180;
    guard.pausedUntil = Date.now() + seconds * 1000;
    log('leaving the screen alone for ' + seconds + ' s');
  } else {
    log('unknown command: ' + cmd);
  }
}

function state() {
  return { on: guard.on, paused: Date.now() < guard.pausedUntil, here: guard.here, watch: guard.watch,
           awayFor: guard.awayAt ? Date.now() - guard.awayAt : 0, app: APP, port: PORT, since: guard.since,
           last: guard.last, lines: lines.slice(-25) };
}

var server = http.createServer(function (req, res) {
  var path = String(req.url || '/').replace(/^\/+/, '').split('?')[0];
  var local = req.socket && req.socket.localAddress;
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (path === 'state' || path === 'log') {
      res.setHeader('Content-Type', 'application/json');
      res.end(path === 'state' ? JSON.stringify(state())
                               : JSON.stringify({ since: guard.since, lines: lines.slice(-40) }));
      return;
    }
    // Only the TV itself may drive it: `here`/`away` come from the page, `on`/`off` from Home Settings.
    if (path === 'on' || path === 'off' || path === 'pause' || path === 'here' || path === 'away') {
      if (local && local !== '127.0.0.1' && local !== '::1' && local !== '::ffff:127.0.0.1') {
        res.statusCode = 403;
        res.end('from the TV only');
        return;
      }
      handle(path, query(req.url));
      res.end('ok');
      return;
    }
  } catch (e) {
    log('a command failed: ' + (e && e.name));
  }
  res.statusCode = 404;
  res.end('not found');
});
server.on('error', function (e) { log('could not listen on port ' + PORT + ': ' + (e && e.message)); });

/** A request from the home screen (an app control, which also starts this service when it isn't running). */
function readRequest() {
  var out = {};
  try {
    var items = tizen.application.getCurrentApplication().getRequestedAppControl().appControl.data;
    for (var i = 0; i < items.length; i++) {
      out[items[i].key] = items[i].value.length ? items[i].value[0] : '';
    }
  } catch (e) {
    log('no request data: ' + (e && e.name));
  }
  return out;
}

module.exports = {
  onStart: function () {
    var t = new Date();
    guard.since = t.toDateString().slice(0, 10) + ' ' + t.toTimeString().slice(0, 8);
    log('started');
    try {
      server.listen(PORT, '0.0.0.0', function () { log('listening on port ' + PORT); });
    } catch (e) {
      log('listen threw: ' + (e && e.message));
    }
    guard.timer = setInterval(tick, 1000);
  },
  onRequest: function () {
    var req = readRequest();
    if (req.cmd) handle(req.cmd, req);
  },
  onExit: function () { if (guard.timer) clearInterval(guard.timer); guard.timer = null; },
  onStop: function () { if (guard.timer) clearInterval(guard.timer); guard.timer = null; }
};
