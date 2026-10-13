/* Audio: decode, inspect, draw, and listen for structure.
 *
 * Everything runs in the browser. The car needs 44.1 kHz audio, so decoding is
 * done at 44.1 kHz and the exporter can write a matching .wav.
 */
(function (root) {
  'use strict';

  var FFT_N = 1024;
  var HOP = 256;          // at 22.05 kHz this gives ~86 frames per second
  var ANALYSIS_RATE = 22050;
  // A flux frame is detected slightly before the transient it belongs to.
  var FRAME_LAG = 0.025;

  /* ---------- format sniffing ---------- */

  var MPEG_RATES = {
    3: [44100, 48000, 32000],   // MPEG-1
    2: [22050, 24000, 16000],   // MPEG-2
    0: [11025, 12000, 8000]     // MPEG-2.5
  };

  function sniff(buffer, filename) {
    var b = new Uint8Array(buffer);
    var ext = (filename.split('.').pop() || '').toLowerCase();
    var info = { ext: ext, container: ext, sampleRate: null, teslaReady: false };

    // RIFF/WAVE
    if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46) {
      var dv = new DataView(buffer);
      var p = 12;
      while (p + 8 < b.length) {
        var id = String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3]);
        var size = dv.getUint32(p + 4, true);
        if (id === 'fmt ') { info.sampleRate = dv.getUint32(p + 12, true); break; }
        p += 8 + size + (size & 1);
      }
      info.container = 'wav';
      info.teslaReady = info.sampleRate === 44100;
      return info;
    }

    // MP3: skip an ID3 tag, then find the first frame header.
    var start = 0;
    if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) {
      start = 10 + ((b[6] & 0x7f) << 21 | (b[7] & 0x7f) << 14 | (b[8] & 0x7f) << 7 | (b[9] & 0x7f));
    }
    for (var i = start; i < Math.min(b.length - 4, start + 200000); i++) {
      if (b[i] === 0xff && (b[i + 1] & 0xe0) === 0xe0) {
        var ver = (b[i + 1] >> 3) & 0x03;
        var rateIdx = (b[i + 2] >> 2) & 0x03;
        var table = MPEG_RATES[ver];
        if (table && rateIdx < 3) {
          info.container = 'mp3';
          info.sampleRate = table[rateIdx];
          info.teslaReady = info.sampleRate === 44100;
          return info;
        }
      }
    }
    return info;
  }

  /* ---------- decoding ---------- */

  var ctx = null;
  function audioContext() {
    if (ctx) return ctx;
    var AC = window.AudioContext || window.webkitAudioContext;
    try { ctx = new AC({ sampleRate: 44100 }); }
    catch (e) { ctx = new AC(); }
    return ctx;
  }

  function decode(arrayBuffer) {
    var ac = audioContext();
    return new Promise(function (resolve, reject) {
      var copy = arrayBuffer.slice(0);
      var p = ac.decodeAudioData(copy, resolve, reject);
      if (p && p.then) p.then(resolve, reject);
    });
  }

  /* ---------- 16 bit wav writer ---------- */

  function toWav(buffer) {
    var chans = Math.min(2, buffer.numberOfChannels);
    var len = buffer.length;
    var rate = buffer.sampleRate;
    var bytes = 44 + len * chans * 2;
    var out = new Uint8Array(bytes);
    var dv = new DataView(out.buffer);
    function tag(off, s) { for (var i = 0; i < s.length; i++) out[off + i] = s.charCodeAt(i); }
    tag(0, 'RIFF'); dv.setUint32(4, bytes - 8, true); tag(8, 'WAVE');
    tag(12, 'fmt '); dv.setUint32(16, 16, true);
    dv.setUint16(20, 1, true); dv.setUint16(22, chans, true);
    dv.setUint32(24, rate, true); dv.setUint32(28, rate * chans * 2, true);
    dv.setUint16(32, chans * 2, true); dv.setUint16(34, 16, true);
    tag(36, 'data'); dv.setUint32(40, len * chans * 2, true);

    var data = [];
    for (var c = 0; c < chans; c++) data.push(buffer.getChannelData(c));
    var p = 44;
    for (var i = 0; i < len; i++) {
      for (var c2 = 0; c2 < chans; c2++) {
        var s = Math.max(-1, Math.min(1, data[c2][i]));
        dv.setInt16(p, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        p += 2;
      }
    }
    return out;
  }

  /* ---------- fft ---------- */

  function FFT(n) {
    this.n = n;
    this.rev = new Uint32Array(n);
    var bits = Math.log2(n) | 0;
    for (var i = 0; i < n; i++) {
      var r = 0;
      for (var j = 0; j < bits; j++) if (i & (1 << j)) r |= 1 << (bits - 1 - j);
      this.rev[i] = r;
    }
    this.cos = new Float32Array(n / 2);
    this.sin = new Float32Array(n / 2);
    for (var k = 0; k < n / 2; k++) {
      this.cos[k] = Math.cos(-2 * Math.PI * k / n);
      this.sin[k] = Math.sin(-2 * Math.PI * k / n);
    }
    this.re = new Float32Array(n);
    this.im = new Float32Array(n);
  }

  FFT.prototype.magnitude = function (input, window, out) {
    var n = this.n, re = this.re, im = this.im;
    for (var i = 0; i < n; i++) {
      var j = this.rev[i];
      re[j] = input[i] * window[i];
      im[j] = 0;
    }
    for (var size = 2; size <= n; size <<= 1) {
      var half = size >> 1, step = n / size;
      for (var i2 = 0; i2 < n; i2 += size) {
        for (var k = 0; k < half; k++) {
          var tw = k * step;
          var c = this.cos[tw], s = this.sin[tw];
          var a = i2 + k, b = a + half;
          var tre = re[b] * c - im[b] * s;
          var tim = re[b] * s + im[b] * c;
          re[b] = re[a] - tre; im[b] = im[a] - tim;
          re[a] += tre; im[a] += tim;
        }
      }
    }
    var half2 = n >> 1;
    for (var q = 0; q < half2; q++) out[q] = Math.sqrt(re[q] * re[q] + im[q] * im[q]);
    return out;
  };

  /* ---------- helpers ---------- */

  function idle() {
    return new Promise(function (r) { setTimeout(r, 0); });
  }

  function mixMono(buffer) {
    var len = buffer.length;
    var out = new Float32Array(len);
    var n = buffer.numberOfChannels;
    for (var c = 0; c < n; c++) {
      var d = buffer.getChannelData(c);
      for (var i = 0; i < len; i++) out[i] += d[i];
    }
    if (n > 1) for (var j = 0; j < len; j++) out[j] /= n;
    return out;
  }

  function downsample(mono, from, to) {
    var ratio = from / to;
    var len = Math.floor(mono.length / ratio);
    var out = new Float32Array(len);
    for (var i = 0; i < len; i++) {
      var a = i * ratio, i0 = a | 0, i1 = Math.min(mono.length - 1, i0 + 1);
      var f = a - i0;
      out[i] = mono[i0] * (1 - f) + mono[i1] * f;
    }
    return out;
  }

  function peaks(mono, rate, bucketS) {
    var per = Math.max(1, Math.round(rate * bucketS));
    var count = Math.ceil(mono.length / per);
    var mn = new Float32Array(count), mx = new Float32Array(count);
    for (var i = 0; i < count; i++) {
      var lo = 1, hi = -1;
      var end = Math.min(mono.length, (i + 1) * per);
      for (var j = i * per; j < end; j++) {
        var v = mono[j];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      mn[i] = lo; mx[i] = hi;
    }
    return { min: mn, max: mx, bucketS: bucketS };
  }

  function smooth(arr, radius) {
    var out = new Float32Array(arr.length);
    var sum = 0, n = 0;
    for (var i = 0; i < arr.length; i++) {
      sum += arr[i]; n++;
      if (i >= radius * 2 + 1) { sum -= arr[i - radius * 2 - 1]; n--; }
      out[Math.max(0, i - radius)] = sum / n;
    }
    return out;
  }

  function percentile(sorted, p) {
    if (!sorted.length) return 0;
    var i = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
    return sorted[i];
  }

  /* ---------- the analysis ---------- */

  async function analyse(buffer, onProgress) {
    var report = onProgress || function () {};
    report(0.02, 'Reading the waveform');
    var mono = mixMono(buffer);
    var wave = peaks(mono, buffer.sampleRate, 0.005);
    await idle();

    report(0.1, 'Resampling for analysis');
    var sig = downsample(mono, buffer.sampleRate, ANALYSIS_RATE);
    var fps = ANALYSIS_RATE / HOP;
    var frameCount = Math.max(1, Math.floor((sig.length - FFT_N) / HOP));
    var fft = new FFT(FFT_N);
    var win = new Float32Array(FFT_N);
    for (var i = 0; i < FFT_N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (FFT_N - 1));

    var bins = FFT_N / 2;
    var binHz = ANALYSIS_RATE / FFT_N;
    function binOf(hz) { return Math.max(1, Math.min(bins - 1, Math.round(hz / binHz))); }
    var BANDS = [
      { name: 'bass', a: binOf(30), b: binOf(160) },
      { name: 'lowmid', a: binOf(160), b: binOf(500) },
      { name: 'mid', a: binOf(500), b: binOf(2000) },
      { name: 'high', a: binOf(2000), b: binOf(6000) },
      { name: 'air', a: binOf(6000), b: bins - 1 }
    ];

    var env = new Float32Array(frameCount);
    var bassEnv = new Float32Array(frameCount);
    var highEnv = new Float32Array(frameCount);
    var rms = new Float32Array(frameCount);
    var bandEnergy = BANDS.map(function () { return new Float32Array(frameCount); });

    var mag = new Float32Array(bins), prev = new Float32Array(bins);
    var frame = new Float32Array(FFT_N);
    var t0 = performance.now();

    for (var f = 0; f < frameCount; f++) {
      var off = f * HOP;
      for (var k = 0; k < FFT_N; k++) frame[k] = sig[off + k];
      fft.magnitude(frame, win, mag);

      var flux = 0, bassFlux = 0, highFlux = 0, power = 0;
      for (var q = 1; q < bins; q++) {
        var d = mag[q] - prev[q];
        if (d > 0) {
          flux += d;
          if (q <= BANDS[0].b) bassFlux += d;
          if (q >= BANDS[3].a) highFlux += d;
        }
        power += mag[q] * mag[q];
        prev[q] = mag[q];
      }
      env[f] = flux; bassEnv[f] = bassFlux; highEnv[f] = highFlux;
      rms[f] = Math.sqrt(power / bins);
      for (var bi = 0; bi < BANDS.length; bi++) {
        var s = 0;
        for (var m = BANDS[bi].a; m <= BANDS[bi].b; m++) s += mag[m];
        bandEnergy[bi][f] = s / (BANDS[bi].b - BANDS[bi].a + 1);
      }

      if ((f & 63) === 0 && performance.now() - t0 > 12) {
        report(0.1 + 0.6 * f / frameCount, 'Listening for beats');
        await idle();
        t0 = performance.now();
      }
    }

    /* onsets: local peaks over an adaptive threshold */
    report(0.75, 'Finding onsets');
    var envS = smooth(env, 1);
    var local = smooth(env, Math.round(fps * 0.35));
    var onsets = [];
    var minGap = Math.round(fps * 0.06);
    var lastOn = -999;
    var envMax = 0;
    for (var e = 0; e < frameCount; e++) if (envS[e] > envMax) envMax = envS[e];
    for (var p = 1; p < frameCount - 1; p++) {
      var thr = local[p] * 1.5 + envMax * 0.015;
      if (envS[p] > thr && envS[p] >= envS[p - 1] && envS[p] > envS[p + 1] && p - lastOn > minGap) {
        onsets.push({
          t: p / fps + FRAME_LAG,
          strength: envMax ? Math.min(1, envS[p] / envMax) : 0,
          bass: bassEnv[p],
          high: highEnv[p]
        });
        lastOn = p;
      }
    }
    var bassPeak = 0, highPeak = 0;
    onsets.forEach(function (o) { bassPeak = Math.max(bassPeak, o.bass); highPeak = Math.max(highPeak, o.high); });
    onsets.forEach(function (o) {
      o.bass = bassPeak ? o.bass / bassPeak : 0;
      o.high = highPeak ? o.high / highPeak : 0;
    });
    await idle();

    /* tempo: comb-filtered autocorrelation of the onset envelope */
    report(0.85, 'Estimating tempo');
    var mean = 0;
    for (var mI = 0; mI < frameCount; mI++) mean += envS[mI];
    mean /= Math.max(1, frameCount);
    var norm = new Float32Array(frameCount);
    for (var nI = 0; nI < frameCount; nI++) norm[nI] = envS[nI] - mean;

    var minLag = Math.max(2, Math.floor(fps * 60 / 190));
    var maxLag = Math.ceil(fps * 60 / 65);
    // Multiples have to be measurable too, or long periods get no comb support.
    var acfMax = Math.min(maxLag * 4, Math.floor(frameCount / 2));
    var acfRaw = new Float32Array(acfMax + 2);
    for (var lag = minLag; lag <= acfMax; lag++) {
      var acf = 0;
      for (var x = 0; x + lag < frameCount; x++) acf += norm[x] * norm[x + lag];
      acfRaw[lag] = acf / Math.max(1, frameCount - lag);
    }
    var comb = new Float32Array(maxLag + 2);
    for (var l = minLag; l <= maxLag; l++) {
      var c = acfRaw[l];
      if (l * 2 <= acfMax) c += 0.5 * acfRaw[l * 2];
      if (l * 4 <= acfMax) c += 0.25 * acfRaw[l * 4];
      comb[l] = c;
    }
    var bestLag = minLag, bestScore = -Infinity;
    for (var l3 = minLag; l3 <= maxLag; l3++) {
      var candidate = 60 * fps / l3;
      var prior = Math.exp(-0.5 * Math.pow(Math.log2(candidate / 120) / 0.9, 2));
      var score = comb[l3] * prior;
      if (score > bestScore) { bestScore = score; bestLag = l3; }
    }

    /* Refine period and phase together: slide a whole grid of beats over the
       onset envelope and keep the alignment that collects the most energy.
       A whole-frame period would drift by a full beat across a long song. */
    function envAt(f) {
      if (f < 1 || f >= frameCount - 2) return 0;
      var i = f | 0, frac = f - i;
      return envS[i] * (1 - frac) + envS[i + 1] * frac;
    }
    function gridScore(period, phase) {
      var total = 0, n = 0;
      for (var b = phase; b < frameCount - 2; b += period) {
        total += envAt(b) + 0.55 * envAt(b - 1) + 0.55 * envAt(b + 1);
        n++;
      }
      return n ? total / n : 0;
    }

    var period = bestLag, bestPhase = 0, bestGrid = -Infinity;
    for (var pStep = -30; pStep <= 30; pStep++) {
      var cand = bestLag * (1 + pStep * 0.002);
      if (cand < 2) continue;
      var phases = 160;
      for (var s = 0; s < phases; s++) {
        var ph = cand * s / phases;
        var sc = gridScore(cand, ph);
        if (sc > bestGrid) { bestGrid = sc; period = cand; bestPhase = ph; }
      }
    }
    var bpm = 60 * fps / period;

    var beats = [];
    for (var bt = bestPhase; bt / fps < buffer.duration; bt += period) beats.push(bt / fps + FRAME_LAG);
    await idle();

    /* bars and section levels */
    report(0.94, 'Mapping the arrangement');
    var downbeat = 0, bestBarScore = -Infinity;
    for (var d0 = 0; d0 < 4; d0++) {
      var sc = 0;
      for (var bIdx = d0; bIdx < beats.length; bIdx += 4) {
        var fr = Math.min(frameCount - 1, Math.round(beats[bIdx] * fps));
        sc += envS[fr] + bassEnv[fr];
      }
      if (sc > bestBarScore) { bestBarScore = sc; downbeat = d0; }
    }

    var bars = [];
    for (var bi2 = downbeat; bi2 + 4 <= beats.length; bi2 += 4) {
      var start = beats[bi2];
      var end = beats[bi2 + 4] !== undefined ? beats[bi2 + 4] : start + period * 4 / fps;
      var f0 = Math.max(0, Math.round(start * fps)), f1 = Math.min(frameCount, Math.round(end * fps));
      var energy = 0, hi = 0, lo = 0;
      for (var ff = f0; ff < f1; ff++) {
        energy += rms[ff];
        hi += bandEnergy[3][ff] + bandEnergy[4][ff];
        lo += bandEnergy[0][ff];
      }
      var span = Math.max(1, f1 - f0);
      bars.push({
        start: start, end: end, index: bars.length,
        beats: beats.slice(bi2, bi2 + 5).slice(0, 4),
        energy: energy / span,
        bright: hi / (hi + lo + 1e-9),
        level: 0
      });
    }

    var sortedE = bars.map(function (b) { return b.energy; }).sort(function (a, b) { return a - b; });
    var q1 = percentile(sortedE, 0.35), q2 = percentile(sortedE, 0.65), q3 = percentile(sortedE, 0.87);
    bars.forEach(function (b) {
      b.level = b.energy >= q3 ? 3 : b.energy >= q2 ? 2 : b.energy >= q1 ? 1 : 0;
    });
    // A bar that jumps two levels above the previous one is a drop.
    bars.forEach(function (b, i2) {
      b.drop = i2 > 0 && b.level - bars[i2 - 1].level >= 2;
    });

    report(1, 'Ready');
    return {
      fps: fps,
      duration: buffer.duration,
      wave: wave,
      env: envS,
      rms: rms,
      bands: { names: BANDS.map(function (b) { return b.name; }), data: bandEnergy },
      onsets: onsets,
      bpm: bpm,
      beatPeriod: period / fps,
      beatOffset: bestPhase / fps + FRAME_LAG,
      beats: beats,
      bars: bars
    };
  }

  /* Rebuild beats/bars after the user corrects the tempo by hand. */
  function regrid(analysis, bpm, offset) {
    var period = 60 / bpm;
    var beats = [];
    for (var t = offset; t < analysis.duration; t += period) if (t >= 0) beats.push(t);
    analysis.bpm = bpm;
    analysis.beatPeriod = period;
    analysis.beatOffset = offset;
    analysis.beats = beats;

    var fps = analysis.fps, rms = analysis.rms, band = analysis.bands.data;
    var bars = [];
    for (var i = 0; i + 4 <= beats.length; i += 4) {
      var start = beats[i], end = beats[i + 4] !== undefined ? beats[i + 4] : start + period * 4;
      var f0 = Math.max(0, Math.round(start * fps)), f1 = Math.min(rms.length, Math.round(end * fps));
      var energy = 0, hi = 0, lo = 0;
      for (var f = f0; f < f1; f++) {
        energy += rms[f];
        hi += band[3][f] + band[4][f];
        lo += band[0][f];
      }
      var span = Math.max(1, f1 - f0);
      bars.push({
        start: start, end: end, index: bars.length, beats: beats.slice(i, i + 4),
        energy: energy / span, bright: hi / (hi + lo + 1e-9), level: 0
      });
    }
    var sorted = bars.map(function (b) { return b.energy; }).sort(function (a, b) { return a - b; });
    var q1 = percentile(sorted, 0.35), q2 = percentile(sorted, 0.65), q3 = percentile(sorted, 0.87);
    bars.forEach(function (b, i) {
      b.level = b.energy >= q3 ? 3 : b.energy >= q2 ? 2 : b.energy >= q1 ? 1 : 0;
      b.drop = i > 0 && b.level - bars[i - 1].level >= 2;
    });
    analysis.bars = bars;
    return analysis;
  }

  root.TLS = root.TLS || {};
  root.TLS.audio = {
    sniff: sniff, decode: decode, toWav: toWav, analyse: analyse, regrid: regrid,
    audioContext: audioContext
  };
})(window);
