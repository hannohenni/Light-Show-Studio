/* The timeline: waveform on top, beat grid behind, one lane per channel.
 * Drag on a lane to paint light. Drag on the waveform to select a range.
 */
(function (root) {
  'use strict';
  var CH = root.TLS.channels;
  var DOC = root.TLS.doc;

  var GUTTER = 152;
  var WAVE_H = 64;
  var RULER_H = 20;
  var ROW_H = 17;
  var HEAD_H = 21;

  function fmtTime(t) {
    if (!isFinite(t)) t = 0;
    var m = Math.floor(t / 60);
    var s = t - m * 60;
    return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2);
  }

  function Timeline(canvas, hooks) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.hooks = hooks || {};
    this.doc = DOC.create();
    this.analysis = null;
    this.duration = 60;
    this.t0 = 0;
    this.pxPerSec = 90;
    this.scrollY = 0;
    this.playhead = 0;
    this.selection = null;
    this.snap = 'beat';
    this.tool = 'draw';
    this.paintLight = CH.L.ON;
    this.paintClosure = CH.C.OPEN;
    this.collapsed = { front: false, rear: false, closure: true };
    this.hover = null;
    this.drag = null;
    this.needsDraw = true;
    this.bindEvents();
    this.resize();
  }

  Timeline.prototype.resize = function () {
    var r = this.canvas.getBoundingClientRect();
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = Math.max(360, r.width);
    this.h = Math.max(240, r.height);
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.needsDraw = true;
  };

  /* ---------- geometry ---------- */

  Timeline.prototype.rows = function () {
    var out = [];
    var y = 0;
    var self = this;
    CH.SECTIONS.forEach(function (sec) {
      out.push({ type: 'head', sec: sec, y: y, h: HEAD_H });
      y += HEAD_H;
      if (self.collapsed[sec.id]) return;
      for (var i = sec.from; i <= sec.to; i++) {
        out.push({ type: 'lane', ch: i, y: y, h: ROW_H });
        y += ROW_H;
      }
    });
    this.contentH = y;
    return out;
  };

  Timeline.prototype.lanesTop = function () { return WAVE_H + RULER_H; };
  Timeline.prototype.timeToX = function (t) { return GUTTER + (t - this.t0) * this.pxPerSec; };
  Timeline.prototype.xToTime = function (x) { return this.t0 + (x - GUTTER) / this.pxPerSec; };

  Timeline.prototype.clampView = function () {
    var visible = (this.w - GUTTER) / this.pxPerSec;
    var max = Math.max(0, this.duration - visible * 0.5);
    this.t0 = Math.max(-0.2, Math.min(max, this.t0));
    var maxScroll = Math.max(0, this.contentH - (this.h - this.lanesTop()));
    this.scrollY = Math.max(0, Math.min(maxScroll, this.scrollY));
  };

  /* ---------- snapping ---------- */

  Timeline.prototype.grid = function () {
    var a = this.analysis;
    if (!a || !a.beats || a.beats.length < 2) return null;
    return { period: a.beatPeriod, offset: a.beatOffset };
  };

  Timeline.prototype.snapTime = function (t) {
    if (this.snap === 'off') return Math.max(0, t);
    var g = this.grid();
    var step;
    if (!g) {
      step = { bar: 2, beat: 0.5, half: 0.25, quarter: 0.125 }[this.snap] || 0.25;
      return Math.max(0, Math.round(t / step) * step);
    }
    var div = { bar: 4, beat: 1, half: 0.5, quarter: 0.25 }[this.snap] || 1;
    step = g.period * div;
    var n = Math.round((t - g.offset) / step);
    return Math.max(0, g.offset + n * step);
  };

  /* ---------- events ---------- */

  Timeline.prototype.bindEvents = function () {
    var self = this;
    var c = this.canvas;

    c.addEventListener('pointerdown', function (ev) {
      c.setPointerCapture(ev.pointerId);
      var p = self.local(ev);
      self.onDown(p, ev);
    });
    c.addEventListener('pointermove', function (ev) {
      var p = self.local(ev);
      self.onMove(p, ev);
    });
    c.addEventListener('pointerup', function (ev) {
      var p = self.local(ev);
      self.onUp(p, ev);
      try { c.releasePointerCapture(ev.pointerId); } catch (e) {}
    });
    c.addEventListener('pointerleave', function () {
      self.hover = null; self.needsDraw = true;
      if (self.hooks.onHover) self.hooks.onHover(null);
    });
    c.addEventListener('contextmenu', function (ev) { ev.preventDefault(); });
    c.addEventListener('wheel', function (ev) {
      ev.preventDefault();
      var p = self.local(ev);
      if (ev.ctrlKey || ev.metaKey) {
        self.zoomAt(p.x, Math.pow(1.0015, -ev.deltaY));
      } else if (ev.shiftKey) {
        self.t0 += ev.deltaY / self.pxPerSec;
      } else if (Math.abs(ev.deltaX) > Math.abs(ev.deltaY)) {
        self.t0 += ev.deltaX / self.pxPerSec;
      } else {
        self.scrollY += ev.deltaY;
      }
      self.clampView();
      self.needsDraw = true;
    }, { passive: false });
  };

  Timeline.prototype.local = function (ev) {
    var r = this.canvas.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  };

  Timeline.prototype.zoomAt = function (x, factor) {
    var t = this.xToTime(x);
    this.pxPerSec = Math.max(6, Math.min(1400, this.pxPerSec * factor));
    this.t0 = t - (x - GUTTER) / this.pxPerSec;
    this.clampView();
    this.needsDraw = true;
  };

  Timeline.prototype.rowAt = function (y) {
    var rows = this.rows();
    var ly = y - this.lanesTop() + this.scrollY;
    for (var i = 0; i < rows.length; i++) {
      if (ly >= rows[i].y && ly < rows[i].y + rows[i].h) return rows[i];
    }
    return null;
  };

  Timeline.prototype.onDown = function (p, ev) {
    var self = this;
    if (p.x < GUTTER) {
      var row = this.rowAt(p.y);
      if (row && row.type === 'head') {
        this.collapsed[row.sec.id] = !this.collapsed[row.sec.id];
        this.needsDraw = true;
      } else if (row && row.type === 'lane' && this.hooks.onLaneClick) {
        this.hooks.onLaneClick(row.ch);
      }
      return;
    }
    if (p.y < WAVE_H) {                      // waveform: select a range
      this.drag = { kind: 'select', t: this.xToTime(p.x) };
      this.selection = { start: this.drag.t, end: this.drag.t };
      this.needsDraw = true;
      return;
    }
    if (p.y < this.lanesTop()) {              // ruler: scrub
      this.drag = { kind: 'seek' };
      if (this.hooks.onSeek) this.hooks.onSeek(Math.max(0, this.xToTime(p.x)));
      return;
    }
    var row2 = this.rowAt(p.y);
    if (!row2 || row2.type !== 'lane') return;

    var t = this.xToTime(p.x);
    var erase = ev.button === 2 || ev.altKey || this.tool === 'erase';
    var existing = DOC.blockAt(this.doc, row2.ch, t);
    if (this.hooks.beginEdit) this.hooks.beginEdit();

    if (erase) {
      this.drag = { kind: 'erase', ch: row2.ch, from: t, lastRow: row2.ch };
      DOC.clearLane(this.doc.lanes[row2.ch], t - 0.02, t + 0.02);
      if (existing) DOC.removeBlock(this.doc, row2.ch, existing);
      this.needsDraw = true;
      return;
    }

    var value = CH.isClosure(row2.ch) ? this.paintClosure : this.paintLight;
    var start = this.snapTime(t);
    this.drag = {
      kind: 'draw', ch: row2.ch, anchor: start, value: value,
      startX: p.x, startY: p.y, moved: false, hadBlock: existing, downT: Date.now()
    };
    var end = Math.max(start + this.minLen(), this.snapTime(t + this.minLen()));
    DOC.add(this.doc, row2.ch, start, end, value);
    this.needsDraw = true;
  };

  Timeline.prototype.minLen = function () {
    var g = this.grid();
    if (this.snap === 'off' || !g) return 0.12;
    var div = { bar: 4, beat: 1, half: 0.5, quarter: 0.25 }[this.snap] || 1;
    return Math.max(0.09, g.period * div);
  };

  Timeline.prototype.onMove = function (p, ev) {
    var d = this.drag;
    if (!d) {
      var row = this.rowAt(p.y);
      var t = this.xToTime(p.x);
      var info = null;
      if (p.x > GUTTER && row && row.type === 'lane') {
        var b = DOC.blockAt(this.doc, row.ch, t);
        info = { ch: row.ch, t: t, block: b };
      }
      this.hover = info;
      if (this.hooks.onHover) this.hooks.onHover(info);
      this.needsDraw = true;
      return;
    }
    if (d.kind === 'seek') {
      if (this.hooks.onSeek) this.hooks.onSeek(Math.max(0, this.xToTime(p.x)));
      return;
    }
    if (d.kind === 'select') {
      var t2 = this.xToTime(p.x);
      this.selection = { start: Math.min(d.t, t2), end: Math.max(d.t, t2) };
      if (this.hooks.onSelect) this.hooks.onSelect(this.selection);
      this.needsDraw = true;
      return;
    }
    if (d.kind === 'erase') {
      var row2 = this.rowAt(p.y);
      var te = this.xToTime(p.x);
      if (row2 && row2.type === 'lane') {
        DOC.clearLane(this.doc.lanes[row2.ch], Math.min(d.from, te), Math.max(d.from, te) + 0.001);
      }
      this.needsDraw = true;
      return;
    }
    if (d.kind === 'draw') {
      if (Math.abs(p.x - d.startX) > 3 || Math.abs(p.y - d.startY) > 3) d.moved = true;
      var tt = this.snapTime(this.xToTime(p.x));
      var s = Math.min(d.anchor, tt), e = Math.max(d.anchor, tt);
      if (e - s < this.minLen()) e = s + this.minLen();
      DOC.clearLane(this.doc.lanes[d.ch], d.spanS !== undefined ? Math.min(d.spanS, s) : s,
        d.spanE !== undefined ? Math.max(d.spanE, e) : e);
      DOC.add(this.doc, d.ch, s, e, d.value);
      d.spanS = s; d.spanE = e;
      this.needsDraw = true;
    }
  };

  Timeline.prototype.onUp = function (p, ev) {
    var d = this.drag;
    this.drag = null;
    if (!d) return;
    if (d.kind === 'draw' && !d.moved && d.hadBlock && Date.now() - d.downT < 300) {
      // A click on an existing block removes it again.
      DOC.clearLane(this.doc.lanes[d.ch], d.hadBlock.s, d.hadBlock.e);
    }
    if (d.kind === 'draw' || d.kind === 'erase') {
      if (this.hooks.onEdit) this.hooks.onEdit();
    }
    if (d.kind === 'select' && this.selection && this.selection.end - this.selection.start < 0.02) {
      this.selection = null;
      if (this.hooks.onSelect) this.hooks.onSelect(null);
    }
    this.needsDraw = true;
  };

  /* ---------- drawing ---------- */

  Timeline.prototype.draw = function () {
    var ctx = this.ctx, w = this.w, h = this.h;
    var rows = this.rows();
    this.clampView();

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0b0e14';
    ctx.fillRect(0, 0, w, h);

    this.drawWave(ctx);
    this.drawGrid(ctx, rows);
    this.drawLanes(ctx, rows);
    this.drawRuler(ctx);
    this.drawGutter(ctx, rows);
    this.drawPlayhead(ctx);
    this.needsDraw = false;
  };

  Timeline.prototype.drawWave = function (ctx) {
    var w = this.w;
    ctx.save();
    ctx.beginPath(); ctx.rect(GUTTER, 0, w - GUTTER, WAVE_H); ctx.clip();
    ctx.fillStyle = '#0d121a';
    ctx.fillRect(GUTTER, 0, w - GUTTER, WAVE_H);

    var a = this.analysis;
    if (a && a.wave) {
      var mid = WAVE_H / 2;
      var wave = a.wave;
      ctx.strokeStyle = 'rgba(122,168,214,0.75)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (var x = GUTTER; x < w; x++) {
        var t = this.xToTime(x);
        var i = Math.floor(t / wave.bucketS);
        if (i < 0 || i >= wave.max.length) continue;
        var next = Math.max(i + 1, Math.floor(this.xToTime(x + 1) / wave.bucketS));
        var lo = 1, hi = -1;
        for (var k = i; k < next && k < wave.max.length; k++) {
          if (wave.min[k] < lo) lo = wave.min[k];
          if (wave.max[k] > hi) hi = wave.max[k];
        }
        if (hi < lo) continue;
        ctx.moveTo(x + 0.5, mid - hi * (WAVE_H / 2 - 3));
        ctx.lineTo(x + 0.5, mid - lo * (WAVE_H / 2 - 3));
      }
      ctx.stroke();

      // energy per bar, drawn as a faint skyline behind the waveform
      if (a.bars) {
        ctx.fillStyle = 'rgba(255,174,43,0.13)';
        for (var b = 0; b < a.bars.length; b++) {
          var bar = a.bars[b];
          var x0 = this.timeToX(bar.start), x1 = this.timeToX(bar.end);
          if (x1 < GUTTER || x0 > w) continue;
          var hgt = 4 + bar.level * 7;
          ctx.fillRect(x0, WAVE_H - hgt, Math.max(1, x1 - x0 - 1), hgt);
        }
      }
    } else {
      ctx.fillStyle = 'rgba(190,210,235,0.35)';
      ctx.font = '12px ui-sans-serif, system-ui, sans-serif';
      ctx.fillText('Load a song to see its waveform', GUTTER + 14, WAVE_H / 2 + 4);
    }

    if (this.selection) {
      var sx = this.timeToX(this.selection.start), ex = this.timeToX(this.selection.end);
      ctx.fillStyle = 'rgba(255,174,43,0.18)';
      ctx.fillRect(sx, 0, ex - sx, WAVE_H);
    }
    ctx.restore();
    ctx.strokeStyle = 'rgba(140,170,205,0.16)';
    ctx.beginPath(); ctx.moveTo(GUTTER, WAVE_H + 0.5); ctx.lineTo(w, WAVE_H + 0.5); ctx.stroke();
  };

  Timeline.prototype.drawRuler = function (ctx) {
    var w = this.w;
    ctx.save();
    ctx.beginPath(); ctx.rect(GUTTER, WAVE_H, w - GUTTER, RULER_H); ctx.clip();
    ctx.fillStyle = '#0f141c';
    ctx.fillRect(GUTTER, WAVE_H, w - GUTTER, RULER_H);
    ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    ctx.fillStyle = 'rgba(190,214,240,0.55)';

    var a = this.analysis;
    if (a && a.beats && a.beats.length > 1) {
      var every = this.pxPerSec * a.beatPeriod * 4 < 46 ? 4 : 1;
      for (var i = 0; i < a.beats.length; i += 4 * every) {
        var x = this.timeToX(a.beats[i]);
        if (x < GUTTER - 40 || x > w) continue;
        ctx.fillText(String(1 + i / 4), x + 3, WAVE_H + 13);
      }
    } else {
      var stepS = this.pxPerSec > 120 ? 1 : this.pxPerSec > 40 ? 5 : 15;
      var t = Math.floor(this.t0 / stepS) * stepS;
      for (; t < this.t0 + (w - GUTTER) / this.pxPerSec; t += stepS) {
        var x2 = this.timeToX(t);
        if (x2 < GUTTER) continue;
        ctx.fillText(fmtTime(t).replace(/\.\d+$/, ''), x2 + 3, WAVE_H + 13);
      }
    }
    ctx.restore();
  };

  Timeline.prototype.drawGrid = function (ctx, rows) {
    var w = this.w, top = this.lanesTop();
    var a = this.analysis;
    ctx.save();
    ctx.beginPath(); ctx.rect(GUTTER, top, w - GUTTER, this.h - top); ctx.clip();

    if (a && a.beats && a.beats.length > 1) {
      var beatPx = a.beatPeriod * this.pxPerSec;
      var showBeats = beatPx > 7;
      for (var i = 0; i < a.beats.length; i++) {
        var x = this.timeToX(a.beats[i]);
        if (x < GUTTER || x > w) continue;
        var isBar = i % 4 === 0;
        if (!isBar && !showBeats) continue;
        ctx.strokeStyle = isBar ? 'rgba(150,185,225,0.20)' : 'rgba(150,185,225,0.08)';
        ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, top); ctx.lineTo(Math.round(x) + 0.5, this.h); ctx.stroke();
      }
    }
    if (this.selection) {
      var sx = this.timeToX(this.selection.start), ex = this.timeToX(this.selection.end);
      ctx.fillStyle = 'rgba(255,174,43,0.07)';
      ctx.fillRect(sx, top, ex - sx, this.h - top);
      ctx.strokeStyle = 'rgba(255,174,43,0.45)';
      ctx.beginPath();
      ctx.moveTo(sx + 0.5, top); ctx.lineTo(sx + 0.5, this.h);
      ctx.moveTo(ex + 0.5, top); ctx.lineTo(ex + 0.5, this.h);
      ctx.stroke();
    }
    ctx.restore();
  };

  Timeline.prototype.drawLanes = function (ctx, rows) {
    var w = this.w, top = this.lanesTop();
    ctx.save();
    ctx.beginPath(); ctx.rect(GUTTER, top, w - GUTTER, this.h - top); ctx.clip();

    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      var y = top + row.y - this.scrollY;
      if (y + row.h < top || y > this.h) continue;

      if (row.type === 'head') {
        ctx.fillStyle = 'rgba(255,255,255,0.035)';
        ctx.fillRect(GUTTER, y, w - GUTTER, row.h);
        continue;
      }
      var ch = CH.CHANNELS[row.ch];
      if (row.ch % 2 === 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.014)';
        ctx.fillRect(GUTTER, y, w - GUTTER, row.h);
      }
      if (this.hover && this.hover.ch === row.ch) {
        ctx.fillStyle = 'rgba(255,255,255,0.04)';
        ctx.fillRect(GUTTER, y, w - GUTTER, row.h);
      }

      var lane = this.doc.lanes[row.ch];
      for (var k = 0; k < lane.length; k++) {
        var b = lane[k];
        var x0 = this.timeToX(b.s), x1 = this.timeToX(b.e);
        if (x1 < GUTTER || x0 > w) continue;
        x0 = Math.max(GUTTER, x0);
        var bw = Math.max(2, x1 - x0);
        var strength = b.v === 255 ? 1 : 0.55 + (b.v / 255) * 0.35;
        ctx.globalAlpha = 0.30 + 0.55 * strength;
        ctx.fillStyle = ch.color;
        ctx.fillRect(x0, y + 2, bw, row.h - 4);
        ctx.globalAlpha = 1;
        if (b.v !== 255 && b.v !== 0) {
          ctx.fillStyle = 'rgba(10,14,20,0.85)';
          ctx.fillRect(x0, y + 2, Math.min(3, bw), row.h - 4);
        }
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  };

  Timeline.prototype.drawGutter = function (ctx, rows) {
    var top = this.lanesTop();
    ctx.save();
    ctx.fillStyle = '#0a0d13';
    ctx.fillRect(0, 0, GUTTER, this.h);
    ctx.strokeStyle = 'rgba(140,170,205,0.16)';
    ctx.beginPath(); ctx.moveTo(GUTTER + 0.5, 0); ctx.lineTo(GUTTER + 0.5, this.h); ctx.stroke();

    ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(190,214,240,0.5)';
    ctx.fillText('WAVEFORM', 12, 16);
    ctx.fillStyle = 'rgba(190,214,240,0.3)';
    ctx.fillText('drag to select', 12, 30);

    ctx.beginPath(); ctx.rect(0, top, GUTTER, this.h - top); ctx.clip();
    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      var y = top + row.y - this.scrollY;
      if (y + row.h < top || y > this.h) continue;

      if (row.type === 'head') {
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        ctx.fillRect(0, y, GUTTER, row.h);
        ctx.fillStyle = 'rgba(226,238,255,0.92)';
        ctx.font = '600 10px ui-sans-serif, system-ui, sans-serif';
        ctx.fillText((this.collapsed[row.sec.id] ? '▸ ' : '▾ ') + row.sec.label.toUpperCase(), 10, y + 14);
        continue;
      }
      var ch = CH.CHANNELS[row.ch];
      ctx.fillStyle = ch.color;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(0, y + 3, 3, row.h - 6);
      ctx.globalAlpha = 1;
      ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
      ctx.fillStyle = 'rgba(160,185,215,0.5)';
      ctx.fillText(String(ch.n).padStart(2, '0'), 9, y + 12);
      ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
      ctx.fillStyle = 'rgba(222,234,250,0.88)';
      var label = (ch.side ? ch.side + ' ' : '') + ch.name;
      ctx.fillText(label.length > 20 ? label.slice(0, 19) + '…' : label, 28, y + 12);
    }
    ctx.restore();
  };

  Timeline.prototype.drawPlayhead = function (ctx) {
    var x = this.timeToX(this.playhead);
    if (x < GUTTER || x > this.w) return;
    ctx.save();
    ctx.strokeStyle = '#ffae2b';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + 0.5, 0);
    ctx.lineTo(Math.round(x) + 0.5, this.h);
    ctx.stroke();
    ctx.fillStyle = '#ffae2b';
    ctx.beginPath();
    ctx.moveTo(x - 5, 0); ctx.lineTo(x + 5, 0); ctx.lineTo(x, 7);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  };

  Timeline.prototype.scrollToPlayhead = function () {
    var visible = (this.w - GUTTER) / this.pxPerSec;
    if (this.playhead < this.t0 + visible * 0.08 || this.playhead > this.t0 + visible * 0.82) {
      this.t0 = this.playhead - visible * 0.35;
      this.clampView();
      this.needsDraw = true;
    }
  };

  Timeline.prototype.fit = function () {
    this.pxPerSec = Math.max(6, (this.w - GUTTER) / Math.max(1, this.duration));
    this.t0 = 0;
    this.needsDraw = true;
  };

  root.TLS.timeline = { Timeline: Timeline, GUTTER: GUTTER, fmtTime: fmtTime };
})(window);
