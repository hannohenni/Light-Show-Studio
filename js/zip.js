/* Tiny ZIP writer (stored, no compression).
 * Enough to hand back a LightShow folder that unzips straight onto a USB stick.
 */
(function (root) {
  'use strict';

  var TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    var c = 0xffffffff;
    for (var i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function dosTime(d) {
    return ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() / 2)) & 0xffff;
  }
  function dosDate(d) {
    return (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff;
  }

  function utf8(s) {
    var out = [];
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return new Uint8Array(out);
  }

  /* files: [{ name: 'LightShow/show.fseq', data: Uint8Array, dir: false }] */
  function build(files) {
    var now = new Date();
    var time = dosTime(now), date = dosDate(now);
    var parts = [], central = [], offset = 0;

    files.forEach(function (f) {
      var name = utf8(f.name);
      var data = f.dir ? new Uint8Array(0) : f.data;
      var crc = f.dir ? 0 : crc32(data);

      var local = new Uint8Array(30 + name.length);
      var dv = new DataView(local.buffer);
      dv.setUint32(0, 0x04034b50, true);
      dv.setUint16(4, 20, true);          // version needed
      dv.setUint16(6, 0x0800, true);      // UTF-8 names
      dv.setUint16(8, 0, true);           // stored
      dv.setUint16(10, time, true);
      dv.setUint16(12, date, true);
      dv.setUint32(14, crc, true);
      dv.setUint32(18, data.length, true);
      dv.setUint32(22, data.length, true);
      dv.setUint16(26, name.length, true);
      dv.setUint16(28, 0, true);
      local.set(name, 30);

      parts.push(local);
      if (data.length) parts.push(data);

      var cen = new Uint8Array(46 + name.length);
      var cdv = new DataView(cen.buffer);
      cdv.setUint32(0, 0x02014b50, true);
      cdv.setUint16(4, 20, true);
      cdv.setUint16(6, 20, true);
      cdv.setUint16(8, 0x0800, true);
      cdv.setUint16(10, 0, true);
      cdv.setUint16(12, time, true);
      cdv.setUint16(14, date, true);
      cdv.setUint32(16, crc, true);
      cdv.setUint32(20, data.length, true);
      cdv.setUint32(24, data.length, true);
      cdv.setUint16(28, name.length, true);
      cdv.setUint32(38, f.dir ? 0x10 : 0, true); // external attrs: directory bit
      cdv.setUint32(42, offset, true);
      cen.set(name, 46);
      central.push(cen);

      offset += local.length + data.length;
    });

    var centralSize = central.reduce(function (a, c) { return a + c.length; }, 0);
    var end = new Uint8Array(22);
    var edv = new DataView(end.buffer);
    edv.setUint32(0, 0x06054b50, true);
    edv.setUint16(8, files.length, true);
    edv.setUint16(10, files.length, true);
    edv.setUint32(12, centralSize, true);
    edv.setUint32(16, offset, true);

    var all = parts.concat(central, [end]);
    var total = all.reduce(function (a, c) { return a + c.length; }, 0);
    var buf = new Uint8Array(total);
    var p = 0;
    all.forEach(function (c) { buf.set(c, p); p += c.length; });
    return buf;
  }

  root.TLS = root.TLS || {};
  root.TLS.zip = { build: build, crc32: crc32 };
})(window);
