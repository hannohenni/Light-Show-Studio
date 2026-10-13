/* The show document.
 *
 * A show is 48 lists of blocks. A block is { s, e, v }: start second, end
 * second, and the byte written to that channel while it is active. Everything
 * else — the .fseq bytes, the preview, the timeline — is rendered from this.
 */
(function (root) {
  'use strict';
  var CH = root.TLS.channels;

  function create() {
    var lanes = new Array(CH.COUNT);
    for (var i = 0; i < CH.COUNT; i++) lanes[i] = [];
    return { lanes: lanes };
  }

  function clone(doc) {
    return { lanes: doc.lanes.map(function (l) { return l.map(function (b) { return { s: b.s, e: b.e, v: b.v }; }); }) };
  }

  /* Remove [s,e) from one lane, trimming or splitting whatever it overlaps. */
  function clearLane(lane, s, e) {
    var out = [];
    for (var i = 0; i < lane.length; i++) {
      var b = lane[i];
      if (b.e <= s || b.s >= e) { out.push(b); continue; }
      if (b.s < s) out.push({ s: b.s, e: s, v: b.v });
      if (b.e > e) out.push({ s: e, e: b.e, v: b.v });
    }
    lane.length = 0;
    Array.prototype.push.apply(lane, out);
    return lane;
  }

  function clearRange(doc, chList, s, e) {
    chList.forEach(function (i) { clearLane(doc.lanes[i], s, e); });
  }

  /* Insert a block, overwriting anything underneath it. */
  function add(doc, i, s, e, v) {
    if (!(e > s)) return;
    var lane = doc.lanes[i];
    clearLane(lane, s, e);
    lane.push({ s: s, e: e, v: v });
    lane.sort(function (a, b) { return a.s - b.s; });
    // Merge neighbours that carry the same value and touch.
    for (var k = lane.length - 1; k > 0; k--) {
      var prev = lane[k - 1], cur = lane[k];
      if (cur.v === prev.v && cur.s - prev.e < 1e-6) {
        prev.e = Math.max(prev.e, cur.e);
        lane.splice(k, 1);
      }
    }
  }

  function blockAt(doc, i, t) {
    var lane = doc.lanes[i];
    for (var k = 0; k < lane.length; k++) {
      if (t >= lane[k].s && t < lane[k].e) return lane[k];
    }
    return null;
  }

  function removeBlock(doc, i, block) {
    var lane = doc.lanes[i];
    var k = lane.indexOf(block);
    if (k >= 0) lane.splice(k, 1);
  }

  function duration(doc) {
    var max = 0;
    doc.lanes.forEach(function (l) { l.forEach(function (b) { if (b.e > max) max = b.e; }); });
    return max;
  }

  function isEmpty(doc) {
    return doc.lanes.every(function (l) { return l.length === 0; });
  }

  /* Render to raw channel bytes. */
  function toFrames(doc, frameCount, stepMs) {
    var n = CH.COUNT;
    var out = new Uint8Array(frameCount * n);
    var step = stepMs / 1000;
    for (var i = 0; i < n; i++) {
      var lane = doc.lanes[i];
      for (var k = 0; k < lane.length; k++) {
        var b = lane[k];
        var f0 = Math.max(0, Math.round(b.s / step));
        var f1 = Math.min(frameCount, Math.round(b.e / step));
        for (var f = f0; f < f1; f++) out[f * n + i] = b.v;
      }
    }
    return out;
  }

  /* Read raw channel bytes back into blocks (used when importing an .fseq). */
  function fromFrames(frames, channelCount, frameCount, stepMs) {
    var doc = create();
    var step = stepMs / 1000;
    var lanes = Math.min(channelCount, CH.COUNT);
    for (var i = 0; i < lanes; i++) {
      var runVal = 0, runStart = 0;
      for (var f = 0; f <= frameCount; f++) {
        var v = f < frameCount ? frames[f * channelCount + i] : 0;
        if (v !== runVal) {
          if (runVal !== 0) doc.lanes[i].push({ s: runStart * step, e: f * step, v: runVal });
          runVal = v; runStart = f;
        }
      }
    }
    return doc;
  }

  /* Value changes across the whole show — a rough measure of how busy it is. */
  function commandCount(doc) {
    var n = 0;
    doc.lanes.forEach(function (lane) {
      var last = 0;
      lane.forEach(function (b) {
        if (b.v !== last) n++;
        n++; // returning to off
        last = 0;
      });
    });
    return n;
  }

  /* Closure actuations, per Tesla's per-closure limits. */
  function closureUsage(doc) {
    var out = [];
    CH.CHANNELS.forEach(function (c) {
      if (c.kind !== 'closure') return;
      var used = doc.lanes[c.i].filter(function (b) {
        return b.v === CH.C.OPEN || b.v === CH.C.CLOSE || b.v === CH.C.DANCE;
      }).length;
      if (used) out.push({ ch: c, used: used, limit: c.limit, over: used > c.limit });
    });
    return out;
  }

  /* Flashes shorter than this are hard to see; Tesla suggests 100 ms. */
  function shortBlocks(doc, minS) {
    var n = 0;
    doc.lanes.forEach(function (lane, i) {
      if (i >= 30) return;
      lane.forEach(function (b) { if (b.e - b.s < minS) n++; });
    });
    return n;
  }

  function serialize(doc) {
    return doc.lanes.map(function (lane) {
      return lane.map(function (b) { return [Math.round(b.s * 1000), Math.round(b.e * 1000), b.v]; });
    });
  }

  function deserialize(arr) {
    var doc = create();
    (arr || []).forEach(function (lane, i) {
      if (i >= CH.COUNT) return;
      lane.forEach(function (b) { doc.lanes[i].push({ s: b[0] / 1000, e: b[1] / 1000, v: b[2] }); });
    });
    return doc;
  }

  root.TLS.doc = {
    create: create, clone: clone, add: add, clearRange: clearRange, clearLane: clearLane,
    blockAt: blockAt, removeBlock: removeBlock, duration: duration, isEmpty: isEmpty,
    toFrames: toFrames, fromFrames: fromFrames, commandCount: commandCount,
    closureUsage: closureUsage, shortBlocks: shortBlocks,
    serialize: serialize, deserialize: deserialize
  };
})(window);
