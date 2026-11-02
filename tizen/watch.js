/*
 * Free My TV's background helper on Samsung TVs: a Tizen web service (FreeMyTVio.FreeMyTVWatch), packed with the
 * app as watch.js and started by it.
 *
 * Samsung keeps the Home button: it opens Samsung's own home screen and no app may register for it (unlike Android
 * TV, where Free My TV is the home app). This service stands in for that, from its own process, so a frozen page
 * under a heavy app doesn't stop it.
 *
 * It asks the TV's own services (port 8001, which answers only callers on the TV itself):
 *   /api/v2/applications/<app id>  { running, visible } for an app - and this is the catch: on a 2026 set
 *                                  (TQ65S85H, Tizen 10) it only answers for store apps, and 404s for Samsung's own
 *                                  screens, so "is the home on screen" can't be asked at all. Our own app it does
 *                                  answer, so that is what it watches: when Free My TV stops being visible, then
 *                                  either an app took the screen (a new id in the running apps) or the Home button
 *                                  did. Only the TV being off (PowerState) or an app opening stops it coming back.
 *   /api/v2/                       the device, whose PowerState tells standby from the Home button, so a TV turned
 *                                  off isn't switched back on.
 *
 * When it decides the Home button was pressed (or an app closed on this screen), it opens Free My TV again through
 * Samsung's `eden_resume` app control, so it resumes instead of reloading. Home, and leaving an app, then land here
 * after a second or so of Samsung's screen. The idea, and the app-control names, are Skylight's
 * (github.com/SaudSatopay/skylight-tizen, MIT), which does the same for its own home screen.
 *
 * The home screen turns it off (Home Settings > Home button) over its port and as a service request. If the TV never
 * reports Free My TV as on screen, it stops rather than fight the TV.
 */
'use strict';

var http = require('http');

var APP = 'FreeMyTVio.FreeMyTV';
var PORT = 8131;          // ours; 8130 is Skylight's, if it is installed too
var GAP_MS = 6000;        // between two attempts: the TV needs a moment to bring the app up
var AWAY_MS = 900;        // off screen for longer than this counts as having left it
var BURST = 8;            // attempts in a minute that leave us still off screen: back off
var PAUSE_MS = 120000;
var BLIND = 4;            // attempts in a row without ever seeing ourselves on screen: stand down
var LOG_MAX = 80;

// Samsung's home screens, by the names its firmwares give them. Only used to recognise one when it turns up among the
// running apps: the status service won't report these itself (seen on a 2026 TQ65S85H, Tizen 10).
var HOMES = [
  'com.samsung.tv.coba.newhome',
  'com.samsung.tv.coba.newhome.native',
  'com.samsung.tv.home.mainhub',
  'com.samsung.tv.home.apps',
  'com.samsung.tv.home',
  'com.samsung.tv.homescreen',
  'com.samsung.tv.smarthub',
  'com.samsung.tv.home.sidebar',
  'com.samsung.tv.csfs',
  'com.samsung.tv.STVirtualHomeApp',
  'org.tizen.homescreen',
  'HEPsqFNie0.tvplusstandalone'   // TV Plus, which the TV likes to open at power-on
];

// The TV's own screens that are not its home: an input, and its menu.
var TAKEN = ['org.tizen.tv-viewer', 'org.tizen.menu'];

var lines = [];
var guard = { on: true, pausedUntil: 0, busy: false, since: '', timer: null,
              seen: false, gone: 0, snapshot: null, snapAt: 0, lastAttempt: 0, attempts: [], launches: 0, watch: '' };

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

/** The TV's own status for one app: { running, visible }, or null where it won't say (Samsung's own apps, mostly). */
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

/** Whether an app id is one of Samsung's own screens (its home, TV Plus, an input) rather than an app of ours. */
function homeish(id) {
  if (HOMES.indexOf(id) >= 0 || TAKEN.indexOf(id) >= 0) return true;
  return /homescreen|newhome|smarthub|tvplus|(^|\.)home(\.|$)/i.test(id);
}

/** The running apps we haven't seen before, leaving out the TV's own screens: an app the person opened. */
function newApps(ids) {
  if (!guard.snapshot) return [];
  var out = [];
  for (var i = 0; i < ids.length; i++) {
    var id = ids[i];
    if (!id || id === APP || guard.snapshot.indexOf(id) >= 0 || homeish(id)) continue;
    out.push(id);
  }
  return out;
}

function remember() {
  guard.snapAt = Date.now();
  runningIds(function (ids) { if (ids) guard.snapshot = ids; });
}

// MARK: - Watching our own place on the screen

function tick() {
  if (!guard.on || guard.busy) return;
  var now = Date.now();
  if (now < guard.pausedUntil || now - guard.lastAttempt < GAP_MS) return;
  guard.busy = true;
  appState(APP, function (self) {
    if (!self) { guard.busy = false; return; }   // the TV won't say where we are: leave the screen alone
    if (self.visible) {
      guard.busy = false;
      guard.seen = true;
      guard.gone = 0;
      guard.launches = 0;
      if (now - guard.snapAt > 2000) remember();
      return;
    }
    if (!guard.seen) { guard.busy = false; return; }   // never had the screen: nothing to take back
    if (!guard.gone) { guard.gone = now; guard.busy = false; return; }
    if (now - guard.gone < AWAY_MS) { guard.busy = false; return; }
    // Off screen for a moment. The TV being off is not the Home button; an app that just started is not either.
    powerState(function (state) {
      if (state !== 'on') { guard.gone = 0; guard.busy = false; return; }
      runningIds(function (ids) {
        guard.busy = false;
        if (!ids) { guard.gone = 0; return; }
        // An app took the screen: stay away while it has it, and come back when it lets go (that is leaving an app,
        // which ends on Samsung's home). A store app the TV won't report is followed in the running apps instead.
        if (guard.watch && ids.indexOf(guard.watch) >= 0) {
          appState(guard.watch, function (watched) {
            if (watched && !watched.visible) { guard.watch = ''; settle(ids); }
            else guard.gone = 0;
          });
          return;
        }
        guard.watch = '';
        settle(ids);
      });
    });
  });
}

/** Nothing of ours is on screen: open Free My TV, or follow the app that just opened and wait for it to finish. */
function settle(ids) {
  var opened = newApps(ids);
  guard.snapshot = ids;
  guard.snapAt = Date.now();
  if (opened.length) {
    guard.watch = opened[0];
    log('an app has the screen (' + opened[0] + '): staying away while it does');
    guard.gone = 0;
    return;
  }
  open();
}

function open() {
  guard.gone = 0;
  guard.watch = '';
  if (++guard.launches > BLIND) {
    guard.on = false;
    log('the TV never showed Free My TV on screen after ' + BLIND + ' tries: leaving the Home button to the TV');
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

// MARK: - The home screen's commands

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
    guard.gone = 0;
    guard.watch = '';
    guard.seen = false;
    log('holding the Home button: Samsung\'s screen goes back to Free My TV');
  } else if (cmd === 'off') {
    guard.on = false;
    log('leaving the Home button to the TV: Samsung\'s screen stays');
  } else if (cmd === 'pause') {
    var seconds = parseInt(params.seconds, 10) || 180;
    guard.pausedUntil = Date.now() + seconds * 1000;
    log('leaving the screen alone for ' + seconds + ' s');
  } else {
    log('unknown command: ' + cmd);
  }
}

function state() {
  return { on: guard.on, paused: Date.now() < guard.pausedUntil, app: APP, port: PORT, since: guard.since,
           seen: guard.seen, lines: lines };
}

var server = http.createServer(function (req, res) {
  var path = String(req.url || '/').replace(/^\/+/, '').split('?')[0];
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (path === 'state') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(state()));
      return;
    }
    if (path === 'log') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ since: guard.since, lines: lines.slice(-40) }));
      return;
    }
    if (path === 'on' || path === 'off' || path === 'pause') {
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
      server.listen(PORT, '127.0.0.1', function () { log('listening on 127.0.0.1:' + PORT); });
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
