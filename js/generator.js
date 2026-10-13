/* The automatic choreographer.
 *
 * It works the way a person would: split the song into bars, judge how loud and
 * how bright each bar is, then pick a move for each bar from a palette, with
 * accents landing on the onsets the analysis found. Closures are scheduled
 * separately because the car limits how many times each one may move.
 */
(function (root) {
  'use strict';
  var CH = root.TLS.channels;
  var DOC = root.TLS.doc;
  var G = CH.G, L = CH.L, C = CH.C;

  var MIN_ON = 0.09;   // shorter than this and you can barely see it
  var MIN_GAP = 0.06;  // shared off-time so OR'd channels actually blink

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function Emitter(doc, from, to) {
    this.doc = doc; this.from = from; this.to = to;
  }
  Emitter.prototype.on = function (ch, s, e, v) {
    if (ch === undefined || ch === null) return;
    s = Math.max(this.from, s);
    e = Math.min(this.to, e);
    if (e - s < MIN_ON) e = s + MIN_ON;
    if (s >= this.to) return;
    e = Math.min(e, this.to);
    if (e <= s) return;
    var lane = this.doc.lanes[ch];
    var prev = lane.length ? lane[lane.length - 1] : null;
    if (prev && s - prev.e < MIN_GAP && s > prev.s) {
      if (prev.v === (v === undefined ? L.ON : v)) { prev.e = Math.max(prev.e, e); return; }
      prev.e = Math.max(prev.s + MIN_ON, s - MIN_GAP);
      if (prev.e >= s) return;
    }
    DOC.add(this.doc, ch, s, e, v === undefined ? L.ON : v);
  };
  Emitter.prototype.group = function (list, s, e, v) {
    var self = this;
    list.forEach(function (ch) { self.on(ch, s, e, v); });
  };

  /* ---------- the palette ---------- */

  function pulseLen(beat, frac) { return Math.max(MIN_ON, beat * frac); }

  var PATTERNS = [
    {
      id: 'beatPulse', levels: [1, 2, 3], w: 3,
      run: function (c) {
        c.bar.beats.forEach(function (t, i) {
          var len = pulseLen(c.beat, i % 2 === 0 ? 0.45 : 0.3);
          c.e.group(G.mains, t, t + len);
          if (c.bar.level >= 2) c.e.group(G.signatures, t, t + len);
          if (i % 2 === 1) c.e.group(G.tails, t, t + len);
        });
      }
    },
    {
      id: 'altSides', levels: [1, 2, 3], w: 3,
      run: function (c) {
        c.bar.beats.forEach(function (t, i) {
          var side = i % 2 === 0 ? G.left : G.right;
          var len = pulseLen(c.beat, 0.42);
          c.e.group(side.filter(function (x) { return x <= 5 || x === 12 || x === 13; }), t, t + len);
          if (c.bar.level >= 2) {
            c.e.on(i % 2 === 0 ? G.tails[0] : G.tails[1], t, t + len);
          }
        });
      }
    },
    {
      id: 'chase', levels: [1, 2, 3], w: 2.5,
      run: function (c) {
        var seq = c.rnd() < 0.5 ? G.sweepFront : G.sweepFront.slice().reverse();
        var step = (c.bar.end - c.bar.start) / seq.length;
        seq.forEach(function (ch, i) {
          var t = c.bar.start + i * step;
          c.e.on(ch, t, t + Math.max(MIN_ON, step * 1.6));
        });
      }
    },
    {
      id: 'bassKick', levels: [1, 2, 3], w: 3,
      run: function (c) {
        var hits = c.onsets.filter(function (o) { return o.bass > 0.25; });
        if (!hits.length) hits = c.bar.beats.map(function (t) { return { t: t, bass: 1, strength: 1 }; });
        hits.forEach(function (o) {
          var len = pulseLen(c.beat, 0.35 + o.strength * 0.2);
          c.e.group(G.outerMains, o.t, o.t + len);
          c.e.group(G.brake, o.t, o.t + len);
          if (o.bass > 0.6) c.e.group(G.innerMains, o.t, o.t + len);
        });
      }
    },
    {
      id: 'hats', levels: [1, 2, 3], w: 2,
      run: function (c) {
        var eighth = c.beat / 2;
        for (var t = c.bar.start; t < c.bar.end - 0.01; t += eighth) {
          c.e.group(G.repeaters, t, t + Math.min(pulseLen(c.beat, 0.2), eighth * 0.6));
        }
        c.bar.beats.forEach(function (t, i) {
          if (i % 2 === 0) c.e.group(G.markers, t, t + pulseLen(c.beat, 0.4));
        });
      }
    },
    {
      id: 'strobe', levels: [2, 3], w: 2,
      run: function (c) {
        var div = c.bar.level === 3 ? 4 : 2;                 // 16ths or 8ths
        var step = c.beat / div;
        var on = Math.max(MIN_ON, step * 0.5);
        var target = c.rnd() < 0.5 ? G.mains : G.mains.concat(G.signatures);
        for (var t = c.bar.start, i = 0; t < c.bar.end - 0.01; t += step, i++) {
          c.e.group(target, t, t + on);
          if (i % 4 === 0) c.e.group(G.tails, t, t + on);
        }
      }
    },
    {
      id: 'turnSweep', levels: [1, 2, 3], w: 1.5,
      run: function (c) {
        var order = [G.frontTurns[0], G.markers[0], G.repeaters[0], G.repeaters[1], G.markers[1], G.frontTurns[1]];
        var step = (c.bar.end - c.bar.start) / order.length;
        order.forEach(function (ch, i) {
          var t = c.bar.start + i * step;
          c.e.on(ch, t, t + Math.max(MIN_ON, step * 1.4));
        });
        c.e.group(G.rearTurns, c.bar.beats[3] || c.bar.start, (c.bar.beats[3] || c.bar.start) + pulseLen(c.beat, 0.5));
      }
    },
    {
      id: 'glow', levels: [0, 1], w: 3,
      run: function (c) {
        var span = c.bar.end - c.bar.start;
        c.e.group(G.innerMains, c.bar.start, c.bar.start + span * 0.55, L.ON_1000);
        c.e.group(G.innerMains, c.bar.start + span * 0.55, c.bar.end, L.OFF_1000);
        c.e.group(G.ch4, c.bar.start, c.bar.end, L.ON_2000);
        if (c.bar.bright > 0.5) c.e.group(G.signatures, c.bar.beats[2] || c.bar.start, c.bar.end, L.ON_500);
      }
    },
    {
      id: 'breathe', levels: [0, 1], w: 2.5,
      run: function (c) {
        var span = c.bar.end - c.bar.start;
        c.e.group(G.signatures, c.bar.start, c.bar.start + span * 0.7, L.ON_2000);
        c.e.group(G.signatures, c.bar.start + span * 0.7, c.bar.end, L.OFF_1000);
        c.e.group(G.tails, c.bar.start, c.bar.end * 0.999, L.ON);
      }
    },
    {
      id: 'fogStep', levels: [1, 2], w: 1.6,
      run: function (c) {
        c.bar.beats.forEach(function (t, i) {
          var len = pulseLen(c.beat, 0.45);
          if (i % 2 === 0) { c.e.group(G.fogs, t, t + len); c.e.group(G.auxPark, t, t + len); }
          else { c.e.group(G.tails, t, t + len); c.e.group(G.plate, t, t + len); }
        });
      }
    },
    {
      id: 'doubleTime', levels: [2, 3], w: 2,
      run: function (c) {
        var step = c.beat / 2;
        var i = 0;
        for (var t = c.bar.start; t < c.bar.end - 0.01; t += step, i++) {
          c.e.group(i % 2 ? G.innerMains : G.outerMains, t, t + Math.max(MIN_ON, step * 0.55));
          if (i % 4 === 2) c.e.group(G.signatures, t, t + step * 0.5);
        }
      }
    },
    {
      id: 'rearAlt', levels: [1, 2], w: 1.4,
      run: function (c) {
        c.bar.beats.forEach(function (t, i) {
          var len = pulseLen(c.beat, 0.5);
          c.e.on(i % 2 ? G.tails[1] : G.tails[0], t, t + len);
          c.e.on(i % 2 ? G.rearTurns[1] : G.rearTurns[0], t, t + len);
          if (i === 3) c.e.group(G.brake, t, t + len);
        });
      }
    },
    {
      id: 'blast', levels: [3], w: 2,
      run: function (c) {
        var first = c.bar.beats[0];
        c.e.group(G.frontAll, first, first + pulseLen(c.beat, 0.9));
        c.e.group(G.rearAll, first, first + pulseLen(c.beat, 0.9));
        c.bar.beats.slice(1).forEach(function (t, i) {
          var len = pulseLen(c.beat, 0.3);
          c.e.group(i % 2 ? G.innerMains : G.outerMains, t, t + len);
          c.e.group(G.signatures, t, t + len);
        });
      }
    },
    {
      id: 'build', levels: [1, 2, 3], w: 1.2,
      run: function (c) {
        var span = c.bar.end - c.bar.start;
        var t = c.bar.start, gap = c.beat / 2;
        while (t < c.bar.end - 0.02) {
          c.e.group(G.mains, t, t + Math.max(MIN_ON, gap * 0.45));
          t += gap;
          gap = Math.max(c.beat / 8, gap * 0.78);
        }
        c.e.group(G.signatures, c.bar.end - span * 0.12, c.bar.end);
      }
    },
    { id: 'rest', levels: [0, 1, 2], w: 1.2, run: function () {} }
  ];

  var STYLE_BIAS = {
    balanced: {},
    party: { strobe: 2.2, doubleTime: 1.8, blast: 1.8, build: 1.6, glow: 0.3, breathe: 0.2, rest: 0.5 },
    elegant: { glow: 2.6, breathe: 2.4, chase: 1.6, turnSweep: 1.4, strobe: 0.15, doubleTime: 0.3, blast: 0.4, hats: 0.6 },
    classic: { beatPulse: 2, altSides: 2, fogStep: 1.8, rearAlt: 1.6, chase: 1.4, strobe: 0.5, doubleTime: 0.6 }
  };

  function pick(rnd, bar, style, intensity, avoid) {
    var bias = STYLE_BIAS[style] || {};
    var pool = [], total = 0;
    PATTERNS.forEach(function (p) {
      if (p.levels.indexOf(bar.level) < 0) return;
      var w = p.w * (bias[p.id] === undefined ? 1 : bias[p.id]);
      if (p.id === avoid) w *= 0.25;
      if (p.id === 'rest') w *= (1.6 - intensity * 1.4);
      if (p.id === 'strobe' || p.id === 'doubleTime' || p.id === 'build') w *= (0.4 + intensity * 1.4);
      if (p.id === 'hats' && bar.bright < 0.35) w *= 0.4;
      if (w <= 0) return;
      pool.push({ p: p, w: w }); total += w;
    });
    if (!pool.length) return PATTERNS[0];
    var r = rnd() * total;
    for (var i = 0; i < pool.length; i++) {
      r -= pool[i].w;
      if (r <= 0) return pool[i].p;
    }
    return pool[pool.length - 1].p;
  }

  /* ---------- closures ---------- */

  function planClosures(doc, e, analysis, opts, rnd) {
    var end = opts.to;
    var start = opts.from;
    var span = end - start;
    if (span < 20) return;

    var loud = analysis.bars.filter(function (b) {
      return b.level >= 2 && b.start > start + 8 && b.end < end - 12;
    });
    var drops = analysis.bars.filter(function (b) {
      return b.drop && b.start > start + 10 && b.end < end - 20;
    });

    function moment(i, list) {
      if (!list.length) return null;
      return list[Math.min(list.length - 1, Math.floor(i * list.length / 4 + rnd() * 0.5))].start;
    }

    // Mirrors: quick flick, up to four times (limit is 20 per mirror).
    var flicks = Math.min(4, Math.max(1, Math.floor(span / 45)));
    for (var i = 0; i < flicks; i++) {
      var t = moment(i, loud.length ? loud : analysis.bars);
      if (t === null || t > end - 8) continue;
      e.group(G.mirrors, t, t + 0.5, C.OPEN);
      e.group(G.mirrors, t + 2.5, t + 3, C.CLOSE);
    }

    // Door handles present themselves on Model S. Limit is 20.
    if (span > 60 && loud.length) {
      var ht = loud[Math.floor(loud.length * 0.25)].start;
      e.group(G.handles, ht, ht + 0.5, C.OPEN);
      e.group(G.handles, ht + 6, ht + 6.5, C.CLOSE);
    }

    // Windows may dance without opening first. Three commands each, limit six.
    if (span > 45) {
      var wt = (drops[0] || loud[Math.floor(loud.length / 2)] || analysis.bars[Math.floor(analysis.bars.length / 2)]).start;
      var danceLen = Math.min(18, Math.max(6, span * 0.12));
      if (wt + danceLen + 6 < end) {
        e.group(G.windows, wt, wt + 0.5, C.OPEN);
        e.group(G.windows, wt + 4, wt + 4 + danceLen, C.DANCE);
        e.group(G.windows, wt + 4 + danceLen + 0.5, wt + 5 + danceLen, C.CLOSE);
      }
    }

    // Liftgate needs 14 s to open before it can dance. Limit six commands.
    if (span > 90 && drops.length) {
      var lt = drops[0].start;
      if (lt + 30 < end) {
        e.on(G.liftgate[0], lt, lt + 0.5, C.OPEN);
        e.on(G.liftgate[0], lt + 15, lt + 24, C.DANCE);
        e.on(G.liftgate[0], lt + 25, lt + 26, C.CLOSE);
      }
    }

    // Charge port: open, rainbow dance, close. Exactly its three command budget.
    if (span > 70) {
      var ct = start + span * 0.62;
      e.on(G.chargePort[0], ct, ct + 0.5, C.OPEN);
      e.on(G.chargePort[0], ct + 3, ct + 13, C.DANCE);
      e.on(G.chargePort[0], ct + 14, ct + 15, C.CLOSE);
    }
  }

  /* ---------- entry point ---------- */

  function generate(analysis, opts) {
    opts = opts || {};
    var doc = opts.doc ? DOC.clone(opts.doc) : DOC.create();
    var from = opts.from || 0;
    var to = opts.to || analysis.duration;
    var style = opts.style || 'balanced';
    var intensity = opts.intensity === undefined ? 0.6 : opts.intensity;
    var rnd = mulberry32(opts.seed || 1);

    var targets = opts.closures ? G.lightsAll.concat(G.closuresAll) : G.lightsAll;
    DOC.clearRange(doc, targets, from, to);

    var e = new Emitter(doc, from, to);
    var bars = analysis.bars.filter(function (b) { return b.end > from && b.start < to; });
    if (!bars.length) return doc;

    var last = null, held = null, heldFor = 0;
    bars.forEach(function (bar, i) {
      var beat = (bar.end - bar.start) / 4;
      var onsets = analysis.onsets.filter(function (o) { return o.t >= bar.start && o.t < bar.end; });
      var ctx = { bar: bar, beat: beat, onsets: onsets, e: e, rnd: rnd, style: style, intensity: intensity };

      var pattern;
      if (bar.drop && bar.level === 3) {
        pattern = PATTERNS.filter(function (p) { return p.id === 'blast'; })[0];
        held = null;
      } else if (held && heldFor < (bar.level >= 2 ? 4 : 2) && held.levels.indexOf(bar.level) >= 0) {
        pattern = held; heldFor++;
      } else {
        pattern = pick(rnd, bar, style, intensity, last && last.id);
        held = pattern; heldFor = 1;
      }
      last = pattern;
      pattern.run(ctx);

      // Accents: strong hits that the bar pattern did not already cover.
      if (pattern.id !== 'rest' && bar.level >= 1) {
        onsets.forEach(function (o) {
          if (o.strength < 0.55 || rnd() > intensity * 0.7) return;
          var len = Math.max(MIN_ON, beat * 0.25);
          if (o.high > 0.55) e.group(G.repeaters, o.t, o.t + len);
          if (o.bass > 0.7) e.group(G.brake, o.t, o.t + len);
        });
      }
    });

    if (opts.closures) planClosures(doc, e, analysis, { from: from, to: to }, rnd);

    // Overwriting can leave slivers behind. Anything too short to see goes.
    for (var li = 0; li < 30; li++) {
      doc.lanes[li] = doc.lanes[li].filter(function (b) { return b.e - b.s >= 0.06; });
    }

    // Finish on a held chord of light, then dark.
    var lastBar = bars[bars.length - 1];
    var finale = Math.min(to - 0.1, lastBar.end - (lastBar.end - lastBar.start) / 2);
    if (finale > from + 1) {
      e.group(G.frontAll, finale, to - 0.05);
      e.group(G.rearAll, finale, to - 0.05);
    }
    return doc;
  }

  root.TLS.generator = { generate: generate, PATTERNS: PATTERNS, MIN_ON: MIN_ON };
})(window);
