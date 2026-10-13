/* FSEQ v2.0 (uncompressed) reader + writer.
 *
 * Layout, confirmed against xLights output shipped by Tesla:
 *   0   'PSEQ'
 *   4   uint16  offset to channel data
 *   6   uint8   minor version (0)
 *   7   uint8   major version (2)
 *   8   uint16  length of the fixed header (32)
 *   10  uint32  channels per frame
 *   14  uint32  frame count
 *   18  uint8   step time in ms
 *   19  uint8   flags
 *   20  uint8   compression type (0 = none)
 *   21  uint8   compression block count
 *   22  uint8   sparse range count
 *   23  uint8   flags 2
 *   24  uint64  unique id (creation time in microseconds)
 *   32  variable headers: uint16 length (incl. these 4 bytes), 2 char code,
 *       null-terminated value. Zero padded to a 4 byte boundary.
 *   ..  frame data: frameCount * channelCount bytes, one byte per channel
 */
(function (root) {
  'use strict';

  var MAGIC = [0x50, 0x53, 0x45, 0x51]; // PSEQ
  var FIXED_HEADER = 32;

  function strBytes(s) {
    var out = [];
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c < 128) out.push(c);
      else out.push(63); // '?' — xLights writes plain ASCII here
    }
    return out;
  }

  /* Build the file. `frames` is one byte per channel per frame. */
  function encode(opts) {
    var channelCount = opts.channelCount || 48;
    var frameCount = opts.frameCount;
    var stepMs = opts.stepMs || 20;
    var frames = opts.frames;

    var vars = [];
    if (opts.mediaFile) vars.push(['mf', opts.mediaFile]);
    vars.push(['sp', opts.producer || 'Tesla Light Show Desk']);

    var varBytes = [];
    vars.forEach(function (v) {
      var data = strBytes(v[1]).concat([0]);
      var len = 4 + data.length;
      varBytes.push(len & 0xff, (len >> 8) & 0xff, v[0].charCodeAt(0), v[0].charCodeAt(1));
      varBytes = varBytes.concat(data);
    });

    var dataOffset = FIXED_HEADER + varBytes.length;
    dataOffset = Math.ceil(dataOffset / 4) * 4; // pad to 4 bytes

    var total = dataOffset + frameCount * channelCount;
    var buf = new Uint8Array(total);
    var dv = new DataView(buf.buffer);

    buf.set(MAGIC, 0);
    dv.setUint16(4, dataOffset, true);
    buf[6] = 0;  // minor
    buf[7] = 2;  // major
    dv.setUint16(8, FIXED_HEADER, true);
    dv.setUint32(10, channelCount, true);
    dv.setUint32(14, frameCount, true);
    buf[18] = stepMs;
    buf[19] = 0;
    buf[20] = 0; // uncompressed
    buf[21] = 0;
    buf[22] = 0;
    buf[23] = 0;

    var micros = BigInt(Date.now()) * 1000n;
    dv.setBigUint64(24, micros, true);

    buf.set(varBytes, FIXED_HEADER);
    buf.set(frames.subarray(0, frameCount * channelCount), dataOffset);
    return buf;
  }

  function parse(bytes) {
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (var i = 0; i < 4; i++) {
      if (bytes[i] !== MAGIC[i]) throw new Error('Not an .fseq file (missing PSEQ marker).');
    }
    var dataOffset = dv.getUint16(4, true);
    var header = {
      dataOffset: dataOffset,
      minor: bytes[6],
      major: bytes[7],
      channelCount: dv.getUint32(10, true),
      frameCount: dv.getUint32(14, true),
      stepMs: bytes[18],
      compression: bytes[20] & 0x0f,
      mediaFile: ''
    };
    var off = FIXED_HEADER;
    while (off + 4 <= dataOffset) {
      var len = dv.getUint16(off, true);
      if (len < 5 || off + len > dataOffset) break;
      var code = String.fromCharCode(bytes[off + 2], bytes[off + 3]);
      var val = '';
      for (var j = off + 4; j < off + len && bytes[j] !== 0; j++) val += String.fromCharCode(bytes[j]);
      if (code === 'mf') header.mediaFile = val;
      off += len;
    }
    if (header.compression !== 0) throw new Error('This file is compressed. Tesla needs "V2 Uncompressed".');
    var need = header.frameCount * header.channelCount;
    var frames = bytes.subarray(dataOffset, dataOffset + need);
    if (frames.length < need) throw new Error('The file ends early — it looks truncated.');
    header.durationS = header.frameCount * header.stepMs / 1000;
    return { header: header, frames: frames };
  }

  /* The same checks Tesla's validator.py runs, plus friendlier wording. */
  function validate(header) {
    var errors = [], warnings = [];
    if (header.dataOffset < 24 || header.frameCount < 1) errors.push('Header is malformed.');
    if (header.major !== 2 || (header.minor !== 0 && header.minor !== 2)) {
      warnings.push('FSEQ version ' + header.major + '.' + header.minor + '. Only 2.0 and 2.2 are validated by Tesla.');
    }
    if (header.compression !== 0) errors.push('Compression must be off (V2 Uncompressed).');
    if (header.channelCount !== 48 && header.channelCount !== 200) {
      errors.push('Channel count is ' + header.channelCount + '. The car accepts 48 or 200.');
    }
    if (header.stepMs < 15) errors.push('Step time is ' + header.stepMs + ' ms. The minimum is 15 ms.');
    if (header.stepMs > 100) warnings.push('Step time is ' + header.stepMs + ' ms. Above 100 ms is outside the supported range.');
    var dur = header.frameCount * header.stepMs / 1000;
    if (dur > 4 * 3600) errors.push('Show is longer than the 4 hour maximum.');
    return { ok: errors.length === 0, errors: errors, warnings: warnings, durationS: dur };
  }

  root.TLS = root.TLS || {};
  root.TLS.fseq = { encode: encode, parse: parse, validate: validate, FIXED_HEADER: FIXED_HEADER };
})(window);
