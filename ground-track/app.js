(function () {
  const APP_CONFIG = window.GROUND_TRACK_CONFIG || {};
  const MASK_URL = APP_CONFIG.maskUrl || "mask.json";
  const WORLD_URL = APP_CONFIG.worldDataUrl || "assets/countries-110m.json";
  const UPDATE_MS = Number(APP_CONFIG.updateMs || 10000);
  const STORAGE_KEY = "gt_settings";

  function loadSettings() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch (_) {
      return {};
    }
  }

  function saveSettings(settings) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }

  const settings = loadSettings();

  function satSetting(name, field, defaultValue) {
    settings.sats = settings.sats || {};
    settings.sats[name] = settings.sats[name] || {};
    if (settings.sats[name][field] === undefined) {
      settings.sats[name][field] = defaultValue;
      saveSettings(settings);
    }
    return settings.sats[name][field];
  }

  function setSatSetting(name, field, value) {
    settings.sats = settings.sats || {};
    settings.sats[name] = settings.sats[name] || {};
    settings.sats[name][field] = value;
    saveSettings(settings);
  }

  function gsSetting(code, field, defaultValue) {
    settings.gs = settings.gs || {};
    settings.gs[code] = settings.gs[code] || {};
    if (settings.gs[code][field] === undefined) {
      settings.gs[code][field] = defaultValue;
      saveSettings(settings);
    }
    return settings.gs[code][field];
  }

  function setGsSetting(code, field, value) {
    settings.gs = settings.gs || {};
    settings.gs[code] = settings.gs[code] || {};
    settings.gs[code][field] = value;
    saveSettings(settings);
  }

  function labelFontSizeSetting() {
    if (settings.labelFontSize === undefined) settings.labelFontSize = 10;
    const n = Number(settings.labelFontSize);
    return Number.isNaN(n) ? 10 : Math.max(8, Math.min(50, n));
  }

  function setLabelFontSizeSetting(value) {
    settings.labelFontSize = Math.max(8, Math.min(50, Number(value) || 10));
    saveSettings(settings);
  }

  function dayNightVisibleSetting() {
    settings.dayNight = settings.dayNight || {};
    if (settings.dayNight.visible === undefined) settings.dayNight.visible = true;
    return Boolean(settings.dayNight.visible);
  }

  function setDayNightVisibleSetting(value) {
    settings.dayNight = settings.dayNight || {};
    settings.dayNight.visible = Boolean(value);
    saveSettings(settings);
  }

  function dayNightOpacitySetting() {
    settings.dayNight = settings.dayNight || {};
    if (settings.dayNight.opacity === undefined) settings.dayNight.opacity = 100;
    const n = Number(settings.dayNight.opacity);
    if (Number.isNaN(n)) return 100;
    return Math.max(0, Math.min(100, Math.round(n)));
  }

  function setDayNightOpacitySetting(value) {
    settings.dayNight = settings.dayNight || {};
    settings.dayNight.opacity = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
    saveSettings(settings);
  }

  function normalizeLon(lon) {
    return ((lon + 540) % 360) - 180;
  }

  function splitTrack(trackLatLon) {
    if (!trackLatLon || trackLatLon.length === 0) return [];
    const segments = [];
    let seg = [[trackLatLon[0][1], trackLatLon[0][0]]];
    for (let i = 0; i < trackLatLon.length - 1; i++) {
      const [lat0, lon0] = trackLatLon[i];
      const [lat1, lon1] = trackLatLon[i + 1];
      const delta = lon1 - lon0;
      if (Math.abs(delta) <= 180) {
        seg.push([lon1, lat1]);
        continue;
      }
      const crossLon = delta > 0 ? -180 : 180;
      const lon1Adjusted = lon1 + (delta > 0 ? -360 : 360);
      const t = (crossLon - lon0) / (lon1Adjusted - lon0);
      const latCross = lat0 + (lat1 - lat0) * t;
      seg.push([crossLon, latCross]);
      if (seg.length > 1) segments.push(seg);
      const opposite = crossLon === 180 ? -180 : 180;
      seg = [[opposite, latCross], [lon1, lat1]];
    }
    if (seg.length > 1) segments.push(seg);
    return segments;
  }

  function computeSubsolarPoint(date) {
    const t = solar.century(date);
    const subsolarLat = solar.declination(t);
    const eotMin = solar.equationOfTime(t);
    const utcHours = date.getUTCHours()
      + date.getUTCMinutes() / 60
      + date.getUTCSeconds() / 3600
      + date.getUTCMilliseconds() / 3600000;
    const subsolarLon = normalizeLon(180 - 15 * utcHours - eotMin / 4);
    return { lat: subsolarLat, lon: subsolarLon };
  }

  function nauticalNightGeojson(date) {
    const subsolar = computeSubsolarPoint(date);
    return d3.geoCircle()
      .center([normalizeLon(subsolar.lon + 180), -subsolar.lat])
      .radius(84)
      .precision(1.0)();
  }

  function fovCircleGeojson(lat, lon, radiusDeg) {
    return d3.geoCircle().center([lon, lat]).radius(radiusDeg)();
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  async function loadJson(url) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status} while loading ${url}`);
    return resp.json();
  }

  async function main() {
    const [world, mask] = await Promise.all([loadJson(WORLD_URL), loadJson(MASK_URL)]);
    if (!mask || !Array.isArray(mask.satellites)) {
      throw new Error("mask.json is missing satellites data");
    }

    const svg = d3.select("#map");
    const container = document.getElementById("map-container");
    let width = container.clientWidth;
    let height = container.clientHeight;
    svg.attr("viewBox", `0 0 ${width} ${height}`).attr("preserveAspectRatio", "xMidYMid meet");

    const projection = d3.geoEquirectangular()
      .scale(width / (2 * Math.PI))
      .translate([width / 2, height / 2])
      .precision(0.1);
    const path = d3.geoPath().projection(projection);

    const layerGraticule = svg.append("g").attr("class", "layer-graticule");
    const layerLand = svg.append("g").attr("class", "layer-land");
    const layerDayNight = svg.append("g").attr("class", "layer-day-night");
    const layerFov = svg.append("g").attr("class", "layer-fov");
    const layerTrack = svg.append("g").attr("class", "layer-track");
    const layerSats = svg.append("g").attr("class", "layer-sats");
    const layerGs = svg.append("g").attr("class", "layer-gs");

    layerGraticule.append("path").datum(d3.geoGraticule().step([30, 30])()).attr("class", "graticule").attr("d", path);
    layerGraticule.append("path").datum(d3.geoGraticule().outline()).attr("class", "graticule").attr("d", path);
    const land = topojson.feature(world, world.objects.land);
    const borders = topojson.mesh(world, world.objects.countries, (a, b) => a !== b);
    layerLand.append("path").datum(land).attr("class", "land").attr("d", path);
    layerLand.append("path").datum(borders).attr("class", "border").attr("d", path);
    layerDayNight.append("path").datum({ type: "Sphere" }).attr("class", "day-shade").attr("d", path);
    layerDayNight.append("path").attr("class", "night-shade");

    document.getElementById("loading").style.display = "none";

    const panel = document.getElementById("settings-panel");
    const toggleBtn = document.getElementById("panel-toggle");
    const labelSizeInput = document.getElementById("label-size-input");
    const labelSizeDecBtn = document.getElementById("label-size-dec");
    const labelSizeIncBtn = document.getElementById("label-size-inc");
    const labelSizeValue = document.getElementById("label-size-value");
    const dayNightVisibleInput = document.getElementById("day-night-visible");
    const dayNightOpacityInput = document.getElementById("day-night-opacity");
    const dayNightOpacityValue = document.getElementById("day-night-opacity-value");
    let panelVisible = true;

    function syncLabelSizeUi() {
      const sz = labelFontSizeSetting();
      labelSizeInput.value = String(sz);
      labelSizeValue.textContent = `${sz}px`;
      document.documentElement.style.setProperty("--map-label-font-size", `${sz}px`);
    }

    function syncDayNightUi() {
      const visible = dayNightVisibleSetting();
      const opacity = dayNightOpacitySetting();
      dayNightVisibleInput.checked = visible;
      dayNightOpacityInput.value = String(opacity);
      dayNightOpacityValue.textContent = `${opacity}%`;
    }

    function renderDayNightOverlay() {
      const visible = dayNightVisibleSetting();
      const opacity = dayNightOpacitySetting() / 100;
      layerDayNight.attr("visibility", visible ? "visible" : "hidden");
      layerDayNight.attr("opacity", opacity);
      if (!visible) return;
      const night = nauticalNightGeojson(new Date());
      layerDayNight.select(".night-shade").attr("d", path(night));
    }

    function applyLabelSizeFromInput() {
      setLabelFontSizeSetting(labelSizeInput.value);
      syncLabelSizeUi();
      renderCurrent();
    }

    function applyDayNightFromUi() {
      setDayNightVisibleSetting(dayNightVisibleInput.checked);
      setDayNightOpacitySetting(dayNightOpacityInput.value);
      syncDayNightUi();
      renderDayNightOverlay();
    }

    labelSizeInput.addEventListener("change", applyLabelSizeFromInput);
    labelSizeInput.addEventListener("blur", applyLabelSizeFromInput);
    labelSizeDecBtn.addEventListener("click", () => {
      setLabelFontSizeSetting(labelFontSizeSetting() - 1);
      syncLabelSizeUi();
      renderCurrent();
    });
    labelSizeIncBtn.addEventListener("click", () => {
      setLabelFontSizeSetting(labelFontSizeSetting() + 1);
      syncLabelSizeUi();
      renderCurrent();
    });
    dayNightVisibleInput.addEventListener("change", applyDayNightFromUi);
    dayNightOpacityInput.addEventListener("input", applyDayNightFromUi);
    toggleBtn.addEventListener("click", () => {
      panelVisible = !panelVisible;
      panel.classList.toggle("hidden", !panelVisible);
      toggleBtn.textContent = panelVisible ? "✕ Close" : "⚙ Settings";
    });
    syncLabelSizeUi();
    syncDayNightUi();

    const knownSats = new Set();
    const knownGs = new Set();

    function ensureSatControl(sat) {
      if (knownSats.has(sat.name)) return;
      knownSats.add(sat.name);
      const vis = satSetting(sat.name, "visible", true);
      const col = satSetting(sat.name, "color", sat.color || "#ffd21f");
      const fovOn = satSetting(sat.name, "showFov", true);

      const row = document.createElement("div");
      row.className = "sat-row";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = vis;
      cb.id = `sat-cb-${sat.name}`;
      cb.addEventListener("change", () => {
        setSatSetting(sat.name, "visible", cb.checked);
        renderCurrent();
      });
      const lbl = document.createElement("label");
      lbl.htmlFor = cb.id;
      lbl.textContent = sat.name;

      const fovBtn = document.createElement("button");
      fovBtn.className = "show-fov" + (fovOn ? " active" : "");
      fovBtn.textContent = "FOV";
      fovBtn.addEventListener("click", () => {
        const cur = satSetting(sat.name, "showFov", true);
        setSatSetting(sat.name, "showFov", !cur);
        fovBtn.classList.toggle("active", !cur);
        renderCurrent();
      });
      const color = document.createElement("input");
      color.type = "color";
      color.value = col;
      color.addEventListener("input", () => {
        setSatSetting(sat.name, "color", color.value);
        renderCurrent();
      });
      row.append(cb, lbl, fovBtn, color);
      document.getElementById("sat-controls").appendChild(row);
    }

    function ensureGsControl(gs) {
      if (knownGs.has(gs.code)) return;
      knownGs.add(gs.code);
      const vis = gsSetting(gs.code, "visible", true);
      const col = gsSetting(gs.code, "color", gs.color || "#00d7ff");

      const row = document.createElement("div");
      row.className = "gs-row";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = vis;
      cb.id = `gs-cb-${gs.code}`;
      cb.addEventListener("change", () => {
        setGsSetting(gs.code, "visible", cb.checked);
        renderCurrent();
      });
      const lbl = document.createElement("label");
      lbl.htmlFor = cb.id;
      lbl.textContent = `${gs.code}${gs.site ? " — " + gs.site : ""}`;
      const color = document.createElement("input");
      color.type = "color";
      color.value = col;
      color.addEventListener("input", () => {
        setGsSetting(gs.code, "color", color.value);
        renderCurrent();
      });
      row.append(cb, lbl, color);
      document.getElementById("gs-controls").appendChild(row);
    }

    mask.satellites.forEach(ensureSatControl);
    (mask.ground_stations || []).forEach(ensureGsControl);

    const sampleCount = Number(mask.sample_count || 0);
    const stepSeconds = Number(mask.step_seconds || 10);
    const startUnix = Number(mask.start_unix || 0);
    const endUnix = Number(mask.end_unix || 0);

    function satFrame(sat, index) {
      const idx = clamp(index, 0, sat.lat.length - 1);
      return {
        name: sat.name,
        color: sat.color,
        lat: sat.lat[idx],
        lon: sat.lon[idx],
        alt_km: sat.alt_km[idx],
        fov_radius_deg: sat.fov_radius_deg[idx],
      };
    }

    function satTrackAround(sat, index) {
      const lat = sat.lat || [];
      const lon = sat.lon || [];
      const len = lat.length;
      if (!len || len !== lon.length) return [];

      const ascents = Array.isArray(sat.ascending_crossings) ? sat.ascending_crossings.slice() : [];
      if (!ascents.length) {
        const start = clamp(index - Math.max(1, Math.round(len * 0.1)), 0, len - 1);
        const end = clamp(index + Math.max(1, Math.round(len * 0.1)), 0, len - 1);
        const track = [];
        for (let i = start; i <= end; i++) track.push([lat[i], lon[i]]);
        return track;
      }

      let previousCross = 0;
      let nextCross = len - 1;
      for (let i = ascents.length - 1; i >= 0; i--) {
        if (ascents[i] <= index) {
          previousCross = ascents[i];
          break;
        }
      }
      for (let i = 0; i < ascents.length; i++) {
        if (ascents[i] > index) {
          nextCross = ascents[i];
          break;
        }
      }

      if (nextCross <= previousCross) {
        nextCross = len - 1;
      }

      const track = [];
      const start = previousCross;
      const end = nextCross;
      for (let i = start; i <= end; i++) {
        const latVal = Number(lat[i]);
        const lonVal = Number(lon[i]);
        if (Number.isFinite(latVal) && Number.isFinite(lonVal)) {
          track.push([latVal, lonVal]);
        }
      }

      if (track.length >= 2) {
        const tailIdx = end - 1;
        const prevLat = Number(lat[tailIdx]);
        const nextLat = Number(lat[end]);
        const prevLon = Number(lon[tailIdx]);
        const nextLon = Number(lon[end]);
        if (
          Number.isFinite(prevLat) && Number.isFinite(nextLat) &&
          Number.isFinite(prevLon) && Number.isFinite(nextLon) &&
          prevLat < 0 && nextLat >= 0
        ) {
          const frac = (0 - prevLat) / (nextLat - prevLat);
          const lonCross = prevLon + (nextLon - prevLon) * frac;
          track[track.length - 1] = [0, lonCross];
        }
      }

      return track;
    }

    function renderForIndex(index, nowUnix) {
      const nowIso = new Date(nowUnix * 1000).toISOString().replace(".000", "");
      document.getElementById("ts-display").textContent = `${nowIso} UTC`;
      document.getElementById("sat-count-display").textContent =
        `${mask.satellites.length} satellites  |  ${(mask.ground_stations || []).length} ground stations`;

      const frameSats = mask.satellites.map((sat) => satFrame(sat, index));

      const fovSel = layerFov.selectAll(".fov-group").data(frameSats, (d) => d.name);
      const fovEnter = fovSel.enter().append("g").attr("class", "fov-group");
      fovEnter.append("path").attr("class", "fov");
      fovSel.exit().remove();

      layerFov.selectAll(".fov-group").each(function (d) {
        const visible = satSetting(d.name, "visible", true);
        const showFov = satSetting(d.name, "showFov", true);
        const color = satSetting(d.name, "color", d.color);
        d3.select(this).select("path")
          .attr("visibility", (visible && showFov) ? "visible" : "hidden")
          .attr("stroke", color)
          .attr("fill", color)
          .attr("d", path(fovCircleGeojson(d.lat, d.lon, d.fov_radius_deg)));
      });

      const trackData = mask.satellites.map((sat) => ({
        name: sat.name,
        color: sat.color,
        track: satTrackAround(sat, index),
      }));

      const trackSel = layerTrack.selectAll(".track-group").data(trackData, (d) => d.name);
      trackSel.enter().append("g").attr("class", "track-group");
      trackSel.exit().remove();
      layerTrack.selectAll(".track-group").each(function (d) {
        const visible = satSetting(d.name, "visible", true);
        const color = satSetting(d.name, "color", d.color);
        const segments = splitTrack(d.track);
        const paths = d3.select(this).selectAll("path").data(segments);
        paths.enter().append("path").attr("class", "track");
        paths.exit().remove();
        d3.select(this).selectAll("path")
          .attr("visibility", visible ? "visible" : "hidden")
          .attr("stroke", color)
          .attr("d", (seg) => path({ type: "LineString", coordinates: seg }));
      });

      const satSel = layerSats.selectAll(".sat-group").data(frameSats, (d) => d.name);
      const satEnter = satSel.enter().append("g").attr("class", "sat-group");
      satEnter.append("circle").attr("class", "sat-halo").attr("r", 7.2);
      satEnter.append("circle").attr("class", "sat-core").attr("r", 3.3);
      satEnter.append("text").attr("class", "sat-label");
      satSel.exit().remove();

      layerSats.selectAll(".sat-group").each(function (d) {
        const visible = satSetting(d.name, "visible", true);
        const color = satSetting(d.name, "color", d.color);
        const [px, py] = projection([d.lon, d.lat]) || [0, 0];
        const g = d3.select(this);
        g.attr("visibility", visible ? "visible" : "hidden");
        g.select(".sat-halo").attr("cx", px).attr("cy", py).attr("stroke", color);
        g.select(".sat-core").attr("cx", px).attr("cy", py).attr("fill", color);
        g.select("text")
          .attr("x", px + 7).attr("y", py - 7).attr("fill", color)
          .text(`${d.name} (${d.alt_km}km)`);
      });

      const gsSel = layerGs.selectAll(".gs-group").data(mask.ground_stations || [], (d) => d.code);
      const gsEnter = gsSel.enter().append("g").attr("class", "gs-group");
      gsEnter.append("circle").attr("class", "gs-halo").attr("r", 5.6);
      gsEnter.append("circle").attr("class", "gs-core").attr("r", 2.7);
      gsEnter.append("text").attr("class", "gs-label");
      gsSel.exit().remove();

      layerGs.selectAll(".gs-group").each(function (d) {
        const visible = gsSetting(d.code, "visible", true);
        const color = gsSetting(d.code, "color", d.color);
        const [px, py] = projection([d.lon, d.lat]) || [0, 0];
        const g = d3.select(this);
        g.attr("visibility", visible ? "visible" : "hidden");
        g.select(".gs-halo").attr("cx", px).attr("cy", py).attr("stroke", color);
        g.select(".gs-core").attr("cx", px).attr("cy", py).attr("fill", color);
        g.select("text").attr("x", px + 6).attr("y", py + 4).attr("fill", color).text(d.code);
      });

      renderDayNightOverlay();
    }

    function renderCurrent() {
      const nowUnix = Math.floor(Date.now() / 1000);
      if (!sampleCount || nowUnix < startUnix || nowUnix > endUnix) {
        document.getElementById("ts-display").textContent = "OUTSIDE MASK WINDOW";
        return;
      }
      const rawIndex = Math.round((nowUnix - startUnix) / stepSeconds);
      const index = clamp(rawIndex, 0, sampleCount - 1);
      renderForIndex(index, nowUnix);
    }

    renderCurrent();
    setInterval(renderCurrent, UPDATE_MS);
    setInterval(renderDayNightOverlay, 1000);

    window.addEventListener("resize", () => {
      width = container.clientWidth;
      height = container.clientHeight;
      svg.attr("viewBox", `0 0 ${width} ${height}`);
      projection
        .scale(width / (2 * Math.PI))
        .translate([width / 2, height / 2]);
      layerGraticule.selectAll("path").attr("d", path);
      layerLand.select(".land").attr("d", path);
      layerLand.select(".border").attr("d", path);
      layerDayNight.select(".day-shade").attr("d", path({ type: "Sphere" }));
      renderCurrent();
    });
  }

  main().catch((err) => {
    console.error(err);
    document.getElementById("loading").textContent = `Error: ${err.message}`;
  });
})();
