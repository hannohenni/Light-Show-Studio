/* Tesla Light Show Desk — channel map
 *
 * Channel order is taken from Tesla's own xLights show folder
 * (xlights_rgbeffects.xml, "Model S" controller, 1-based start channels) and
 * verified against the official example .fseq files in teslamotors/light-show.
 *
 * Channels 1..46 carry lights and closures. 47 and 48 exist only to pad the
 * file to the 48-channel size the vehicle expects.
 */
(function (root) {
  'use strict';

  // Light values. Anything a car can't ramp treats >50% as ON.
  var L = {
    OFF: 0,
    OFF_500: 25,   // 10%  fade out over 0.5 s
    OFF_1000: 51,  // 20%  fade out over 1 s
    OFF_2000: 76,  // 30%  fade out over 2 s
    ON_500: 178,   // 70%  fade in over 0.5 s
    ON_1000: 204,  // 80%  fade in over 1 s
    ON_2000: 229,  // 90%  fade in over 2 s
    ON: 255        // 100% instant
  };

  // Closure values.
  var C = {
    IDLE: 0,
    OPEN: 63,    // 25%
    DANCE: 127,  // 50%
    CLOSE: 191,  // 75%
    STOP: 255    // 100%
  };

  // Lamp colours: what the light actually looks like on the car.
  var WHITE = '#e8f1ff';
  var AMBER = '#ffae2b';
  var RED = '#ff3b46';
  var REVERSE = '#fff4d8';
  var MOTION = '#5fd3ff'; // closures aren't lamps; they get the "movement" hue

  function ch(n, id, name, side, area, kind, color, opts) {
    opts = opts || {};
    return {
      n: n, i: n - 1, id: id, name: name, side: side, area: area,
      kind: kind, color: color,
      ramp: !!opts.ramp,
      pair: opts.pair || null,
      openS: opts.openS || 0,
      closeS: opts.closeS || 0,
      limit: opts.limit || 0,
      dance: !!opts.dance,
      note: opts.note || ''
    };
  }

  var CLOSURE_LIMITS = {
    liftgate: 6, mirrors: 20, chargePort: 3, windows: 6,
    handles: 20, frontDoors: 6, falconDoors: 6
  };

  var CHANNELS = [
    // ---- front lights ----
    ch(1, 'l_outer_main', 'Outer main beam', 'L', 'front', 'light', WHITE, { ramp: true, pair: 2 }),
    ch(2, 'r_outer_main', 'Outer main beam', 'R', 'front', 'light', WHITE, { ramp: true, pair: 1 }),
    ch(3, 'l_inner_main', 'Inner main beam', 'L', 'front', 'light', WHITE, { ramp: true, pair: 4 }),
    ch(4, 'r_inner_main', 'Inner main beam', 'R', 'front', 'light', WHITE, { ramp: true, pair: 3 }),
    ch(5, 'l_signature', 'Signature', 'L', 'front', 'light', WHITE, { ramp: true, pair: 6 }),
    ch(6, 'r_signature', 'Signature', 'R', 'front', 'light', WHITE, { ramp: true, pair: 5 }),
    ch(7, 'l_ch4', 'Channel 4', 'L', 'front', 'light', WHITE, { ramp: true, pair: 8, note: 'Sets the ramp speed for channels 4–6' }),
    ch(8, 'r_ch4', 'Channel 4', 'R', 'front', 'light', WHITE, { ramp: true, pair: 7, note: 'Sets the ramp speed for channels 4–6' }),
    ch(9, 'l_ch5', 'Channel 5', 'L', 'front', 'light', WHITE, { ramp: true, pair: 10 }),
    ch(10, 'r_ch5', 'Channel 5', 'R', 'front', 'light', WHITE, { ramp: true, pair: 9 }),
    ch(11, 'l_ch6', 'Channel 6', 'L', 'front', 'light', WHITE, { ramp: true, pair: 12 }),
    ch(12, 'r_ch6', 'Channel 6', 'R', 'front', 'light', WHITE, { ramp: true, pair: 11 }),
    ch(13, 'l_front_turn', 'Front turn', 'L', 'front', 'light', AMBER, { ramp: true, pair: 14 }),
    ch(14, 'r_front_turn', 'Front turn', 'R', 'front', 'light', AMBER, { ramp: true, pair: 13 }),
    ch(15, 'l_front_fog', 'Front fog', 'L', 'front', 'light', WHITE, { pair: 16 }),
    ch(16, 'r_front_fog', 'Front fog', 'R', 'front', 'light', WHITE, { pair: 15 }),
    ch(17, 'l_aux_park', 'Aux park', 'L', 'front', 'light', WHITE, { pair: 18 }),
    ch(18, 'r_aux_park', 'Aux park', 'R', 'front', 'light', WHITE, { pair: 17 }),
    ch(19, 'l_side_marker', 'Side marker', 'L', 'front', 'light', AMBER, { pair: 20 }),
    ch(20, 'r_side_marker', 'Side marker', 'R', 'front', 'light', AMBER, { pair: 19 }),
    ch(21, 'l_repeater', 'Side repeater', 'L', 'front', 'light', AMBER, { pair: 22 }),
    ch(22, 'r_repeater', 'Side repeater', 'R', 'front', 'light', AMBER, { pair: 21 }),

    // ---- rear lights ----
    ch(23, 'l_rear_turn', 'Rear turn', 'L', 'rear', 'light', AMBER, { pair: 24 }),
    ch(24, 'r_rear_turn', 'Rear turn', 'R', 'rear', 'light', AMBER, { pair: 23 }),
    ch(25, 'brake', 'Brake lights', '', 'rear', 'light', RED, {}),
    ch(26, 'l_tail', 'Tail', 'L', 'rear', 'light', RED, { pair: 27 }),
    ch(27, 'r_tail', 'Tail', 'R', 'rear', 'light', RED, { pair: 26 }),
    ch(28, 'reverse', 'Reverse lights', '', 'rear', 'light', REVERSE, {}),
    ch(29, 'rear_fog', 'Rear fog', '', 'rear', 'light', RED, { note: 'Not fitted on most North American cars' }),
    ch(30, 'plate', 'License plate', '', 'rear', 'light', REVERSE, {}),

    // ---- closures ----
    ch(31, 'l_falcon', 'Falcon door', 'L', 'closure', 'closure', MOTION, { pair: 32, openS: 20, closeS: 8, limit: 6, dance: true, note: 'Model X' }),
    ch(32, 'r_falcon', 'Falcon door', 'R', 'closure', 'closure', MOTION, { pair: 31, openS: 20, closeS: 8, limit: 6, dance: true, note: 'Model X' }),
    ch(33, 'l_front_door', 'Front door', 'L', 'closure', 'closure', MOTION, { pair: 34, openS: 22, closeS: 3, limit: 6, note: 'Model X' }),
    ch(34, 'r_front_door', 'Front door', 'R', 'closure', 'closure', MOTION, { pair: 33, openS: 22, closeS: 3, limit: 6, note: 'Model X' }),
    ch(35, 'l_mirror', 'Mirror', 'L', 'closure', 'closure', MOTION, { pair: 36, openS: 2, closeS: 2, limit: 20 }),
    ch(36, 'r_mirror', 'Mirror', 'R', 'closure', 'closure', MOTION, { pair: 35, openS: 2, closeS: 2, limit: 20 }),
    ch(37, 'l_front_window', 'Front window', 'L', 'closure', 'closure', MOTION, { pair: 39, openS: 4, closeS: 4, limit: 6, dance: true }),
    ch(38, 'l_rear_window', 'Rear window', 'L', 'closure', 'closure', MOTION, { pair: 40, openS: 4, closeS: 4, limit: 6, dance: true }),
    ch(39, 'r_front_window', 'Front window', 'R', 'closure', 'closure', MOTION, { pair: 37, openS: 4, closeS: 4, limit: 6, dance: true }),
    ch(40, 'r_rear_window', 'Rear window', 'R', 'closure', 'closure', MOTION, { pair: 38, openS: 4, closeS: 4, limit: 6, dance: true }),
    ch(41, 'liftgate', 'Liftgate', '', 'closure', 'closure', MOTION, { openS: 14, closeS: 4, limit: 6, dance: true, note: 'Frunk on Cybertruck' }),
    ch(42, 'lf_handle', 'Front door handle', 'L', 'closure', 'closure', MOTION, { pair: 44, openS: 2, closeS: 2, limit: 20, note: 'Model S' }),
    ch(43, 'lr_handle', 'Rear door handle', 'L', 'closure', 'closure', MOTION, { pair: 45, openS: 2, closeS: 2, limit: 20, note: 'Model S' }),
    ch(44, 'rf_handle', 'Front door handle', 'R', 'closure', 'closure', MOTION, { pair: 42, openS: 2, closeS: 2, limit: 20, note: 'Model S' }),
    ch(45, 'rr_handle', 'Rear door handle', 'R', 'closure', 'closure', MOTION, { pair: 43, openS: 2, closeS: 2, limit: 20, note: 'Model S' }),
    ch(46, 'charge_port', 'Charge port', '', 'closure', 'closure', MOTION, { openS: 2, closeS: 2, limit: 3, dance: true })
  ];

  var BY_ID = {};
  CHANNELS.forEach(function (c) { BY_ID[c.id] = c; });

  function idx(ids) { return ids.map(function (id) { return BY_ID[id].i; }); }

  // Named groups used by the pattern palette and the show generator.
  var G = {
    outerMains: idx(['l_outer_main', 'r_outer_main']),
    innerMains: idx(['l_inner_main', 'r_inner_main']),
    mains: idx(['l_outer_main', 'r_outer_main', 'l_inner_main', 'r_inner_main']),
    signatures: idx(['l_signature', 'r_signature']),
    ch456: idx(['l_ch4', 'r_ch4', 'l_ch5', 'r_ch5', 'l_ch6', 'r_ch6']),
    ch4: idx(['l_ch4', 'r_ch4']),
    frontTurns: idx(['l_front_turn', 'r_front_turn']),
    fogs: idx(['l_front_fog', 'r_front_fog']),
    auxPark: idx(['l_aux_park', 'r_aux_park']),
    markers: idx(['l_side_marker', 'r_side_marker']),
    repeaters: idx(['l_repeater', 'r_repeater']),
    rearTurns: idx(['l_rear_turn', 'r_rear_turn']),
    tails: idx(['l_tail', 'r_tail']),
    brake: idx(['brake']),
    reverse: idx(['reverse']),
    plate: idx(['plate']),
    left: idx(['l_outer_main', 'l_inner_main', 'l_signature', 'l_ch4', 'l_ch5', 'l_ch6', 'l_front_turn', 'l_front_fog', 'l_aux_park', 'l_side_marker', 'l_repeater']),
    right: idx(['r_outer_main', 'r_inner_main', 'r_signature', 'r_ch4', 'r_ch5', 'r_ch6', 'r_front_turn', 'r_front_fog', 'r_aux_park', 'r_side_marker', 'r_repeater']),
    frontAll: CHANNELS.filter(function (c) { return c.area === 'front'; }).map(function (c) { return c.i; }),
    rearAll: CHANNELS.filter(function (c) { return c.area === 'rear'; }).map(function (c) { return c.i; }),
    lightsAll: CHANNELS.filter(function (c) { return c.kind === 'light'; }).map(function (c) { return c.i; }),
    closuresAll: CHANNELS.filter(function (c) { return c.kind === 'closure'; }).map(function (c) { return c.i; }),
    mirrors: idx(['l_mirror', 'r_mirror']),
    windows: idx(['l_front_window', 'r_front_window', 'l_rear_window', 'r_rear_window']),
    frontWindows: idx(['l_front_window', 'r_front_window']),
    handles: idx(['lf_handle', 'rf_handle', 'lr_handle', 'rr_handle']),
    liftgate: idx(['liftgate']),
    chargePort: idx(['charge_port']),
    falcon: idx(['l_falcon', 'r_falcon'])
  };

  // A left-to-right sweep order across the front of the car.
  G.sweepFront = [
    BY_ID.l_repeater.i, BY_ID.l_side_marker.i, BY_ID.l_outer_main.i, BY_ID.l_ch4.i,
    BY_ID.l_inner_main.i, BY_ID.l_signature.i,
    BY_ID.r_signature.i, BY_ID.r_inner_main.i, BY_ID.r_ch4.i, BY_ID.r_outer_main.i,
    BY_ID.r_side_marker.i, BY_ID.r_repeater.i
  ];

  // Section headers in the timeline.
  var SECTIONS = [
    { id: 'front', label: 'Front lights', from: 0, to: 21 },
    { id: 'rear', label: 'Rear lights', from: 22, to: 29 },
    { id: 'closure', label: 'Closures', from: 30, to: 45 }
  ];

  root.TLS = root.TLS || {};
  root.TLS.channels = {
    CHANNELS: CHANNELS,
    COUNT: 48,
    USED: 46,
    BY_ID: BY_ID,
    G: G,
    L: L,
    C: C,
    SECTIONS: SECTIONS,
    CLOSURE_LIMITS: CLOSURE_LIMITS,
    get: function (i) { return CHANNELS[i]; },
    isClosure: function (i) { return i >= 30 && i <= 45; },
    // Human-readable name for a stored byte value.
    valueLabel: function (i, v) {
      if (i >= 30) {
        if (v === C.OPEN) return 'Open';
        if (v === C.DANCE) return 'Dance';
        if (v === C.CLOSE) return 'Close';
        if (v === C.STOP) return 'Stop';
        return 'Idle';
      }
      if (v === L.ON) return 'On';
      if (v === L.ON_500) return 'Fade on 0.5s';
      if (v === L.ON_1000) return 'Fade on 1s';
      if (v === L.ON_2000) return 'Fade on 2s';
      if (v === L.OFF_500) return 'Fade off 0.5s';
      if (v === L.OFF_1000) return 'Fade off 1s';
      if (v === L.OFF_2000) return 'Fade off 2s';
      return 'Off';
    }
  };
})(window);
