/* Light Show Desk — wiring. */
(function () {
  'use strict';

  var CH = TLS.channels, DOC = TLS.doc, FSEQ = TLS.fseq, AUD = TLS.audio,
      GEN = TLS.generator, ZIP = TLS.zip, TL = TLS.timeline;
  var L = CH.L, C = CH.C, G = CH.G;

  var $ = function (id) { return document.getElementById(id); };

  var state = {
    file: null,
    bytes: null,
    buffer: null,
    sniff: null,
    analysis: null,
    doc: DOC.create(),
    undo: [],
    redo: [],
    vals: new Uint8Array(CH.COUNT),
    duration: 0,
    lastTick: 0,
    dirty: false
  };

  var player = $('player');
  var stage = new TLS.stage.Stage($('stage'));
  var timeline = new TL.Timeline($('timeline'), {
    onSeek: function (t) { seek(t); },
    beginEdit: function () { pushUndo(); },
    onEdit: function () { afterEdit(); },
    onSelect: function () { updateStatus(); },
    onHover: function (info) { hoverReadout(info); },
    onLaneClick: function (ch) { flashLane(ch); }
  });

  /* ---------- helpers ---------- */

  function setStatus(msg) { $('status').textContent = msg; }

  function fmtBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  }

  function download(name, bytes, mime) {
    var blob = new Blob([bytes], { type: mime || 'application/octet-stream' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  function valuesAt(t) {
    var v = state.vals;
    v.fill(0);
    for (var i = 0; i < CH.COUNT; i++) {
      var lane = state.doc.lanes[i];
      for (var k = 0; k < lane.length; k++) {
        var b = lane[k];
        if (b.s > t) break;
        if (t < b.e) { v[i] = b.v; break; }
      }
    }
    return v;
  }

  /* ---------- undo ---------- */

  function pushUndo() {
    state.undo.push(DOC.serialize(state.doc));
    if (state.undo.length > 60) state.undo.shift();
    state.redo.length = 0;
    syncUndoButtons();
  }
  function undo() {
    if (!state.undo.length) return;
    state.redo.push(DOC.serialize(state.doc));
    state.doc = DOC.deserialize(state.undo.pop());
    timeline.doc = state.doc;
    afterEdit(true);
  }
  function redo() {
    if (!state.redo.length) return;
    state.undo.push(DOC.serialize(state.doc));
    state.doc = DOC.deserialize(state.redo.pop());
    timeline.doc = state.doc;
    afterEdit(true);
  }
  function syncUndoButtons() {
    $('btnUndo').disabled = !state.undo.length;
    $('btnRedo').disabled = !state.redo.length;
  }

  function afterEdit(skipPush) {
    timeline.needsDraw = true;
    syncUndoButtons();
    updateChecks();
    autosave();
  }

  /* ---------- loading audio ---------- */

  function showProgress(p, label) {
    var el = $('progress');
    el.hidden = false;
    $('progressFill').style.width = Math.round(p * 100) + '%';
    $('progressLabel').textContent = label;
    if (p >= 1) setTimeout(function () { el.hidden = true; }, 500);
  }

  async function loadFile(file) {
    try {
      setStatus('Reading ' + file.name);
      state.file = file;
      var buf = await file.arrayBuffer();
      state.bytes = new Uint8Array(buf);
      state.sniff = AUD.sniff(buf, file.name);

      showProgress(0.05, 'Decoding audio');
      state.buffer = await AUD.decode(buf);
      state.duration = state.buffer.duration;

      player.src = URL.createObjectURL(file);
      $('dropzone').classList.add('hide');

      state.analysis = await AUD.analyse(state.buffer, function (p, label) {
        showProgress(0.05 + p * 0.95, label);
      });

      timeline.analysis = state.analysis;
      timeline.duration = state.duration;
      timeline.doc = state.doc;
      timeline.fit();

      $('bpm').value = state.analysis.bpm.toFixed(1);
      $('beatOffset').value = state.analysis.beatOffset.toFixed(2);

      ['btnGenerate', 'btnReroll', 'btnPlay', 'btnStop', 'btnExport'].forEach(function (id) {
        $(id).disabled = false;
      });

      trackInfo();
      restoreAutosave(file.name);
      updateChecks();
      setStatus('Ready. Auto-build a show, or paint the lanes yourself.');
    } catch (err) {
      showProgress(1, '');
      setStatus('Could not read that file: ' + (err.message || err));
      $('dropzone').classList.remove('hide');
    }
  }

  function trackInfo() {
    var el = $('trackInfo');
    if (!state.file) { el.innerHTML = '<span class="empty">No song loaded</span>'; return; }
    var rate = state.sniff && state.sniff.sampleRate;
    var warn = rate && rate !== 44100;
    el.innerHTML = '';
    var name = document.createElement('span');
    name.className = 'name';
    name.textContent = state.file.name;
    el.appendChild(name);

    [
      TL.fmtTime(state.duration).replace(/\.\d+$/, ''),
      state.analysis ? state.analysis.bpm.toFixed(1) + ' BPM' : '',
      state.analysis ? state.analysis.bars.length + ' bars' : ''
    ].filter(Boolean).forEach(function (t) {
      var c = document.createElement('span');
      c.className = 'chip';
      c.textContent = t;
      el.appendChild(c);
    });

    var c2 = document.createElement('span');
    c2.className = 'chip' + (warn ? ' warn' : '');
    c2.textContent = rate ? (rate / 1000).toFixed(1) + ' kHz' : 'unknown rate';
    if (warn) c2.title = 'The car needs 44.1 kHz. Export will convert it to WAV.';
    el.appendChild(c2);
  }

  /* ---------- playback ---------- */

  function seek(t) {
    t = Math.max(0, Math.min(state.duration || 0, t));
    timeline.playhead = t;
    if (player.src) player.currentTime = t;
    timeline.needsDraw = true;
    updateTimeLabel();
  }

  function togglePlay() {
    if (!player.src) return;
    if (player.paused) {
      player.play();
      $('btnPlay').textContent = '❙❙';
    } else {
      player.pause();
      $('btnPlay').textContent = '▶';
    }
  }

  function updateTimeLabel() {
    $('time').textContent = TL.fmtTime(timeline.playhead);
  }

  player.addEventListener('ended', function () { $('btnPlay').textContent = '▶'; });

  /* ---------- frame loop ---------- */

  function tick(now) {
    var dt = state.lastTick ? (now - state.lastTick) / 1000 : 0;
    state.lastTick = now;

    if (player.src && !player.paused) {
      timeline.playhead = player.currentTime;
      timeline.scrollToPlayhead();
      timeline.needsDraw = true;
      updateTimeLabel();
    }
    stage.update(valuesAt(timeline.playhead), dt);
    stage.draw();
    if (timeline.needsDraw) timeline.draw();
    requestAnimationFrame(tick);
  }

  /* ---------- readouts ---------- */

  function hoverReadout(info) {
    if (!info) return;
    var ch = CH.CHANNELS[info.ch];
    var txt = '<b>' + (ch.side ? ch.side + ' ' : '') + ch.name + '</b> · channel ' + ch.n;
    if (ch.note) txt += '<br>' + ch.note;
    if (info.block) {
      txt += '<br>' + CH.valueLabel(info.ch, info.block.v) + ' · ' +
        (info.block.e - info.block.s).toFixed(2) + ' s';
    }
    if (ch.kind === 'closure') txt += '<br>Limit: ' + ch.limit + ' moves per show.';
    $('readout').innerHTML = txt;
  }

  function flashLane(i) {
    var ch = CH.CHANNELS[i];
    setStatus('Channel ' + ch.n + ' — ' + (ch.side ? ch.side + ' ' : '') + ch.name);
  }

  function updateStatus() {
    var s = timeline.selection;
    if (s) setStatus('Selected ' + (s.end - s.start).toFixed(2) + ' s · apply a pattern or press Delete');
    else setStatus('Space plays · Z undoes · Delete clears the selection');
  }

  /* ---------- checks ---------- */

  function updateChecks() {
    var box = $('checks');
    var out = [];
    var stepMs = parseInt($('expStep').value, 10) || 20;
    var blocks = state.doc.lanes.reduce(function (a, l) { return a + l.length; }, 0);

    if (!blocks) {
      box.innerHTML = '<span class="muted">Nothing programmed yet.</span>';
      return;
    }
    var frames = Math.ceil((state.duration || DOC.duration(state.doc)) * 1000 / stepMs);
    var size = 128 + frames * CH.COUNT;
    out.push('<span class="ok">' + blocks + ' blocks · ' + frames + ' frames · ' + fmtBytes(size) + ' .fseq</span>');

    if ((state.duration || 0) > 4 * 3600) out.push('<span class="bad">Longer than the 4 hour limit.</span>');

    DOC.closureUsage(state.doc).forEach(function (u) {
      var name = (u.ch.side ? u.ch.side + ' ' : '') + u.ch.name;
      if (u.over) out.push('<span class="bad">' + name + ': ' + u.used + ' moves, limit is ' + u.limit + '.</span>');
      else out.push('<span class="muted">' + name + ': ' + u.used + '/' + u.limit + ' moves</span>');
    });

    var short = DOC.shortBlocks(state.doc, 0.1);
    if (short > 0) out.push('<span class="warn">' + short + ' flashes under 100 ms — legal, but hard to see.</span>');

    if (state.sniff && state.sniff.sampleRate && state.sniff.sampleRate !== 44100) {
      out.push('<span class="warn">Audio is ' + (state.sniff.sampleRate / 1000).toFixed(1) +
        ' kHz. Export as WAV to get 44.1 kHz.</span>');
    } else if (state.sniff && !state.sniff.sampleRate) {
      out.push('<span class="warn">Sample rate unknown — export as WAV to be safe.</span>');
    }
    box.innerHTML = out.join('');
  }

  /* ---------- patterns applied to a selection ---------- */

  function beatsIn(a, b) {
    var beats = (state.analysis && state.analysis.beats) || [];
    var out = beats.filter(function (t) { return t >= a - 1e-6 && t < b; });
    if (out.length < 2) {
      var period = state.analysis ? state.analysis.beatPeriod : 0.5;
      out = [];
      for (var t = a; t < b; t += period) out.push(t);
    }
    return out;
  }

  var PALETTE = [
    { id: 'on', label: 'Front on', run: function (a, b, e) { e.group(G.frontAll, a, b); } },
    { id: 'all', label: 'Everything', run: function (a, b, e) { e.group(G.frontAll, a, b); e.group(G.rearAll, a, b); } },
    {
      id: 'pulse', label: 'Beat pulse',
      run: function (a, b, e, beats, per) {
        beats.forEach(function (t) { e.group(G.mains, t, t + per * 0.45); });
      }
    },
    {
      id: 'alt', label: 'Alternate L/R',
      run: function (a, b, e, beats, per) {
        beats.forEach(function (t, i) {
          e.group(i % 2 ? G.right : G.left, t, t + per * 0.45);
        });
      }
    },
    {
      id: 'chase', label: 'Chase',
      run: function (a, b, e, beats, per) {
        var seq = G.sweepFront, step = (b - a) / seq.length;
        seq.forEach(function (ch, i) { e.on(ch, a + i * step, a + i * step + step * 1.5); });
      }
    },
    {
      id: 'strobe8', label: 'Strobe ⅛',
      run: function (a, b, e, beats, per) {
        for (var t = a; t < b; t += per / 2) e.group(G.mains, t, t + per / 4);
      }
    },
    {
      id: 'strobe16', label: 'Strobe 1/16',
      run: function (a, b, e, beats, per) {
        for (var t = a; t < b; t += per / 4) e.group(G.mains.concat(G.signatures), t, t + per / 8);
      }
    },
    {
      id: 'sweep', label: 'Turn sweep',
      run: function (a, b, e) {
        var order = [G.frontTurns[0], G.markers[0], G.repeaters[0], G.repeaters[1], G.markers[1], G.frontTurns[1]];
        var step = (b - a) / order.length;
        order.forEach(function (ch, i) { e.on(ch, a + i * step, a + i * step + step * 1.4); });
      }
    },
    {
      id: 'fade', label: 'Fade up 1 s',
      run: function (a, b, e) {
        e.group(G.innerMains.concat(G.signatures), a, b, L.ON_1000);
      }
    },
    {
      id: 'breathe', label: 'Breathe 2 s',
      run: function (a, b, e) {
        var mid = a + (b - a) * 0.6;
        e.group(G.innerMains, a, mid, L.ON_2000);
        e.group(G.innerMains, mid, b, L.OFF_2000);
      }
    },
    { id: 'tails', label: 'Tails hold', run: function (a, b, e) { e.group(G.tails, a, b); } },
    {
      id: 'brake', label: 'Brake pulse',
      run: function (a, b, e, beats, per) {
        beats.forEach(function (t, i) { if (i % 2 === 0) e.group(G.brake, t, t + per * 0.5); });
      }
    }
  ];

  function applyPattern(p) {
    var sel = timeline.selection;
    if (!sel || sel.end - sel.start < 0.05) {
      setStatus('Select a range on the waveform first.');
      return;
    }
    pushUndo();
    var e = {
      on: function (ch, s, en, v) {
        s = Math.max(sel.start, s); en = Math.min(sel.end, en);
        if (en - s < 0.09) en = Math.min(sel.end, s + 0.09);
        if (en > s) DOC.add(state.doc, ch, s, en, v === undefined ? L.ON : v);
      },
      group: function (list, s, en, v) { list.forEach(function (ch) { e.on(ch, s, en, v); }); }
    };
    var beats = beatsIn(sel.start, sel.end);
    var per = state.analysis ? state.analysis.beatPeriod : 0.5;
    p.run(sel.start, sel.end, e, beats, per);
    afterEdit();
    setStatus('Applied ' + p.label.toLowerCase() + '.');
  }

  /* ---------- auto build ---------- */

  var seed = 1;
  function generate(reroll) {
    if (!state.analysis) return;
    if (reroll) seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    pushUndo();
    var sel = timeline.selection;
    var useSel = $('genSelection').checked && sel;
    var opts = {
      style: $('genStyle').value,
      intensity: parseInt($('genIntensity').value, 10) / 100,
      closures: $('genClosures').checked,
      seed: seed,
      from: useSel ? sel.start : 0,
      to: useSel ? sel.end : state.duration,
      doc: state.doc
    };
    state.doc = GEN.generate(state.analysis, opts);
    timeline.doc = state.doc;
    afterEdit();
    setStatus('Built a show at ' + state.analysis.bpm.toFixed(1) + ' BPM. Press ↻ for a different take.');
  }

  /* ---------- export ---------- */

  function buildFseq(stepMs, name) {
    var dur = Math.max(state.duration || 0, DOC.duration(state.doc));
    var frames = Math.max(1, Math.ceil(dur * 1000 / stepMs));
    var data = DOC.toFrames(state.doc, frames, stepMs);
    return FSEQ.encode({
      channelCount: CH.COUNT,
      frameCount: frames,
      stepMs: stepMs,
      frames: data,
      mediaFile: name
    });
  }

  function audioNameFor(mode, baseName) {
    var keepable = state.sniff && ['mp3', 'wav'].indexOf(state.sniff.container) >= 0 &&
                   state.sniff.sampleRate === 44100;
    return (mode === 'original' && keepable)
      ? baseName + '.' + state.sniff.container
      : baseName + '.wav';
  }

  function audioForExport(mode, baseName) {
    var keepable = state.sniff && ['mp3', 'wav'].indexOf(state.sniff.container) >= 0 &&
                   state.sniff.sampleRate === 44100;
    if (mode === 'original' && keepable) {
      return { name: baseName + '.' + state.sniff.container, data: state.bytes };
    }
    return { name: baseName + '.wav', data: AUD.toWav(state.buffer) };
  }

  function openExport() {
    if (!state.buffer) return;
    var base = (state.file.name || 'lightshow').replace(/\.[^.]+$/, '').replace(/[^\w\-]+/g, '_').slice(0, 40);
    if ($('expName').value === 'lightshow' || !$('expName').value) $('expName').value = base || 'lightshow';
    if (state.sniff && (state.sniff.sampleRate !== 44100 || ['mp3', 'wav'].indexOf(state.sniff.container) < 0)) {
      $('expAudio').value = 'wav';
    }
    refreshExportSummary();
    $('exportDialog').hidden = false;
  }

  function refreshExportSummary() {
    if (!state.buffer) return null;
    var stepMs = parseInt($('expStep').value, 10) || 20;
    var name = ($('expName').value || 'lightshow').trim();
    var bytes = buildFseq(stepMs, name + (($('expAudio').value === 'wav') ? '.wav' : '.' + (state.sniff && state.sniff.container || 'mp3')));
    var parsed = FSEQ.parse(bytes);
    var check = FSEQ.validate(parsed.header);
    var lines = [];
    lines.push('FSEQ v2.0 uncompressed · 48 channels · ' + stepMs + ' ms');
    lines.push(parsed.header.frameCount + ' frames · ' + TL.fmtTime(check.durationS).replace(/\.\d+$/, '') + ' · ' + fmtBytes(bytes.length));
    var audioName = ($('expAudio').value === 'wav')
      ? name + '.wav (' + fmtBytes(state.buffer.length * Math.min(2, state.buffer.numberOfChannels) * 2 + 44) + ')'
      : name + '.' + (state.sniff && state.sniff.container || 'mp3') + ' (' + fmtBytes(state.bytes.length) + ')';
    lines.push('LightShow/' + name + '.fseq + LightShow/' + audioName);
    check.errors.forEach(function (e) { lines.push('<span class="bad">' + e + '</span>'); });
    check.warnings.forEach(function (w) { lines.push('<span class="warn">' + w + '</span>'); });
    if (check.ok && !check.errors.length) lines.push('<span class="ok">Passes Tesla\'s validator checks.</span>');
    $('expSummary').innerHTML = lines.join('<br>');
    return { bytes: bytes, name: name, stepMs: stepMs };
  }

  function exportZip() {
    if (!state.buffer) return;
    var name = ($('expName').value || 'lightshow').trim();
    var audio = audioForExport($('expAudio').value, name);
    var fseq = buildFseq(parseInt($('expStep').value, 10) || 20, audio.name);
    var zip = ZIP.build([
      { name: 'LightShow/', dir: true },
      { name: 'LightShow/' + name + '.fseq', data: fseq },
      { name: 'LightShow/' + audio.name, data: audio.data }
    ]);
    download(name + '_LightShow.zip', zip, 'application/zip');
    setStatus('Downloaded ' + name + '_LightShow.zip — unzip it onto the USB stick.');
    $('exportDialog').hidden = true;
  }

  function exportFseq() {
    if (!state.buffer) return;
    var name = ($('expName').value || 'lightshow').trim();
    var mediaName = audioNameFor($('expAudio').value, name);
    download(name + '.fseq', buildFseq(parseInt($('expStep').value, 10) || 20, mediaName));
    setStatus('Downloaded ' + name + '.fseq. The audio file must share the same name.');
  }

  /* ---------- project files ---------- */

  function projectJson() {
    return JSON.stringify({
      app: 'tesla-light-show-desk',
      version: 1,
      audioName: state.file ? state.file.name : '',
      bpm: state.analysis ? state.analysis.bpm : null,
      beatOffset: state.analysis ? state.analysis.beatOffset : null,
      lanes: DOC.serialize(state.doc)
    });
  }

  function loadProjectText(text) {
    var data = JSON.parse(text);
    pushUndo();
    state.doc = DOC.deserialize(data.lanes);
    timeline.doc = state.doc;
    if (state.analysis && data.bpm) {
      AUD.regrid(state.analysis, data.bpm, data.beatOffset || 0);
      $('bpm').value = data.bpm.toFixed(1);
      $('beatOffset').value = (data.beatOffset || 0).toFixed(2);
    }
    afterEdit();
    setStatus('Loaded project' + (data.audioName ? ' for ' + data.audioName : '') + '.');
  }

  var saveTimer = null;
  function autosave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try { localStorage.setItem('tls.autosave', projectJson()); } catch (e) {}
    }, 800);
  }

  function restoreAutosave(fileName) {
    try {
      var raw = localStorage.getItem('tls.autosave');
      if (!raw) return;
      var data = JSON.parse(raw);
      if (data.audioName !== fileName) return;
      var count = (data.lanes || []).reduce(function (a, l) { return a + l.length; }, 0);
      if (!count) return;
      state.doc = DOC.deserialize(data.lanes);
      timeline.doc = state.doc;
      if (data.bpm) {
        AUD.regrid(state.analysis, data.bpm, data.beatOffset || 0);
        $('bpm').value = data.bpm.toFixed(1);
        $('beatOffset').value = (data.beatOffset || 0).toFixed(2);
      }
      setStatus('Picked up where you left off — ' + count + ' blocks restored.');
    } catch (e) {}
  }

  /* ---------- ui wiring ---------- */

  function buildChips() {
    var lightBox = $('lightValues');
    [
      [L.ON, 'On', 'Instant on'],
      [L.ON_500, '↗ 0.5', 'Fade on over 0.5 s'],
      [L.ON_1000, '↗ 1', 'Fade on over 1 s'],
      [L.ON_2000, '↗ 2', 'Fade on over 2 s'],
      [L.OFF_500, '↘ 0.5', 'Fade off over 0.5 s'],
      [L.OFF_1000, '↘ 1', 'Fade off over 1 s'],
      [L.OFF_2000, '↘ 2', 'Fade off over 2 s']
    ].forEach(function (v) {
      var b = document.createElement('button');
      b.className = 'chip-btn' + (v[0] === L.ON ? ' on' : '');
      b.textContent = v[1];
      b.title = v[2];
      b.onclick = function () {
        timeline.paintLight = v[0];
        Array.prototype.forEach.call(lightBox.children, function (c) { c.classList.remove('on'); });
        b.classList.add('on');
      };
      lightBox.appendChild(b);
    });

    var closureBox = $('closureValues');
    [[C.OPEN, 'Open'], [C.DANCE, 'Dance'], [C.CLOSE, 'Close'], [C.STOP, 'Stop']].forEach(function (v) {
      var b = document.createElement('button');
      b.className = 'chip-btn' + (v[0] === C.OPEN ? ' on' : '');
      b.textContent = v[1];
      b.title = 'Closure lanes only';
      b.onclick = function () {
        timeline.paintClosure = v[0];
        Array.prototype.forEach.call(closureBox.children, function (c) { c.classList.remove('on'); });
        b.classList.add('on');
      };
      closureBox.appendChild(b);
    });

    var pat = $('patternButtons');
    PALETTE.forEach(function (p) {
      var b = document.createElement('button');
      b.className = 'chip-btn';
      b.textContent = p.label;
      b.onclick = function () { applyPattern(p); };
      pat.appendChild(b);
    });
  }

  function wire() {
    $('btnOpen').onclick = $('btnOpen2').onclick = function () { $('fileAudio').click(); };
    $('fileAudio').onchange = function (e) { if (e.target.files[0]) loadFile(e.target.files[0]); };

    var dz = $('dropzone');
    ['dragenter', 'dragover'].forEach(function (ev) {
      document.addEventListener(ev, function (e) {
        e.preventDefault();
        dz.classList.remove('hide');
        dz.classList.add('over');
      });
    });
    document.addEventListener('dragleave', function (e) {
      if (e.relatedTarget) return;
      dz.classList.remove('over');
      if (state.buffer) dz.classList.add('hide');
    });
    document.addEventListener('drop', function (e) {
      e.preventDefault();
      dz.classList.remove('over');
      var f = e.dataTransfer.files[0];
      if (!f) { if (state.buffer) dz.classList.add('hide'); return; }
      if (/\.(json|tlsd)$/i.test(f.name)) {
        f.text().then(loadProjectText);
        if (state.buffer) dz.classList.add('hide');
      } else {
        loadFile(f);
      }
    });

    $('btnPlay').onclick = togglePlay;
    $('btnStop').onclick = function () { player.pause(); $('btnPlay').textContent = '▶'; seek(0); };
    $('btnUndo').onclick = undo;
    $('btnRedo').onclick = redo;
    $('btnZoomIn').onclick = function () { timeline.zoomAt(timeline.timeToX(timeline.playhead), 1.4); };
    $('btnZoomOut').onclick = function () { timeline.zoomAt(timeline.timeToX(timeline.playhead), 1 / 1.4); };
    $('btnFit').onclick = function () { timeline.fit(); };

    $('btnGenerate').onclick = function () { generate(false); };
    $('btnReroll').onclick = function () { generate(true); };
    $('btnClearRange').onclick = function () {
      var sel = timeline.selection;
      if (!sel) { setStatus('Select a range first.'); return; }
      pushUndo();
      DOC.clearRange(state.doc, G.lightsAll.concat(G.closuresAll), sel.start, sel.end);
      afterEdit();
    };

    $('snap').onchange = function () { timeline.snap = this.value; };
    function regrid() {
      if (!state.analysis) return;
      var bpm = parseFloat($('bpm').value) || state.analysis.bpm;
      var off = parseFloat($('beatOffset').value) || 0;
      AUD.regrid(state.analysis, bpm, off);
      timeline.needsDraw = true;
      trackInfo();
    }
    $('bpm').onchange = regrid;
    $('beatOffset').onchange = regrid;
    function scaleTempo(mult) {
      if (!state.analysis) return;
      var bpm = (parseFloat($('bpm').value) || state.analysis.bpm) * mult;
      if (bpm < 40 || bpm > 220) { setStatus('That would put the tempo outside 40–220 BPM.'); return; }
      $('bpm').value = bpm.toFixed(1);
      regrid();
      setStatus('Grid set to ' + bpm.toFixed(1) + ' BPM. Rebuild the show to use it.');
    }
    function nudge(ms) {
      if (!state.analysis) return;
      var off = (parseFloat($('beatOffset').value) || 0) + ms / 1000;
      $('beatOffset').value = Math.max(0, off).toFixed(3);
      regrid();
    }
    $('btnHalf').onclick = function () { scaleTempo(0.5); };
    $('btnDouble').onclick = function () { scaleTempo(2); };
    $('btnNudgeBack').onclick = function () { nudge(-10); };
    $('btnNudgeFwd').onclick = function () { nudge(10); };

    $('btnExport').onclick = openExport;
    $('btnCloseExport').onclick = function () { $('exportDialog').hidden = true; };
    $('btnZip').onclick = exportZip;
    $('btnFseqOnly').onclick = exportFseq;
    $('expStep').onchange = function () { refreshExportSummary(); updateChecks(); };
    $('expAudio').onchange = refreshExportSummary;
    $('expName').oninput = refreshExportSummary;

    $('btnProject').onclick = function () { $('projectDialog').hidden = false; };
    $('btnCloseProject').onclick = function () { $('projectDialog').hidden = true; };
    $('btnSaveProject').onclick = function () {
      var name = (state.file ? state.file.name.replace(/\.[^.]+$/, '') : 'show') + '.tlsd.json';
      download(name, new TextEncoder().encode(projectJson()), 'application/json');
      $('projectDialog').hidden = true;
    };
    $('btnLoadProject').onclick = function () { $('fileProject').click(); };
    $('fileProject').onchange = function (e) {
      var f = e.target.files[0];
      if (f) f.text().then(loadProjectText).catch(function () { setStatus('That project file could not be read.'); });
      $('projectDialog').hidden = true;
    };

    document.addEventListener('keydown', function (e) {
      var tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
      if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
      else if (e.key === 'z' && !e.ctrlKey && !e.metaKey) undo();
      else if ((e.key === 'z' || e.key === 'Z') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      else if (e.key === 'y' && (e.ctrlKey || e.metaKey)) redo();
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); $('btnClearRange').click(); }
      else if (e.key === 'ArrowLeft') seek(timeline.playhead - (e.shiftKey ? 5 : 1));
      else if (e.key === 'ArrowRight') seek(timeline.playhead + (e.shiftKey ? 5 : 1));
      else if (e.key === '+' || e.key === '=') $('btnZoomIn').click();
      else if (e.key === '-') $('btnZoomOut').click();
      else if (e.key === 'Escape') { $('exportDialog').hidden = true; $('projectDialog').hidden = true; }
    });

    window.addEventListener('resize', function () {
      stage.resize();
      timeline.resize();
    });
  }

  buildChips();
  wire();
  timeline.doc = state.doc;
  updateTimeLabel();
  requestAnimationFrame(tick);
})();
