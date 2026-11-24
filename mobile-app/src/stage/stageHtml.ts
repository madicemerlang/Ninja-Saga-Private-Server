/**
 * Generates the transparent HTML stage hosted inside react-native-webview.
 * Mirrors Ninja Horizon's mobile Ruffle architecture:
 *  1. Caps window.devicePixelRatio (1.35) BEFORE Ruffle loads to prevent 9x high-DPI fill-rate lag
 *  2. Frame Pump + __holdFrames hook on requestAnimationFrame (pause when hidden, pump 1 frame on demand)
 *  3. WebAssembly.Memory probe to report Ruffle WASM heap usage back to React Native
 *  4. ExternalInterface hooks (__pollCmd, __onHit, __onDone) for zero-reload Single-SWF 36 FPS Battle choreography
 */
export function buildRuffleStageHtml(
  ruffleScriptUrl: string,
  quality: 'low' | 'medium' | 'high' = 'high'
): string {
  const safeRuffleUrl = ruffleScriptUrl.replace(/"/g, '&quot;');
  // Ninja Horizon mobile GPU DPR cap: prevents 2x-4x overdraw fill-rate lag on high-DPI Android screens
  const dprCap = quality === 'low' ? 1.0 : quality === 'medium' ? 1.2 : 1.35;

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
  <style>
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      background: transparent;
      overflow: hidden;
      user-select: none;
      -webkit-user-select: none;
    }
    #stage {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: transparent;
      transform: translateZ(0);
      will-change: transform;
      backface-visibility: hidden;
    }
    ruffle-player {
      width: 100%;
      height: 100%;
      background: transparent !important;
      transform: translateZ(0);
      will-change: transform;
    }
  </style>
  <script>
    // 0) Ninja Horizon High-DPI Cap: cap devicePixelRatio at 1.85 for crisp vectors & smooth 36 FPS
    (function (cap) {
      if (window.devicePixelRatio > cap) {
        try {
          Object.defineProperty(window, 'devicePixelRatio', {
            get: function () { return cap; },
            configurable: true
          });
        } catch (e) {}
      }
    })(${dprCap});

    (function () {
      var RN = window.ReactNativeWebView;
      function post(payload) {
        try {
          if (RN && typeof RN.postMessage === 'function') {
            RN.postMessage(JSON.stringify(payload));
          }
        } catch (e) {}
      }
      window.__postRN = post;

      // ExternalInterface hooks called by the Unified 36 FPS Battle SWF
      window.__pendingSeq = '';
      window.__pollCmd = function () {
        var s = window.__pendingSeq;
        window.__pendingSeq = '';
        return s || '';
      };
      window.__onHit = function () {
        post({ type: 'ANIM_HIT' });
        return '';
      };
      window.__onDone = function () {
        post({ type: 'ANIM_DONE' });
        return '';
      };

      // 1) Frame Pump, Speed Multiplier (1x/2x) & __holdFrames (installed BEFORE Ruffle runtime loads)
      var origRaf = window.requestAnimationFrame ? window.requestAnimationFrame.bind(window) : null;
      var pending = [];
      var seq = 0;
      var armed = false;
      var held = false;
      var clock = 0;
      var lastRealTs = null;
      var smoothedDt = 16.67;
      var speedMult = 1;

      function flushQueue() {
        var batch = pending;
        pending = [];
        for (var i = 0; i < batch.length; i++) {
          try {
            batch[i].cb(clock);
          } catch (err) {
            post({ type: 'STAGE_ERROR', message: String(err) });
          }
        }
      }

      function arm() {
        if (armed || held || !pending.length || !origRaf) return;
        armed = true;
        origRaf(function (ts) {
          armed = false;
          if (lastRealTs === null) {
            lastRealTs = ts;
            if (ts > clock) clock = ts;
          } else if (speedMult <= 1) {
            // Ninja Horizon exact VSync-locked clock: never runs backwards, zero drift vs display VSync!
            lastRealTs = ts;
            if (ts > clock) clock = ts;
          } else {
            var rawDt = Math.max(0, Math.min(34, ts - lastRealTs));
            lastRealTs = ts;
            clock += rawDt * speedMult;
          }
          if (!held) flushQueue();
        });
      }

      window.__setSpeed = function (mult) {
        var m = Number(mult);
        speedMult = (isFinite(m) && m > 1) ? Math.min(3, m) : 1;
      };

      if (origRaf) {
        window.requestAnimationFrame = function (cb) {
          for (var i = 0; i < pending.length; i++) {
            if (pending[i].cb === cb) return pending[i].id;
          }
          var id = ++seq;
          pending.push({ id: id, cb: cb });
          arm();
          return id;
        };
        window.cancelAnimationFrame = function (id) {
          for (var i = 0; i < pending.length; i++) {
            if (pending[i].id === id) {
              pending.splice(i, 1);
              return;
            }
          }
        };
      }

      window.__holdFrames = function (on) {
        held = !!on;
        arm();
        post({ type: 'HOLD_STATE', held: held });
      };

      window.__pumpOneFrame = function () {
        clock += 28;
        flushQueue();
      };

      // 2) WebAssembly Memory Probe
      window.__wasmMemories = [];
      var OrigWasmMemory = window.WebAssembly && window.WebAssembly.Memory;
      if (OrigWasmMemory) {
        window.WebAssembly.Memory = function (desc) {
          var mem = new OrigWasmMemory(desc);
          window.__wasmMemories.push(mem);
          return mem;
        };
        window.WebAssembly.Memory.prototype = OrigWasmMemory.prototype;
      }

      window.__reportMemory = function () {
        var totalBytes = 0;
        for (var i = 0; i < window.__wasmMemories.length; i++) {
          try {
            totalBytes += window.__wasmMemories[i].buffer.byteLength;
          } catch (e) {}
        }
        post({
          type: 'MEMORY_REPORT',
          wasmHeapMB: Number((totalBytes / (1024 * 1024)).toFixed(2)),
          memoryCount: window.__wasmMemories.length
        });
      };

      window.addEventListener('error', function (e) {
        post({ type: 'STAGE_ERROR', message: e.message || 'Unknown WebView error' });
      });
    })();
  </script>
  <script>
    window.RufflePlayer = window.RufflePlayer || {};
    window.RufflePlayer.config = {
      autoplay: 'on',
      unmuteOverlay: 'hidden',
      contextMenu: 'off',
      splashScreen: false,
      wmode: 'transparent',
      backgroundColor: null,
      letterbox: 'off',
      scale: 'noBorder',
      preferredRenderer: 'webgl',
      quality: '${quality}',
      allowScriptAccess: true,
      logLevel: 'error'
    };
  </script>
  <script src="${safeRuffleUrl}"></script>
</head>
<body>
  <div id="stage"></div>
  <script>
    (function () {
      var post = window.__postRN;
      var stageEl = document.getElementById('stage');
      var currentPlayer = null;
      var swfByteCache = {};
      var iconQueue = [];
      var iconBusy = false;

      async function drainIconQueue() {
        if (iconBusy) return;
        iconBusy = true;
        while (iconQueue.length > 0) {
          var job = iconQueue.shift();
          if (!job || !window.RufflePlayer || !job.skillIds || job.skillIds.length === 0) continue;
          var count = Math.min(12, job.skillIds.length);
          var cell = 128;
          var host = document.createElement('div');
          host.style.position = 'fixed';
          host.style.left = '0px';
          host.style.top = '0px';
          host.style.width = (count * cell) + 'px';
          host.style.height = cell + 'px';
          host.style.opacity = '0.01';
          host.style.zIndex = '-1';
          host.style.pointerEvents = 'none';
          document.body.appendChild(host);
          try {
            var ruffle = window.RufflePlayer.newest();
            var iconPlayer = ruffle.createPlayer();
            iconPlayer.style.width = (count * cell) + 'px';
            iconPlayer.style.height = cell + 'px';
            host.appendChild(iconPlayer);
            var iconBytes = await getSwfBytes(job.url);
            await iconPlayer.load({
              data: iconBytes.slice(0),
              swfFileName: 'skill_icons.swf',
              preferredRenderer: 'canvas',
              wmode: 'transparent',
              backgroundColor: null,
              quality: 'best',
              scale: 'exactFit',
              letterbox: 'off',
              autoplay: 'on',
              splashScreen: false,
              unmuteOverlay: 'hidden',
              contextMenu: 'off'
            });
            var waitTick = function () {
              return new Promise(function (resolve) {
                setTimeout(resolve, 45);
              });
            };
            var sliceCanvas = document.createElement('canvas');
            sliceCanvas.width = cell;
            sliceCanvas.height = cell;
            var ctx = sliceCanvas.getContext('2d');
            if (ctx) {
              ctx.imageSmoothingEnabled = true;
              ctx.imageSmoothingQuality = 'high';
            }
            var captured = false;
            for (var attempt = 0; attempt < 32 && !captured; attempt++) {
              await waitTick();
              var srcCanvas = iconPlayer.shadowRoot && iconPlayer.shadowRoot.querySelector('canvas');
              if (!srcCanvas || srcCanvas.width <= 0 || srcCanvas.height <= 0) continue;
              var srcCellW = srcCanvas.width / count;
              var srcCellH = srcCanvas.height;
              var nonZero = 0;
              for (var probe = 0; probe < count && nonZero === 0; probe++) {
                ctx.clearRect(0, 0, cell, cell);
                ctx.drawImage(srcCanvas, probe * srcCellW, 0, srcCellW, srcCellH, 0, 0, cell, cell);
                var imgData = ctx.getImageData(0, 0, cell, cell).data;
                for (var px = 3; px < imgData.length; px += 16) {
                  if (imgData[px] > 10) { nonZero++; break; }
                }
              }
              if (nonZero > 0) {
                var outIcons = {};
                for (var idx = 0; idx < count; idx++) {
                  ctx.clearRect(0, 0, cell, cell);
                  ctx.drawImage(srcCanvas, idx * srcCellW, 0, srcCellW, srcCellH, 0, 0, cell, cell);
                  var cellData = ctx.getImageData(0, 0, cell, cell).data;
                  var hasPx = false;
                  for (var cpx = 3; cpx < cellData.length; cpx += 16) {
                    if (cellData[cpx] > 10) { hasPx = true; break; }
                  }
                  if (hasPx) {
                    outIcons[job.skillIds[idx]] = sliceCanvas.toDataURL('image/png');
                  }
                }
                post({ type: 'SKILL_ICONS', icons: outIcons });
                captured = true;
              }
            }
          } catch (iconErr) {
            // Silent fallback to elemental crest icons
          } finally {
            try { host.remove(); } catch (e) {}
          }
        }
        iconBusy = false;
      }

      async function getSwfBytes(url) {
        if (swfByteCache[url]) {
          return swfByteCache[url];
        }
        var resp = await fetch(url, { mode: 'cors', cache: 'force-cache' });
        if (!resp.ok) {
          throw new Error('SWF HTTP ' + resp.status + ' (' + url + ')');
        }
        var buf = await resp.arrayBuffer();
        var bytes = new Uint8Array(buf);
        swfByteCache[url] = bytes;
        return bytes;
      }

      function ensurePlayer() {
        if (!window.RufflePlayer) {
          post({ type: 'STAGE_ERROR', message: 'RufflePlayer runtime failed to load' });
          return null;
        }
        if (currentPlayer) {
          return currentPlayer;
        }
        var ruffle = window.RufflePlayer.newest();
        var player = ruffle.createPlayer();
        player.style.width = '100%';
        player.style.height = '100%';
        player.addEventListener('webglcontextlost', function (ev) {
          try { ev.preventDefault(); } catch (e) {}
          post({ type: 'STAGE_ERROR', message: 'WebGL context lost — recovering' });
        });
        stageEl.appendChild(player);
        currentPlayer = player;
        return player;
      }

      window.__stageCommand = async function (cmd) {
        try {
          if (!cmd || !cmd.type) return;

          if (cmd.type === 'PLAY_SEQ' && cmd.seq) {
            window.__pendingSeq = String(cmd.seq);
            return;
          }

          if (cmd.type === 'PRELOAD_SWFS' && Array.isArray(cmd.urls)) {
            var loaded = 0;
            for (var i = 0; i < cmd.urls.length; i++) {
              try {
                await getSwfBytes(cmd.urls[i]);
                loaded++;
              } catch (e) {}
            }
            post({ type: 'PRELOAD_DONE', count: loaded });
            return;
          }

          if (cmd.type === 'LOAD_SWF') {
            var player = ensurePlayer();
            if (!player) return;
            window.__pendingSeq = '';
            var cached = !!swfByteCache[cmd.url];
            if (!cached) {
              post({ type: 'STAGE_LOADING', url: cmd.url });
            }
            var bytes = await getSwfBytes(cmd.url);
            if (!cached) {
              post({ type: 'STAGE_FETCHED', url: cmd.url, bytes: bytes.byteLength });
            }
            await player.load({
              data: bytes.slice(0),
              swfFileName: (cmd.url.split('?')[0].split('/').pop()) || 'movie.swf',
              allowScriptAccess: true,
              wmode: 'transparent',
              backgroundColor: null,
              preferredRenderer: 'webgl',
              quality: '${quality}'
            });
            window.__reportMemory();
            post({ type: 'STAGE_READY', url: cmd.url });
            return;
          }

          if (cmd.type === 'CAPTURE_SKILL_ICONS' && cmd.url && Array.isArray(cmd.skillIds)) {
            if (!window.RufflePlayer || cmd.skillIds.length === 0) return;
            iconQueue.push({ url: cmd.url, skillIds: cmd.skillIds });
            drainIconQueue();
            return;
          }

          if (cmd.type === 'SET_SPEED') {
            window.__setSpeed && window.__setSpeed(Number(cmd.speed || 1));
            return;
          }

          if (cmd.type === 'HOLD_FRAMES') {
            window.__holdFrames(!!cmd.held);
            return;
          }

          if (cmd.type === 'PUMP_FRAME') {
            window.__pumpOneFrame();
            return;
          }

          if (cmd.type === 'GET_MEMORY') {
            window.__reportMemory();
            return;
          }

          if (cmd.type === 'CLEAR_STAGE') {
            if (currentPlayer) {
              try { currentPlayer.remove(); } catch (e) {}
              currentPlayer = null;
            }
            post({ type: 'STAGE_CLEARED' });
            return;
          }
        } catch (err) {
          post({ type: 'STAGE_ERROR', message: String(err && err.message ? err.message : err) });
        }
      };

      post({ type: 'BRIDGE_READY', hasRuffle: !!window.RufflePlayer });
    })();
  </script>
</body>
</html>`;
}
