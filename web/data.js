/*
 * What the home screen shows, kept in localStorage so it opens with numbers:
 *  - the picks: what's trending this week and recent releases, only from the streaming apps on this TV (TMDB, with
 *    the person's own free key from config.properties), 3 per hour (up to 6 in Home Settings);
 *  - weather, sunrise and sunset (Open-Meteo, every 30 min) and optional crypto prices (Binance, every 5 min).
 * Settings changed on the TV (Prefs) win over config.properties, as on Android. Built without a city (--generic), the
 * TV's time zone gives the city, and its country the currency and the region (zones.js).
 */
var CONFIG = window.CONFIG || {};

/**
 * Weekday and month names for formatDate on TVs without Intl (strings.js), here where translate.py finds them.
 * "months" is the form next to a day ("28 октября"), as the catalogues' patterns use it.
 */
I18N.dateNames = function (kind) {
  if (kind === 'months') {
    return [tr('monthday|January'), tr('monthday|February'), tr('monthday|March'), tr('monthday|April'),
      tr('monthday|May'), tr('monthday|June'), tr('monthday|July'), tr('monthday|August'), tr('monthday|September'),
      tr('monthday|October'), tr('monthday|November'), tr('monthday|December')];
  }
  if (kind === 'shortMonths') {
    return [tr('month|Jan'), tr('month|Feb'), tr('month|Mar'), tr('month|Apr'), tr('month|May'), tr('month|Jun'),
      tr('month|Jul'), tr('month|Aug'), tr('month|Sep'), tr('month|Oct'), tr('month|Nov'), tr('month|Dec')];
  }
  if (kind === 'weekdays') {
    return [tr('weekday|Sunday'), tr('weekday|Monday'), tr('weekday|Tuesday'), tr('weekday|Wednesday'),
      tr('weekday|Thursday'), tr('weekday|Friday'), tr('weekday|Saturday')];
  }
  return [tr('weekday|Sun'), tr('weekday|Mon'), tr('weekday|Tue'), tr('weekday|Wed'), tr('weekday|Thu'),
    tr('weekday|Fri'), tr('weekday|Sat')];
};

var Place = (function () {
  'use strict';
  var EURO = /^(AT|BE|BG|CY|DE|EE|ES|FI|FR|GR|HR|IE|IT|LT|LU|LV|MT|NL|PT|SI|SK)$/;

  /** A time zone's main city: {country, lat, lon, name}, or null. */
  function zone(name) {
    var all = window.ZONES || {}, v = all[name], hops = 0;
    while (v && v.charAt(0) === '=' && hops++ < 3) { name = v.slice(1); v = all[name]; }
    if (!v) return null;
    var p = v.split(',');
    return {country: p[0], lat: p[1], lon: p[2], name: p[3] || name.slice(name.lastIndexOf('/') + 1).replace(/_/g, ' ')};
  }

  var tz = zone(TV.zone()), set = CONFIG.latitude !== '' && CONFIG.latitude !== undefined;
  var country = (CONFIG.tmdbRegion || (tz ? tz.country : '') || 'US').toUpperCase();
  return {
    lat: set ? CONFIG.latitude : tz ? tz.lat : '40.7128',
    lon: set ? CONFIG.longitude : tz ? tz.lon : '-74.0060',
    city: CONFIG.city || (!set && tz ? tz.name : ''),
    country: country,
    currency: (CONFIG.currency || (country === 'BR' ? 'BRL' : EURO.test(country) ? 'EUR' : 'USD')).toUpperCase(),
    /** Fahrenheit for TVs in the US (by their time zone, or their language when it doesn't tell). */
    fahrenheit: tz ? tz.country === 'US' : /-US$/i.test(navigator.language || '')
  };
})();

var Prefs = (function () {
  'use strict';
  var KEY = 'fmtv.prefs';
  var v = {};
  try { v = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) {}
  function save() { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) {} }
  function pick(name, fallback) { return v[name] === undefined ? fallback : v[name]; }
  return {
    version: 0,
    language: function () { return pick('language', CONFIG.language || 'auto'); },
    temperature: function () { return pick('temperature', CONFIG.temperature || 'auto'); },
    theme: function () { return pick('theme', CONFIG.theme || 'auto'); },
    weather: function () { return pick('weather', true); },
    /** OK on the screensaver opens the title it shows, in its app; any other key only closes it (off by default). */
    saverWatch: function () { return pick('saverWatch', false) === true; },
    /** What the screensaver shows: 'photos' (the picks' photos, as it always has) or 'clock' (a clock and the weather). */
    saver: function () { return pick('saver', 'photos') === 'clock' ? 'clock' : 'photos'; },
    /** Dimming over the picture, for a dark room: 'off', 'low', 'medium', 'high' or 'auto' (medium at night). */
    dim: function () { return pick('dim', 'off'); },
    /** The weather card's forecast: 'hours' (the next 6 hours) or 'days' (the next 5 days). */
    forecast: function () { return pick('forecast', 'hours') === 'days' ? 'days' : 'hours'; },
    quotes: function () { return pick('quotes', CONFIG.showCrypto !== false); },
    coin: function (i) { var c = pick('coins', null); return c ? c[i] !== false : true; },
    /** A title ("movie:123") marked Already seen or Don't like: never recommended again. */
    hidden: function (id) { return pick('seenTitles', []).indexOf(id) >= 0 || pick('dislikedTitles', []).indexOf(id) >= 0; },
    /** Marks a title: 'seen' or 'disliked' (each list keeps its newest 2,000). */
    hide: function (id, why) {
      var name = why === 'seen' ? 'seenTitles' : 'dislikedTitles', list = pick(name, []).filter(function (x) { return x !== id; });
      list.push(id);
      this.set(name, list.slice(-2000));
    },
    hiddenCount: function () { return pick('seenTitles', []).length + pick('dislikedTitles', []).length; },
    unhideAll: function () { this.set('seenTitles', []); this.set('dislikedTitles', []); },
    /** The lowest IMDb score a pick may have (0: any). TMDB's score stands in until a pick's IMDb score is known. */
    minRating: function () { return +pick('minRating', 6) || 0; },
    /** Picks per tab: 3 (as it was) up to 30. */
    cards: function () { var n = pick('cards', 3); return n < 3 ? 3 : n > 30 ? 30 : n; },
    /** Cartoons and anime out of the picks (Home Settings), or config.properties' hide_animation. */
    hideAnimation: function () { return pick('hideAnimation', CONFIG.hideAnimation === true) === true; },
    shelf: function () { return pick('shelf', null); },
    /** DodgyBox (HDMI 2) has been put on a shelf picked on the TV once: taken off again in the Shelf editor, it stays off. */
    dodgyAdded: function () { return pick('dodgyAdded', false) === true; },
    /** Names given to the HDMI inputs on the TV ({hdmi2: 'DodgyBox'}), on the shelf and among the drawer's inputs. */
    inputNames: function () { return pick('inputNames', {hdmi2: 'DodgyBox'}); },
    /** Names an input ('hdmi2'); an empty name gives it back its own ("HDMI 2"). */
    setInputName: function (key, name) {
      var old = this.inputNames(), names = {};
      for (var k in old) if (old.hasOwnProperty(k) && k !== key) names[k] = old[k];
      if (name) names[key] = name;
      this.set('inputNames', names);
    },
    /** The shelf_apps of the build that last set the shelf, so a new one wins once over the TV's choice. */
    shelfConfig: function () { return pick('shelfConfig', ''); },
    /** The weather's city, picked on the TV (Home Settings → City), or config.properties' (or the time zone's). */
    city: function () { return pick('city', Place.city); },
    latitude: function () { return pick('latitude', Place.lat); },
    longitude: function () { return pick('longitude', Place.lon); },
    /** The TMDB key typed on the TV (Home Settings → TMDB key), or config.properties' ('' for none). */
    tmdbKey: function () { return String(pick('tmdbKey', CONFIG.tmdbKey || '')).trim(); },
    /** True when the key in use was typed on the TV (Remove takes it back to config.properties'). */
    tmdbKeyOnTV: function () { return v.tmdbKey !== undefined; },
    /** The MDBList key typed on the TV (Home Settings → MDBList key), for the IMDb and Rotten Tomatoes ratings ('' for none). */
    mdblistKey: function () { return String(pick('mdblistKey', '')).trim(); },
    setCity: function (name, lat, lon) { v.city = name; v.latitude = lat; v.longitude = lon; save(); this.version++; },
    /** Streaming services (keys like "netflix") whose titles are left out of the picks. */
    serviceOff: function (key) { return pick('servicesOff', []).indexOf(key) >= 0; },
    setServiceOff: function (key, off) {
      var list = pick('servicesOff', []).filter(function (k) { return k !== key; });
      if (off) list.push(key);
      this.set('servicesOff', list);
    },
    openPicks: function () { return pick('openPicks', CONFIG.openPicksIn === 'nuvio' ? 'nuvio' : 'apps'); },
    set: function (name, value) { v[name] = value; save(); this.version++; },
    setCoin: function (i, on) {
      var c = (pick('coins', null) || [true, true, true, true]).slice();
      c[i] = on;
      this.set('coins', c);
    }
  };
})();

var Data = (function () {
  'use strict';

  function store(key, value) { try { localStorage.setItem('fmtv.' + key, JSON.stringify(value)); } catch (e) {} }
  function stored(key) { try { return JSON.parse(localStorage.getItem('fmtv.' + key)); } catch (e) { return null; } }

  /** GET a JSON document; done(error, json). */
  function get(url, headers, done) {
    var x = new XMLHttpRequest();
    var over = false;
    x.open('GET', url, true);
    x.timeout = 10000;
    for (var h in headers) if (headers.hasOwnProperty(h)) x.setRequestHeader(h, headers[h]);
    x.onreadystatechange = function () {
      if (x.readyState !== 4 || over) return;
      over = true;
      if (x.status !== 200) { done(new Error(x.status === 401 ? 'TMDB rejected the key' : 'HTTP ' + x.status)); return; }
      var json;
      try { json = JSON.parse(x.responseText); } catch (e) { done(e); return; }
      done(null, json);
    };
    x.ontimeout = x.onerror = function () { if (!over) { over = true; done(new Error('no connection')); } };
    x.send();
  }

  /**
   * Open-Meteo, over plain http where https fails: its certificate chains to Let's Encrypt's ISRG root, which 2015 and
   * 2016 TVs (Tizen 2.3 and 2.4) don't trust. Only the city's coordinates and the forecast go in the clear. Each call
   * tries https first, so a newer TV whose request once timed out doesn't stay on http.
   */
  function getMeteo(path, done) {
    get('https://' + path, {}, function (err, body) {
      // A certificate the TV doesn't trust ends as a network error: status 0, or onerror.
      if (err && /^(no connection|HTTP 0)$/.test(err.message)) {
        get('http://' + path, {}, done);
        return;
      }
      done(err, body);
    });
  }

  var listeners = [];
  function changed() { for (var i = 0; i < listeners.length; i++) listeners[i](); }

  // MARK: - Weather

  function place() { return Prefs.latitude() + ',' + Prefs.longitude(); }
  // Both forecasts in one answer, the next 48 hours and today plus 5 days: Home Settings → Forecast switches without
  // asking again, and offline too.
  var QUERY = '&current=temperature_2m,weather_code,is_day&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset,weather_code'
      + '&hourly=temperature_2m,weather_code,is_day&timezone=auto&forecast_days=6&forecast_hours=48';
  var weather = null, weatherAt = 0, fetchingWeather = false;
  (function () {
    var w = stored('weather');
    // Fetched with another query (an older version): shown, and fetched again now.
    if (w && w.place === place()) { weather = parseWeather(w.body); weatherAt = w.query === QUERY ? w.at : 0; }
  })();

  /** "2026-10-20T18:31" at the location (Open-Meteo's local time) → epoch ms. */
  function localTime(iso, offsetSeconds) {
    var m = /^(\d+)-(\d+)-(\d+)T(\d+):(\d+)/.exec(iso || '');
    if (!m) return 0;
    return Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5]) - offsetSeconds * 1000;
  }

  function parseWeather(o) {
    if (!o || !o.current) return null;
    var off = o.utc_offset_seconds || 0, dl = o.daily, now = Date.now();
    var w = {
      temp: o.current.temperature_2m, code: o.current.weather_code, isDay: o.current.is_day !== 0,
      max: dl.temperature_2m_max[0], min: dl.temperature_2m_min[0],
      sunrise: localTime(dl.sunrise[0], off), sunset: localTime(dl.sunset[0], off), hours: [], days: []
    };
    var hr = o.hourly;
    for (var i = 0; hr && i < hr.time.length && w.hours.length < 6; i++) {
      var at = localTime(hr.time[i], off);
      if (at <= now) continue;
      w.hours.push({at: at, temp: hr.temperature_2m[i], code: hr.weather_code[i], day: !hr.is_day || hr.is_day[i] !== 0});
    }
    // The next 5 days, from tomorrow (none in a forecast cached before the days). Only days that haven't started at
    // the city: today, and past days in a forecast cached offline, are left out.
    for (var j = 0; dl.weather_code && j < dl.time.length && w.days.length < 5; j++) {
      if (localTime(dl.time[j] + 'T12:00', off) - 12 * 3600000 <= now) continue;
      var p = dl.time[j].split('-');   // named by its noon on the TV's clock, right even with the city far away
      w.days.push({at: new Date(+p[0], p[1] - 1, +p[2], 12).getTime(), max: dl.temperature_2m_max[j],
        min: dl.temperature_2m_min[j], code: dl.weather_code[j]});
    }
    return w;
  }

  function refreshWeather() {
    var now = Date.now();
    if (fetchingWeather || (now - weatherAt < 30 * 60000 && now >= weatherAt)) return;
    fetchingWeather = true;
    var at = place();
    getMeteo('api.open-meteo.com/v1/forecast?latitude=' + Prefs.latitude() + '&longitude=' + Prefs.longitude() + QUERY, function (err, body) {
      fetchingWeather = false;
      if (at !== place()) { refreshWeather(); return; }   // another city was picked meanwhile
      if (err) return;
      weather = parseWeather(body);
      weatherAt = Date.now();
      store('weather', {place: at, body: body, at: weatherAt, query: QUERY});
      changed();
    });
  }

  /** Places with this name (Open-Meteo, in the app's language): done(error, [{label, city, lat, lon}]). */
  function findCity(name, done) {
    var lang = I18N.lang.replace(/-.*/, '');   // Open-Meteo takes the language without the country
    getMeteo('geocoding-api.open-meteo.com/v1/search?count=10&format=json&language=' + lang + '&name='
        + encodeURIComponent(name.trim()), function (err, body) {
      if (err) { done(err); return; }
      var results = (body && body.results) || [], out = [], seen = {};
      for (var i = 0; i < results.length; i++) {
        var r = results[i], city = r.name || '';
        if (!city || typeof r.latitude !== 'number' || typeof r.longitude !== 'number') continue;
        var label = city, parts = [r.admin1, r.country];
        for (var j = 0; j < parts.length; j++) if (parts[j] && parts[j] !== city) label += ', ' + parts[j];
        if (seen['#' + label]) continue;   // places with the same name, state and country read the same
        seen['#' + label] = true;
        out.push({label: label, city: city, lat: r.latitude.toFixed(4), lon: r.longitude.toFixed(4)});
      }
      done(null, out);
    });
  }

  // MARK: - Prices

  var COINS = ['BTC', 'ETH', 'SOL', 'USDT'];
  var CURRENCY = Place.currency;
  var QUOTE = CURRENCY === 'USD' ? 'USDT' : CURRENCY;
  /** Binance refuses the whole request when it has no pairs in the currency (INR...): the prices go in dollars then. */
  function inDollars() {
    store('dollarsFor', CURRENCY);
    CURRENCY = 'USD';
    QUOTE = 'USDT';
  }
  /** A pair with no trade for a day: Binance halted it and keeps answering with the frozen last price (AUD since 2026-10-06). */
  function halted(list) {
    for (var i = 0; list && i < list.length; i++) if (list[i].closeTime > 0 && Date.now() - list[i].closeTime > 864e5) return true;
    return false;
  }
  if (stored('dollarsFor') === CURRENCY && CURRENCY !== 'USD') {
    CURRENCY = 'USD';
    QUOTE = 'USDT';
  }
  var prices = [NaN, NaN, NaN, NaN], changes = [NaN, NaN, NaN, NaN], pricesAt = 0, fetchingPrices = false;

  /** Indexes in COINS of the coins that are on (the dollar only in Brazilian reais, where Binance lists it). */
  function activeCoins() {
    var out = [];
    if (!Prefs.quotes()) return out;
    for (var i = 0; i < COINS.length; i++) if (Prefs.coin(i) && (i < 3 || CURRENCY === 'BRL')) out.push(i);
    return out;
  }

  function parsePrices(list) {
    var found = 0;
    for (var i = 0; list && i < list.length; i++) {
      for (var k = 0; k < COINS.length; k++) {
        if (list[i].symbol !== COINS[k] + QUOTE) continue;
        found++;
        var last = parseFloat(list[i].lastPrice), open = parseFloat(list[i].openPrice);
        prices[k] = last;
        changes[k] = open > 0 ? (last - open) / open * 100 : NaN;
      }
    }
    return found;
  }

  (function () {
    var p = stored('prices');
    if (p && p.quote === QUOTE && parsePrices(p.body)) pricesAt = p.at;
  })();

  function refreshPrices() {
    var coins = activeCoins(), now = Date.now();
    if (!coins.length || fetchingPrices || (now - pricesAt < 5 * 60000 && now >= pricesAt)) return;
    fetchingPrices = true;
    var symbols = coins.map(function (i) { return '%22' + COINS[i] + QUOTE + '%22'; }).join(',');
    var path = '/api/v3/ticker/24hr?type=MINI&symbols=%5B' + symbols + '%5D';
    // Binance.com refuses the US (HTTP 451); Binance.US answers the same call in dollars. data-api.binance.vision is
    // Binance's own address for public market data, with Binance.com's pairs on another domain and certificate chain:
    // it answers where a network blocks or intercepts api.binance.com (#375). A refusal skips it.
    var hosts = ['https://api.binance.com', 'https://data-api.binance.vision', 'https://api.binance.us'];
    (function next(h, refused) {
      get(hosts[h] + path, {}, function (err, body) {
        // A pair Binance doesn't list (HTTP 400): the prices go in dollars. Binance.US has only dollar pairs: its 400
        // counts only where Binance.com refuses the US (HTTP 451), not after a timeout or a 5xx there.
        if (err && err.message === 'HTTP 400' && QUOTE !== 'USDT' && (h < 2 || refused)) { fetchingPrices = false; inDollars(); refreshPrices(); return; }
        // Halted: dollars for this run, not saved like the 400's (the market may open again).
        if (!err && QUOTE !== 'USDT' && halted(body)) { fetchingPrices = false; CURRENCY = 'USD'; QUOTE = 'USDT'; refreshPrices(); return; }
        if (err || !parsePrices(body)) {
          var refusal = !!err && err.message === 'HTTP 451';
          if (h + 1 < hosts.length && !(err && err.message === 'HTTP 400')) next(refusal ? 2 : h + 1, refused || refusal);
          else fetchingPrices = false;
          return;
        }
        fetchingPrices = false;
        pricesAt = Date.now();
        store('prices', {quote: QUOTE, body: body, at: pricesAt});
        changed();
      });
    })(0);
  }

  // MARK: - Picks (TMDB)

  var KEY = Prefs.tmdbKey();
  var REGION = Place.country;
  var API = 'https://api.tmdb.org/3';   // TMDB's own mirror of api.themoviedb.org: some ISPs block the other name (#327)

  /** Service name on TMDB (part of it, lowercase) → our key, how to find its app on the TV (id, name), its name. */
  var SERVICES = [
    ['netflix', 'netflix', /^netflix$/, /netflix/i, 'Netflix'],
    ['prime video', 'prime', /^amazon$/, /prime video|amazon/i, 'Prime Video'],
    ['disney', 'disney', /disney/, /disney/i, 'Disney+'],
    ['hulu', 'hulu', /^hulu/, /hulu/i, 'Hulu'],
    ['paramount', 'paramount', /paramount|cbs/, /paramount/i, 'Paramount+'],
    ['peacock', 'peacock', /peacock/, /peacock/i, 'Peacock'],
    ['globoplay', 'globoplay', /globoplay/, /globoplay/i, 'Globoplay'],
    ['max', 'max', /hbo|wbd|\.max/, /^(hbo )?max$|hbo max/i, 'Max'],
    ['apple tv', 'appletv', /appletv|apple\.tv/, /apple tv/i, 'Apple TV'],
    ['hotstar', 'hotstar', /hotstar/, /hotstar/i, 'JioHotstar'],
    ['crunchyroll', 'crunchyroll', /crunchyroll/, /crunchyroll/i, 'Crunchyroll'],
    ['now tv', 'now', /nowtv|now\.tv/, /^now( tv)?$/i, 'NOW']
  ];

  var installed = [];   // the TV's apps, from TV.apps()

  /** A service whose app is on the TV and that the person hasn't switched off in Home Settings (Picks from). */
  function usable(key) { return !!appFor(key) && !Prefs.serviceOff(key); }

  /** The streaming services whose app is on this TV, as {key, name}, for Home Settings. */
  function services() {
    var out = [];
    for (var s = 0; s < SERVICES.length; s++) if (appFor(SERVICES[s][1])) out.push({key: SERVICES[s][1], name: SERVICES[s][4]});
    return out;
  }

  /** The installed app for a service key, or null. */
  function appFor(key) {
    for (var s = 0; s < SERVICES.length; s++) {
      if (SERVICES[s][1] !== key) continue;
      for (var i = 0; i < installed.length; i++) {
        if (SERVICES[s][2].test(installed[i].id) || SERVICES[s][3].test(installed[i].title)) return installed[i];
      }
    }
    return null;
  }

  /** "… Amazon Channel" is sold inside another app; Apple TV is only the streaming service (350; 2 is the store). */
  function service(providerName, providerId) {
    var n = (providerName || '').toLowerCase();
    if (n.indexOf(' channel') >= 0) return null;
    for (var i = 0; i < SERVICES.length; i++) {
      var s = SERVICES[i];
      if (s[1] === 'appletv' && providerId !== 350) continue;
      if (s[0] === 'max' ? /\bmax\b/.test(n) : n.indexOf(s[0]) >= 0) return s;
    }
    return null;
  }

  function tmdb(path, done, key) {
    key = key || KEY;
    var bearer = key.indexOf('eyJ') === 0;   // read access token (v4) or API key (v3)
    var url = API + path + (bearer ? '' : (path.indexOf('?') >= 0 ? '&' : '?') + 'api_key=' + encodeURIComponent(key));
    get(url, bearer ? {Authorization: 'Bearer ' + key, Accept: 'application/json'} : {Accept: 'application/json'}, done);
  }

  /** Asks TMDB whether a key works before it's saved: done(error), with error.rejected when TMDB said no. */
  function checkKey(key, done) {
    tmdb('/configuration', function (err) {
      if (err && /rejected/.test(err.message)) err.rejected = true;
      done(err || null);
    }, key);
  }

  var cache = stored('recs') || {};
  var picks = cache.picks || [], listAt = cache.listAt || 0, period = cache.period, listLang = cache.lang || '', stamp = cache.stamp || '';
  var fetchingRecs = false, failedAt = 0, recsError = '';

  function saveRecs() { store('recs', {picks: picks, listAt: listAt, period: period, lang: listLang, stamp: stamp}); }

  function hourPeriod(d) {
    var h = d.getHours();
    return h >= 5 && h < 12 ? 0 : h >= 12 && h < 18 ? 1 : 2;
  }

  function sourceStamp() {
    var s = KEY.length + ':' + KEY.slice(-6) + ':' + REGION + (Prefs.hideAnimation() ? ':no-animation' : '') + ':min' + Prefs.minRating();
    for (var i = 0; i < SERVICES.length; i++) s += usable(SERVICES[i][1]) ? '1' : '0';
    return s;
  }

  function franchise(title) {
    var t = (title || '').toLowerCase(), cut = t.indexOf(':');
    if (cut < 0) cut = t.indexOf(' - ');
    return (cut > 0 ? t.slice(0, cut) : t).replace(/^\s+|\s+$/g, '');
  }

  /**
   * Worth recommending: not marked Already seen or Don't like, and rated well enough (Prefs.minRating): its IMDb score,
   * or TMDB's until that's known. With neither (a new title, or too few votes), it stays.
   */
  function goodEnough(p) {
    if (Prefs.hidden(keyOf(p))) return false;   // marked Already seen or Don't like
    var min = Prefs.minRating(), shown = /IMDb (\d+(\.\d+)?)/.exec(p.ratings || '');
    // Picks and ratings saved before the filter have only the shown text ("IMDb 5.8 · RT 40%"): the score is in it.
    var score = p.imdbScore || (shown && parseFloat(shown[1])) || p.tmdbScore;
    return !min || !score || score >= min;
  }

  /** This hour's picks (Prefs.cards()): movies ("movie"), shows ("tv") or both (null). */
  function now(kind) {
    var list = [];
    if (!KEY) return list;
    for (var i = 0; i < picks.length; i++) {
      var p = picks[i];
      if ((kind === null || kind === p.kind) && (!p.detailed || (p.app && usable(p.app))) && goodEnough(p)) list.push(p);
    }
    if (!list.length) return list;
    var hour = Math.floor(Date.now() / 3600000), out = [], seen = {}, n = Prefs.cards();
    for (var j = 0; j < list.length && out.length < n; j++) {
      var q = list[(hour * n + j) % list.length], f = franchise(q.title);
      if (!seen[f]) { seen[f] = true; out.push(q); }
    }
    return out;
  }

  /** TMDB's language, as on Android: Latin American Spanish unless the TV is in Spain, and Germany's German. */
  function lang() {
    if (I18N.lang === 'es') return /-ES\b/i.test(navigator.language || '') ? 'es-ES' : 'es-MX';
    if (I18N.lang === 'de') return 'de-DE';   // TMDB's de-AT and de-CH have few translations of their own
    return I18N.locale();
  }

  function day(offset) {
    var d = new Date(Date.now() + offset * 86400000);
    function two(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate());
  }

  /** TMDB's genres that it leaves in English in some languages. */
  function genre(name) {
    switch (name) {
      case 'Action & Adventure': return tr('genre|Action & Adventure');
      case 'Sci-Fi & Fantasy': return tr('genre|Sci-Fi & Fantasy');
      case 'War & Politics': return tr('genre|War & Politics');
      case 'Kids': return tr('genre|Kids');
      case 'News': return tr('genre|News');
      case 'Soap': return tr('genre|Soap');
      case 'Talk': return tr('genre|Talk');
      default: return name;
    }
  }

  /** The best backdrop: no text over it, the largest, then the best rated. */
  function bestBackdrop(images) {
    var list = images && images.backdrops, best = null, score = -1;
    for (var i = 0; list && i < list.length; i++) {
      var b = list[i];
      if (!b.file_path) continue;
      var s = (b.iso_639_1 === null ? 1e7 : 0) + Math.min(b.width || 0, 3840) * 100 + (b.vote_average || 0);
      if (s > score) { score = s; best = b.file_path; }
    }
    return best;
  }

  // MARK: - Ratings (IMDb's and Rotten Tomatoes' scores, with an MDBList key typed on the TV)

  var MDBLIST = 'https://api.mdblist.com';
  var RATED_FOR = 3 * 86400000;   // scores change slowly, and the free key has 1,000 requests a day
  var ratings = stored('ratings') || {};   // "movie:123" -> {text, at}

  /** Asks MDBList whether a key works before it's saved: done(error), with error.rejected when MDBList said no. */
  function checkMdblistKey(key, done) {
    get(MDBLIST + '/tmdb/movie/278?apikey=' + encodeURIComponent(key), {}, function (err) {
      if (err && /401|403|rejected/i.test(err.message)) err.rejected = true;
      done(err || null);
    });
  }

  /**
   * MDBList's scores for a pick, looked up by its TMDB id: done({imdb: '7.8', rt: '92%'}), with what it has, or null.
   * Its "tomatoes" is Rotten Tomatoes' critics (the Tomatometer), kept apart from the audience's ("popcorn").
   */
  function mdblistScores(p, key, done) {
    var url = MDBLIST + '/tmdb/' + (p.kind === 'tv' ? 'show' : 'movie') + '/' + p.id + '?apikey=' + encodeURIComponent(key);
    get(url, {}, function (err, o) {
      if (err || !o || !o.ratings) { done(null); return; }
      var out = {};
      for (var i = 0; i < o.ratings.length; i++) {
        var r = o.ratings[i], v = r && r.value;
        if (v === null || v === undefined || v === '' || v === 0) continue;
        if (r.source === 'imdb') out.imdb = typeof v === 'number' ? v.toFixed(1) : String(v);
        else if (r.source === 'tomatoes') out.rt = Math.round(Number(v)) + '%';
      }
      done(out);
    });
  }

  /** "IMDb 7.8 · RT 92%" for a pick, when there's an MDBList key; '' when MDBList has none (or didn't answer). */
  function rate(p, done) {
    var key = Prefs.mdblistKey(), t = Date.now(), id = keyOf(p);
    if (!key) { done(); return; }
    var known = ratings[id];
    if (known && t - known.at < RATED_FOR && t >= known.at) {
      var was = /IMDb (\d+(\.\d+)?)/.exec(known.text || '');   // saved before the filter: only the text has the score
      p.ratings = known.text;
      p.imdbScore = known.imdb || (was && parseFloat(was[1])) || 0;
      done();
      return;
    }
    mdblistScores(p, key, function (s) {
      // Nothing found: nothing this time, and no asking again until the list is made again (never in a loop).
      var parts = [];
      if (s && s.imdb) parts.push('IMDb ' + s.imdb);
      if (s && s.rt) parts.push('RT ' + s.rt);
      p.ratings = parts.join('  ·  ');
      p.imdbScore = (s && parseFloat(s.imdb)) || 0;   // for Prefs.minRating
      for (var k in ratings) if (ratings.hasOwnProperty(k) && !(t - ratings[k].at < RATED_FOR)) delete ratings[k];
      ratings[id] = {text: p.ratings, imdb: p.imdbScore, at: t};
      store('ratings', ratings);
      done();
    });
  }

  /** A pick still to fill in: its details, or its ratings once there's an MDBList key. */
  function unfinished(p) { return !p.detailed || (!!Prefs.mdblistKey() && p.ratings === undefined); }

  /** Genre, runtime or seasons, the service it's on among the TV's apps, and its ratings. */
  function details(p, done) {
    tmdb('/' + p.kind + '/' + p.id + '?language=' + lang() + '&append_to_response=watch/providers,images&include_image_language=null,'
        + I18N.base + ',en', function (err, o) {
      if (err) { done(err); return; }
      var best = bestBackdrop(o.images);
      if (best) p.backdrop = best;
      if (o.poster_path) p.poster = o.poster_path;
      var parts = [];
      if (p.kind === 'tv') parts.push(tr('Series'));
      if (o.genres && o.genres.length) {
        parts.push(genre(o.genres[0].name));
      }
      if (p.kind === 'movie' && o.runtime > 0) {
        var h = Math.floor(o.runtime / 60), m = o.runtime % 60;
        parts.push(h ? trf('{h}h {m}m', {h: h, m: m}) : trf('{m}m', {m: m}));
      } else if (p.kind === 'tv' && o.number_of_seasons > 0) {
        parts.push(plural('plural|one:{n} season|other:{n} seasons', o.number_of_seasons));
      }
      var wp = o['watch/providers'], here = wp && wp.results && wp.results[REGION], flat = here && here.flatrate;
      p.app = null;
      for (var i = 0; flat && i < flat.length && !p.app; i++) {
        var s = service(flat[i].provider_name, flat[i].provider_id);
        if (s && usable(s[1])) { p.app = s[1]; p.service = s[4]; }
      }
      if (p.service && p.app) parts.push(p.service);
      p.meta = parts.join(' · ');
      if (o.vote_count >= 20) p.tmdbScore = o.vote_average;   // as addPick: for Prefs.minRating until IMDb's is known
      title(p, o, function () {
        rate(p, function () {
          p.detailed = true;
          done(null);
        });
      });
    });
  }

  /**
   * Without a title in the TV's language TMDB answers with the original one, so a Korean series on a German TV reads
   * "닥터X: 하얀 마피아의 시대". Then the English title, when TMDB has one (one more request, only for those).
   */
  function title(p, o, done) {
    var field = p.kind === 'movie' ? 'title' : 'name', own = o[field] || p.title;
    p.title = own;
    if (I18N.lang === 'en' || !own || own !== o['original_' + field] || o.original_language === I18N.base
        || o.original_language === 'en') { done(); return; }
    tmdb('/' + p.kind + '/' + p.id + '?language=en-US', function (err, en) {
      if (!err && en && en[field]) p.title = en[field];
      done();
    });
  }

  /** TMDB's Animation genre (movies and shows: cartoons and anime), left out with Cartoons and anime off. */
  var ANIMATION = 16;

  function animated(o) {
    for (var i = 0; o.genre_ids && i < o.genre_ids.length; i++) if (o.genre_ids[i] === ANIMATION) return true;
    return false;
  }

  function addPick(list, o, kind) {
    if (!o.backdrop_path) return;
    if (Prefs.hideAnimation() && animated(o)) return;
    list.push({id: o.id, kind: kind, title: kind === 'movie' ? o.title : o.name, backdrop: o.backdrop_path, poster: o.poster_path || '', meta: '', app: null, detailed: false,
      tmdbScore: o.vote_count >= 20 ? o.vote_average : 0});   // a handful of votes says little
  }

  function keyOf(p) { return p.kind + ':' + p.id; }

  function alternate(out, seen, a, b, max) {
    for (var i = 0; i < Math.max(a.length, b.length) && out.length < max; i++) {
      if (i < a.length && !seen[keyOf(a[i])]) { seen[keyOf(a[i])] = true; out.push(a[i]); }
      if (i < b.length && out.length < max && !seen[keyOf(b[i])]) { seen[keyOf(b[i])] = true; out.push(b[i]); }
    }
  }

  /** Runs fn on each item one after the other (the TV's network is shared with what's playing). */
  function each(items, fn, done) {
    var i = 0;
    (function next() {
      if (i >= items.length) { done(); return; }
      fn(items[i++], next);
    })();
  }

  /** TMDB's first `count` pages of a list (20 titles each), one after the other; a failed page adds none. */
  function pages(path, count, add, done) {
    var numbers = [];
    for (var n = 1; n <= count; n++) numbers.push(n);
    each(numbers, function (page, next) {
      tmdb(path + '&page=' + page, function (e, r) {
        if (!e && r && r.results) add(r.results);
        next();
      });
    }, done);
  }

  var catalogueQuery = '', catalogueStamp = '';

  /**
   * What every TMDB discover request here shares: the TV's streaming apps in its region (TMDB's ids for them), the most
   * popular first. done(error, query); kept until the apps, the key or the settings change (sourceStamp).
   */
  function catalogue(done) {
    var st = sourceStamp();
    if (catalogueQuery && catalogueStamp === st) { done(null, catalogueQuery); return; }
    tmdb('/watch/providers/movie?language=' + lang() + '&watch_region=' + REGION, function (err, res) {
      if (err) { done(err); return; }
      var ids = [];
      for (var i = 0; res.results && i < res.results.length; i++) {
        var s = service(res.results[i].provider_name, res.results[i].provider_id);
        if (s && usable(s[1])) ids.push(res.results[i].provider_id);
      }
      if (!ids.length) { done(new Error("none of the TV's streaming apps are on TMDB (or switched on in Picks from)")); return; }
      catalogueQuery = '&language=' + lang() + '&watch_region=' + REGION + '&with_watch_monetization_types=flatrate&include_adult=false'
          + '&sort_by=popularity.desc&with_watch_providers=' + encodeURIComponent(ids.join('|'))
          + (Prefs.hideAnimation() ? '&without_genres=' + ANIMATION : '');
      catalogueStamp = st;
      done(null, catalogueQuery);
    });
  }

  /**
   * The discover request for a kind: with a lowest rating (Prefs.minRating), titles from any year rated at least half a
   * point under it on TMDB (IMDb often rates a little higher, and IMDb's own score decides once it's known: goodEnough).
   * Without one, recent releases for the picks (`recent`), or any year for See more.
   */
  function discover(kind, recent) {
    var min = Prefs.minRating();
    if (min) {
      var rated = '&vote_average.gte=' + Math.max(0, min - 0.5) + '&vote_count.gte=150';
      return kind === 'movie' ? '/discover/movie?include_video=false' + rated : '/discover/tv?include_null_first_air_dates=false' + rated;
    }
    if (!recent) return kind === 'movie' ? '/discover/movie?vote_count.gte=50' : '/discover/tv?vote_count.gte=50';
    return kind === 'movie' ? '/discover/movie?vote_count.gte=30&primary_release_date.gte=' + day(-365) + '&primary_release_date.lte=' + day(0)
      : '/discover/tv?vote_count.gte=20&air_date.gte=' + day(-90) + '&air_date.lte=' + day(0);
  }

  function fetchList(done) {
    catalogue(function (err, common) {
      if (err) { done(err); return; }
      var hot = {movie: [], tv: []}, fresh = {movie: [], tv: []};
      each(['movie', 'tv'], function (kind, next) {
        var candidates = [];
        pages('/trending/' + kind + '/week?language=' + lang(), 2, function (results) {
          for (var j = 0; j < results.length; j++) addPick(candidates, results[j], kind);
        }, function () {
          // Trending is only kept when it's on one of the TV's apps: the details say where.
          each(candidates, function (p, n) {
            details(p, function (de) { if (!de && p.app) hot[kind].push(p); n(); });
          }, next);
        });
      }, function () {
        // 2 pages each (40 titles: enough for 30 picks a tab); 3 with a rating, some of which IMDb's score then leaves out.
        var deep = Prefs.minRating() ? 3 : 2;
        pages(discover('movie', true) + common, deep, function (results) {
          for (var j = 0; j < results.length; j++) addPick(fresh.movie, results[j], 'movie');
        }, function () {
          pages(discover('tv', true) + common, deep, function (results) {
            for (var k = 0; k < results.length; k++) addPick(fresh.tv, results[k], 'tv');
          }, function () {
            // Trending titles under the rating would only be dropped on screen: they leave room for rated ones.
            hot.movie = hot.movie.filter(goodEnough);
            hot.tv = hot.tv.filter(goodEnough);
            var list = [], seen = {};
            // Up to 30 picks a tab (Prefs.cards), and the Movies and Shows tabs each draw on half of the list.
            alternate(list, seen, hot.movie, hot.tv, 120);
            alternate(list, seen, fresh.movie, fresh.tv, 120);
            if (!list.length) { done(new Error('TMDB returned no recommendations')); return; }
            picks = list;
            done(null);
          });
        });
      });
    });
  }

  // MARK: - See more: the same titles past what the tabs show, a page at a time

  var BROWSE_PAGE = 12;   // 6 across, 2 rows of large posters

  /**
   * A See more session for a tab's kind ('movie', 'tv', or null for both, alternating). TMDB's pages come only as the
   * person reaches them, so nothing waits for a page nobody turns to.
   */
  function browse(kind) {
    var feeds = (kind ? [kind] : ['movie', 'tv']).map(function (k) { return {kind: k, got: [], next: 1, last: 1, total: 0}; });
    var list = [];

    function rebuild() {
      list = [];
      alternate(list, {}, feeds[0].got.filter(goodEnough), feeds[1] ? feeds[1].got.filter(goodEnough) : [], 100000);
    }

    /** One more TMDB page, from the kind that has fewer: done(true) when it brought any. */
    function more(done) {
      var f = null;
      for (var i = 0; i < feeds.length; i++) if (feeds[i].next <= feeds[i].last && (!f || feeds[i].got.length < f.got.length)) f = feeds[i];
      if (!f) { done(false); return; }
      catalogue(function (err, common) {
        if (err) { done(false); return; }
        tmdb(discover(f.kind, false) + common + '&page=' + f.next, function (e, r) {
          f.next++;
          if (e || !r || !r.results) { f.last = 0; done(false); return; }   // this kind has no more for now
          f.last = Math.min(r.total_pages || 1, 500);   // TMDB serves 500 pages at most
          f.total = r.total_results || 0;
          for (var j = 0; j < r.results.length; j++) addPick(f.got, r.results[j], f.kind);
          rebuild();
          done(true);
        });
      });
    }

    function count() {
      var t = 0;
      for (var i = 0; i < feeds.length; i++) t += feeds[i].total;
      return Math.max(1, Math.ceil(t / BROWSE_PAGE));
    }

    return {
      /** Page n (from 0): done(titles, pages), fetching what it lacks first. pages is TMDB's estimate. */
      page: function (n, done) {
        rebuild();   // a title marked Already seen or Don't like since leaves
        (function fill() {
          if (list.length >= (n + 1) * BROWSE_PAGE) { done(list.slice(n * BROWSE_PAGE, (n + 1) * BROWSE_PAGE), count()); return; }
          more(function (got) {
            if (got) fill();
            else done(list.slice(n * BROWSE_PAGE, (n + 1) * BROWSE_PAGE), Math.max(1, Math.ceil(list.length / BROWSE_PAGE)));
          });
        })();
      },
      /** The ratings of a page's titles, one after the other: each() after each; a title under the rating then leaves. */
      rate: function (titles, each, done) {
        var i = 0;
        (function next() {
          if (i >= titles.length) { rebuild(); done(); return; }
          var p = titles[i++];
          if (!Prefs.mdblistKey() || p.ratings !== undefined) { next(); return; }
          rate(p, function () { each(p); next(); });
        })();
      }
    };
  }

  /** Fetches the list when stale (6 h, a new period of the day, language, key or apps), then this hour's details. */
  function refreshRecs() {
    if (!KEY || fetchingRecs || !installed.length) return;
    var t = Date.now(), p = hourPeriod(new Date()), st = sourceStamp();
    if (st === stamp && failedAt && t - failedAt < 10 * 60000 && t >= failedAt) return;
    var stale = st !== stamp || p !== period || t - listAt > 6 * 3600000 || t < listAt || !picks.length || listLang !== I18N.lang;
    var wanted = all(), missing = false;
    for (var i = 0; i < wanted.length; i++) missing = missing || unfinished(wanted[i]);
    if (!stale && !missing) return;
    fetchingRecs = true;
    stamp = st;
    function finish(err) {
      fetchingRecs = false;
      if (err) { recsError = err.message; failedAt = Date.now(); } else { recsError = ''; failedAt = 0; }
      saveRecs();
      changed();
    }
    function detailWanted() {
      var todo = all().filter(unfinished);
      each(todo, function (x, next) { details(x, function () { next(); }); }, function () { finish(null); });
    }
    if (stale) {
      fetchList(function (err) {
        if (err) { finish(err); return; }
        listAt = Date.now();
        period = p;
        listLang = I18N.lang;
        detailWanted();
      });
    } else {
      detailWanted();
    }
  }

  /** This hour's picks for the three tabs, without repeats (the screensaver shows them too). */
  function all() {
    var out = [], seen = {}, kinds = [null, 'movie', 'tv'];
    for (var k = 0; k < kinds.length; k++) {
      var list = now(kinds[k]);
      for (var i = 0; i < list.length; i++) if (!seen[keyOf(list[i])]) { seen[keyOf(list[i])] = true; out.push(list[i]); }
    }
    return out;
  }

  // MARK: - Formatting

  function fmt(v, digits) {
    // Old WebKit (Tizen 2) has no Intl: toLocaleString ignores its options and prints every digit, without failing.
    // English separators there; a per-language table if someone asks.
    if (typeof Intl === 'undefined') return v.toFixed(digits).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    try { return v.toLocaleString(I18N.locale(), {minimumFractionDigits: digits, maximumFractionDigits: digits}); } catch (e) { return v.toFixed(digits); }
  }

  var SYMBOLS = {USD: '$', BRL: 'R$ ', EUR: '€', GBP: '£', JPY: '¥'};

  return {
    COINS: COINS,
    get city() { return Prefs.city(); },
    currency: CURRENCY,
    onChange: function (fn) { listeners.push(fn); },
    setApps: function (apps) { installed = apps; },
    appFor: appFor,
    usable: usable,
    services: services,
    refresh: function () { refreshWeather(); refreshPrices(); refreshRecs(); },
    settingsChanged: function () { pricesAt = 0; refreshPrices(); changed(); },
    findCity: findCity,
    /** Another city picked: its weather now (none shown until it comes). */
    cityChanged: function () { weather = null; weatherAt = 0; refreshWeather(); changed(); },
    get weather() { return weather; },
    get weatherAt() { return weatherAt; },
    prices: prices,
    changes: changes,
    get pricesAt() { return pricesAt; },
    activeCoins: activeCoins,
    hasKey: function () { return !!KEY; },
    checkKey: checkKey,
    /** A key typed (or removed) on the TV: the picks come again with it, or go. */
    keyChanged: function () { KEY = Prefs.tmdbKey(); recsError = ''; failedAt = 0; refreshRecs(); changed(); },
    checkMdblistKey: checkMdblistKey,
    /** An MDBList key typed (or removed) on the TV: the ratings come again with it, or go. */
    ratingsKeyChanged: function () {
      ratings = {};
      store('ratings', ratings);
      for (var i = 0; i < picks.length; i++) delete picks[i].ratings;
      saveRecs();
      refreshRecs();
      changed();
    },
    recsError: function () { return recsError; },
    picks: now,
    showcase: all,
    browse: browse,
    BROWSE_PAGE: BROWSE_PAGE,
    /** A title marked Already seen ('seen') or Don't like ('disliked'): it leaves the picks now, and never comes back. */
    hide: function (p, why) { Prefs.hide(keyOf(p), why); changed(); },
    /** Every marked title back (Home Settings, Hidden titles). */
    unhideAll: function () { Prefs.unhideAll(); changed(); },
    goodEnough: goodEnough,
    /** A See more title's details (which of the TV's apps has it), before it opens: done(error). */
    details: details,
    image: function (path, size) { return path ? 'https://image.tmdb.org/t/p/' + (size || 'w1280') + path : ''; },

    /** Night at the location: from sunset to sunrise (the last forecast; without one, 6:00 and 18:00). */
    isNight: function (at) {
      var theme = Prefs.theme();
      if (theme === 'dark') return true;
      if (theme === 'light') return false;
      var d = new Date(at), mins = d.getHours() * 60 + d.getMinutes();
      function hm(t, fallback) { if (!t) return fallback; var x = new Date(t); return x.getHours() * 60 + x.getMinutes(); }
      var rise = hm(weather && weather.sunrise, 360), set = hm(weather && weather.sunset, 1080);
      return mins < rise || mins >= set;
    },

    compact: function (v) {
      if (isNaN(v)) return '—';
      if (v >= 1000000) return fmt(v / 1000000, 2) + 'M';
      if (v >= 10000) return fmt(v / 1000, 1) + 'k';
      if (v >= 1000) return fmt(v / 1000, 2) + 'k';
      if (v >= 100) return fmt(v, 0);
      return fmt(v, 2);
    },
    money: function (v) {
      var s = SYMBOLS[CURRENCY] || CURRENCY + ' ';
      if (isNaN(v)) return s + '—';
      return s + (v >= 1000 ? fmt(v, 0) : fmt(v, 2));
    },
    change: function (v) { return isNaN(v) ? '' : (v >= 0 ? '+' : '−') + fmt(Math.abs(v), 1) + '%'; },
    degrees: function (v) {
      if (v === undefined || v === null || isNaN(v)) return '—';
      var unit = Prefs.temperature();
      var f = unit === 'F' || (unit === 'auto' && Place.fahrenheit);
      return Math.round(f ? v * 9 / 5 + 32 : v) + '°';
    },
    /** "3 PM", "15:00", "15 Uhr": the hourly forecast. */
    hour: function (at) { return formatDate('format|h a', at); },
    /** "Seg", "Mon", "Lun", "Mo", "Пн": the short day of the week, capitalized and without the abbreviation's dot. */
    weekday: function (at) {
      var s = formatDate('format|EEE', at).replace(/\.$/, '');
      return s.charAt(0).toUpperCase() + s.substring(1);
    },
    /** "5:21 AM", "05:21": the clock, sunrise and sunset. */
    time: function (at) { return formatDate('format|h:mm a', at); },
    /** "12 min ago" when the data is old (no internet), or empty. */
    staleness: function (at, every) {
      if (!at) return '';
      var age = Date.now() - at;
      if (age < every * 2) return '';
      var m = Math.floor(age / 60000), h = Math.floor(m / 60);
      return m < 60 ? trf('{n} min ago', {n: m}) : trf('{n} h ago', {n: h});
    },
    condition: function (code, day) {
      if (code === undefined || code === null || code < 0) return '';
      if (code === 0) return day ? tr('Clear') : tr('night|Clear');
      if (code === 1) return day ? tr('Mostly Sunny') : tr('Mostly Clear');
      if (code === 2) return tr('Partly Cloudy');
      if (code === 3) return tr('Cloudy');
      if (code === 45 || code === 48) return tr('Fog');
      if (code >= 51 && code <= 57) return tr('Drizzle');
      if (code === 65 || code === 67 || code === 82) return tr('Heavy Rain');
      if ((code >= 71 && code <= 77) || code === 85 || code === 86) return tr('Snow');
      if (code >= 95) return tr('Thunderstorms');
      return tr('Rain');
    },
    symbol: function (code, day) {
      if (code <= 1) return day ? 'sunny' : 'clear_night';
      if (code === 2) return day ? 'partly_cloudy_day' : 'partly_cloudy_night';
      if (code === 3) return 'cloud';
      if (code === 45 || code === 48) return 'foggy';
      if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snowflake';
      if (code >= 95) return 'thunderstorm';
      return 'rainy';
    },
    coinName: function (i) { return i === 3 ? tr('Dollar') : ['Bitcoin', 'Ethereum', 'Solana'][i]; }
  };
})();
