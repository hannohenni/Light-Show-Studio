/* The stage: a top-down plot of the car.
 *
 * Every lamp sits where it sits on the real vehicle and glows with the colour
 * it actually emits. Closures move at the speeds Tesla documents, so an "open"
 * on the liftgate takes fourteen seconds here too.
 */
(function (root) {
  'use strict';
  var CH = root.TLS.channels;
  var L = CH.L, C = CH.C;
  var ID = CH.BY_ID;

  // Normalised car space: x -1..1 across the body, y 0 (nose) .. 1 (tail).
  function bar(x0, x1, y0, y1) { return { t: 'r', x0: x0, x1: x1, y0: y0, y1: y1 }; }

  var LAMPS = [
    // front clusters
    { ch: ID.l_signature.i, s: bar(-0.90, -0.05, 0.012, 0.030) },
    { ch: ID.r_signature.i, s: bar(0.05, 0.90, 0.012, 0.030) },
    { ch: ID.l_outer_main.i, s: bar(-0.88, -0.64, 0.036, 0.076) },
    { ch: ID.r_outer_main.i, s: bar(0.64, 0.88, 0.036, 0.076) },
    { ch: ID.l_ch4.i, s: bar(-0.615, -0.525, 0.036, 0.076) },
    { ch: ID.r_ch4.i, s: bar(0.525, 0.615, 0.036, 0.076) },
    { ch: ID.l_ch5.i, s: bar(-0.505, -0.415, 0.036, 0.076) },
    { ch: ID.r_ch5.i, s: bar(0.415, 0.505, 0.036, 0.076) },
    { ch: ID.l_ch6.i, s: bar(-0.395, -0.305, 0.036, 0.076) },
    { ch: ID.r_ch6.i, s: bar(0.305, 0.395, 0.036, 0.076) },
    { ch: ID.l_inner_main.i, s: bar(-0.285, -0.075, 0.036, 0.076) },
    { ch: ID.r_inner_main.i, s: bar(0.075, 0.285, 0.036, 0.076) },
    { ch: ID.l_front_turn.i, s: bar(-1.00, -0.90, 0.040, 0.086) },
    { ch: ID.r_front_turn.i, s: bar(0.90, 1.00, 0.040, 0.086) },
    { ch: ID.l_aux_park.i, s: bar(-0.86, -0.66, 0.092, 0.108) },
    { ch: ID.r_aux_park.i, s: bar(0.66, 0.86, 0.092, 0.108) },
    { ch: ID.l_front_fog.i, s: bar(-0.62, -0.44, 0.100, 0.126) },
    { ch: ID.r_front_fog.i, s: bar(0.44, 0.62, 0.100, 0.126) },
    { ch: ID.l_side_marker.i, s: bar(-1.03, -0.97, 0.115, 0.165) },
    { ch: ID.r_side_marker.i, s: bar(0.97, 1.03, 0.115, 0.165) },
    { ch: ID.l_repeater.i, s: bar(-1.04, -0.98, 0.300, 0.345) },
    { ch: ID.r_repeater.i, s: bar(0.98, 1.04, 0.300, 0.345) },
    // rear cluster
    { ch: ID.l_tail.i, s: bar(-0.88, -0.30, 0.945, 0.968) },
    { ch: ID.r_tail.i, s: bar(0.30, 0.88, 0.945, 0.968) },
    { ch: ID.brake.i, s: bar(-0.92, 0.92, 0.972, 0.986) },
    { ch: ID.l_rear_turn.i, s: bar(-1.00, -0.90, 0.938, 0.978) },
    { ch: ID.r_rear_turn.i, s: bar(0.90, 1.00, 0.938, 0.978) },
    { ch: ID.reverse.i, s: bar(-0.28, -0.10, 0.950, 0.966) },
    { ch: ID.reverse.i, s: bar(0.10, 0.28, 0.950, 0.966) },
    { ch: ID.rear_fog.i, s: bar(-0.46, -0.32, 0.988, 1.002) },
    { ch: ID.plate.i, s: bar(-0.10, 0.10, 0.992, 1.006) }
  ];

  var CLOSURES = [
    { ch: ID.l_mirror.i, kind: 'mirror', side: -1, y: 0.300, rest: 1 },
    { ch: ID.r_mirror.i, kind: 'mirror', side: 1, y: 0.300, rest: 1 },
    { ch: ID.l_front_window.i, kind: 'window', side: -1, y0: 0.330, y1: 0.500 },
    { ch: ID.l_rear_window.i, kind: 'window', side: -1, y0: 0.515, y1: 0.680 },
    { ch: ID.r_front_window.i, kind: 'window', side: 1, y0: 0.330, y1: 0.500 },
    { ch: ID.r_rear_window.i, kind: 'window', side: 1, y0: 0.515, y1: 0.680 },
    { ch: ID.lf_handle.i, kind: 'handle', side: -1, y: 0.425 },
    { ch: ID.lr_handle.i, kind: 'handle', side: -1, y: 0.610 },
    { ch: ID.rf_handle.i, kind: 'handle', side: 1, y: 0.425 },
    { ch: ID.rr_handle.i, kind: 'handle', side: 1, y: 0.610 },
    { ch: ID.l_front_door.i, kind: 'door', side: -1, y0: 0.320, y1: 0.510 },
    { ch: ID.r_front_door.i, kind: 'door', side: 1, y0: 0.320, y1: 0.510 },
    { ch: ID.l_falcon.i, kind: 'falcon', side: -1, y0: 0.505, y1: 0.700 },
    { ch: ID.r_falcon.i, kind: 'falcon', side: 1, y0: 0.505, y1: 0.700 },
    { ch: ID.liftgate.i, kind: 'liftgate', y: 0.86 },
    { ch: ID.charge_port.i, kind: 'port', side: -1, y: 0.800 }
  ];

  function Stage(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.level = new Float32Array(CH.COUNT);
    this.target = new Float32Array(CH.COUNT);
    this.rate = new Float32Array(CH.COUNT);
    this.pos = new Float32Array(CH.COUNT);
    this.mode = new Array(CH.COUNT).fill('idle');
    this.phase = new Float32Array(CH.COUNT);
    this.rainbow = 0;
    var self = this;
    CLOSURES.forEach(function (c) { if (c.rest) self.pos[c.ch] = c.rest; });
    this.resize();
  }

  Stage.prototype.resize = function () {
    var r = this.canvas.getBoundingClientRect();
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = Math.max(200, r.width);
    this.h = Math.max(200, r.height);
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  Stage.prototype.reset = function () {
    this.level.fill(0);
    this.target.fill(0);
    this.pos.fill(0);
    var self = this;
    this.mode = new Array(CH.COUNT).fill('idle');
    CLOSURES.forEach(function (c) { if (c.rest) self.pos[c.ch] = c.rest; });
  };

  /* Feed one frame of channel bytes plus the time since the last one. */
  Stage.prototype.update = function (values, dt) {
    dt = Math.min(0.2, Math.max(0, dt));
    this.rainbow = (this.rainbow + dt * 0.6) % 1;

    for (var i = 0; i < 30; i++) {
      var v = values[i] || 0;
      var tgt = this.target[i], rate = this.rate[i];
      if (v === L.ON) { tgt = 1; rate = 0; }
      else if (v === L.OFF) { tgt = 0; rate = 0; }
      else if (v === L.ON_500) { tgt = 1; rate = 1 / 0.5; }
      else if (v === L.ON_1000) { tgt = 1; rate = 1 / 1; }
      else if (v === L.ON_2000) { tgt = 1; rate = 1 / 2; }
      else if (v === L.OFF_500) { tgt = 0; rate = 1 / 0.5; }
      else if (v === L.OFF_1000) { tgt = 0; rate = 1 / 1; }
      else if (v === L.OFF_2000) { tgt = 0; rate = 1 / 2; }
      else { tgt = v > 127 ? 1 : 0; rate = 0; }
      this.target[i] = tgt; this.rate[i] = rate;

      if (rate === 0) this.level[i] = tgt;
      else {
        var d = tgt - this.level[i];
        var step = rate * dt;
        this.level[i] += Math.abs(d) <= step ? d : (d > 0 ? step : -step);
      }
    }

    for (var k = 0; k < CLOSURES.length; k++) {
      var c = CLOSURES[k];
      var ch = CH.CHANNELS[c.ch];
      var val = values[c.ch] || 0;
      var mode = this.mode[c.ch];
      if (val === C.OPEN) mode = 'opening';
      else if (val === C.CLOSE) mode = 'closing';
      else if (val === C.STOP) mode = 'stop';
      else if (val === C.DANCE) {
        mode = (this.pos[c.ch] > 0.5 || c.kind === 'window') ? 'dance' : 'opening';
      }
      this.mode[c.ch] = mode;

      var openS = ch.openS || 2, closeS = ch.closeS || 2;
      if (mode === 'opening') {
        this.pos[c.ch] = Math.min(1, this.pos[c.ch] + dt / openS);
      } else if (mode === 'closing') {
        this.pos[c.ch] = Math.max(0, this.pos[c.ch] - dt / closeS);
      } else if (mode === 'dance') {
        this.phase[c.ch] += dt * (c.kind === 'window' ? 1.3 : 0.9);
        var lo = c.kind === 'window' ? 0.15 : 0.5;
        this.pos[c.ch] = lo + (1 - lo) * (0.5 + 0.5 * Math.sin(this.phase[c.ch] * Math.PI * 2));
      }
    }
  };

  /* ---------- drawing ---------- */

  function rounded(ctx, x, y, w, h, r) {
    r = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  Stage.prototype.draw = function () {
    var ctx = this.ctx, w = this.w, h = this.h;
    ctx.clearRect(0, 0, w, h);

    var margin = 26;
    var carH = h - margin * 2;
    var carW = Math.min(w - margin * 2, carH * 0.46);
    var cx = w / 2;
    var top = margin + (carH - carW / 0.46) / 2;
    var len = carW / 0.46;
    var halfW = carW / 2;

    var self = this;
    function X(nx) { return cx + nx * halfW; }
    function Y(ny) { return top + ny * len; }

    // ground shadow
    var g = ctx.createRadialGradient(cx, top + len * 0.5, len * 0.1, cx, top + len * 0.5, len * 0.62);
    g.addColorStop(0, 'rgba(0,0,0,0.55)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // wheels
    ctx.fillStyle = '#05070a';
    [[-1.0, 0.16], [1.0, 0.16], [-1.0, 0.74], [1.0, 0.74]].forEach(function (p) {
      var ww = halfW * 0.16, hh = len * 0.10;
      rounded(ctx, X(p[0]) - (p[0] < 0 ? ww * 0.55 : ww * 0.45), Y(p[1]), ww, hh, ww * 0.35);
      ctx.fill();
    });

    // body
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(X(-0.72), Y(0.02));
    ctx.bezierCurveTo(X(-0.99), Y(0.10), X(-1.0), Y(0.26), X(-1.0), Y(0.42));
    ctx.bezierCurveTo(X(-1.0), Y(0.70), X(-0.98), Y(0.86), X(-0.86), Y(0.97));
    ctx.bezierCurveTo(X(-0.60), Y(1.01), X(0.60), Y(1.01), X(0.86), Y(0.97));
    ctx.bezierCurveTo(X(0.98), Y(0.86), X(1.0), Y(0.70), X(1.0), Y(0.42));
    ctx.bezierCurveTo(X(1.0), Y(0.26), X(0.99), Y(0.10), X(0.72), Y(0.02));
    ctx.bezierCurveTo(X(0.40), Y(-0.01), X(-0.40), Y(-0.01), X(-0.72), Y(0.02));
    ctx.closePath();
    var body = ctx.createLinearGradient(X(-1), 0, X(1), 0);
    body.addColorStop(0, '#161c25');
    body.addColorStop(0.42, '#28313e');
    body.addColorStop(0.58, '#232b37');
    body.addColorStop(1, '#12171f');
    ctx.fillStyle = body;
    ctx.fill();
    ctx.strokeStyle = 'rgba(160,190,230,0.18)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // greenhouse
    ctx.beginPath();
    ctx.moveTo(X(-0.60), Y(0.30));
    ctx.bezierCurveTo(X(-0.80), Y(0.42), X(-0.80), Y(0.66), X(-0.66), Y(0.80));
    ctx.lineTo(X(0.66), Y(0.80));
    ctx.bezierCurveTo(X(0.80), Y(0.66), X(0.80), Y(0.42), X(0.60), Y(0.30));
    ctx.closePath();
    ctx.fillStyle = 'rgba(10,14,20,0.75)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(150,180,220,0.10)';
    ctx.stroke();
    ctx.restore();

    // closures that sit under the lamps
    this.drawClosures(ctx, X, Y, halfW, len);

    // lamps
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    LAMPS.forEach(function (lamp) {
      var lv = self.level[lamp.ch];
      var ch = CH.CHANNELS[lamp.ch];
      var s = lamp.s;
      var x = X(s.x0), y = Y(s.y0);
      var ww = X(s.x1) - x, hh = Y(s.y1) - y;
      if (lv <= 0.004) {
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        rounded(ctx, x, y, ww, hh, Math.min(3, hh / 2));
        ctx.fill();
        ctx.globalCompositeOperation = 'lighter';
        return;
      }
      ctx.globalAlpha = Math.min(1, 0.25 + lv * 0.75);
      ctx.shadowColor = ch.color;
      ctx.shadowBlur = 14 + 26 * lv;
      ctx.fillStyle = ch.color;
      rounded(ctx, x, y, ww, hh, Math.min(3, Math.abs(hh) / 2));
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    });
    ctx.restore();
    ctx.globalAlpha = 1;
  };

  Stage.prototype.drawClosures = function (ctx, X, Y, halfW, len) {
    var self = this;
    CLOSURES.forEach(function (c) {
      var p = self.pos[c.ch];
      if (c.kind === 'mirror') {
        var x0 = X(c.side * 1.0), y0 = Y(c.y);
        var reach = halfW * (0.06 + 0.14 * p);
        ctx.save();
        ctx.fillStyle = p > 0.5 ? 'rgba(120,190,235,0.55)' : 'rgba(120,190,235,0.25)';
        rounded(ctx, c.side < 0 ? x0 - reach : x0, y0, c.side * reach, len * 0.028, 2);
        ctx.fill();
        ctx.restore();
      } else if (c.kind === 'window') {
        var wy0 = Y(c.y0), wy1 = Y(c.y1);
        var wx = X(c.side * 0.985);
        var open = p;
        ctx.save();
        ctx.strokeStyle = 'rgba(120,190,235,0.20)';
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(wx, wy0); ctx.lineTo(wx, wy1); ctx.stroke();
        ctx.strokeStyle = 'rgba(150,215,255,' + (0.30 + 0.45 * (1 - open)) + ')';
        ctx.beginPath();
        ctx.moveTo(wx, wy0);
        ctx.lineTo(wx, wy0 + (wy1 - wy0) * (1 - open));
        ctx.stroke();
        ctx.restore();
      } else if (c.kind === 'handle') {
        var hx = X(c.side * 1.0), hy = Y(c.y);
        var ext = halfW * 0.05 * p;
        ctx.fillStyle = 'rgba(150,215,255,' + (0.25 + 0.5 * p) + ')';
        rounded(ctx, c.side < 0 ? hx - ext - 3 : hx + 3, hy, c.side * (ext + 3), len * 0.016, 2);
        ctx.fill();
      } else if (c.kind === 'door' || c.kind === 'falcon') {
        if (p < 0.01) return;
        var dy0 = Y(c.y0), dy1 = Y(c.y1);
        var dx = X(c.side * 1.0);
        var swing = halfW * 0.55 * p;
        ctx.save();
        ctx.strokeStyle = c.kind === 'falcon' ? 'rgba(120,220,255,0.65)' : 'rgba(120,190,235,0.6)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(dx, dy0);
        ctx.lineTo(dx + c.side * swing, dy0 + (dy1 - dy0) * (c.kind === 'falcon' ? 0.15 : 0.35));
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(dx, dy1);
        ctx.lineTo(dx + c.side * swing * 0.8, dy1 - (dy1 - dy0) * 0.1);
        ctx.stroke();
        ctx.restore();
      } else if (c.kind === 'liftgate') {
        if (p < 0.01) return;
        ctx.save();
        ctx.strokeStyle = 'rgba(120,200,240,' + (0.25 + 0.5 * p) + ')';
        ctx.lineWidth = 3;
        var ly = Y(0.99) + len * 0.10 * p;
        ctx.beginPath();
        ctx.moveTo(X(-0.72), ly);
        ctx.quadraticCurveTo(X(0), ly + len * 0.03, X(0.72), ly);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(X(-0.72), Y(0.93)); ctx.lineTo(X(-0.72), ly);
        ctx.moveTo(X(0.72), Y(0.93)); ctx.lineTo(X(0.72), ly);
        ctx.stroke();
        ctx.restore();
      } else if (c.kind === 'port') {
        var px = X(c.side * 1.0), py = Y(c.y);
        var dancing = self.mode[c.ch] === 'dance';
        var col = dancing
          ? 'hsl(' + Math.floor(self.rainbow * 360) + ',95%,62%)'
          : 'rgba(150,215,255,' + (0.25 + 0.5 * p) + ')';
        ctx.save();
        ctx.fillStyle = col;
        if (dancing) { ctx.shadowColor = col; ctx.shadowBlur = 16; }
        rounded(ctx, c.side < 0 ? px - 8 : px, py, c.side * 8, len * 0.03, 2);
        ctx.fill();
        ctx.restore();
      }
    });
  };

  root.TLS.stage = { Stage: Stage, LAMPS: LAMPS };
})(window);
