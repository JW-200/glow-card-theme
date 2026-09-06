(() => {
  'use strict';

  const VERSION = '17.0.0';
  const ACTIVE_STATES = new Set(['on', 'home', 'open', 'playing', 'active', 'true']);

  const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const rgbTriplet = (value, fallback = [255,190,57]) => {
    const source = value ?? fallback;
    if (Array.isArray(source) && source.length >= 3) {
      return source.slice(0,3).map((part) => clamp(Math.round(Number(part) || 0), 0, 255)).join(',');
    }
    if (typeof source === 'string') {
      const text = source.trim();
      const hex = text.match(/^#?([0-9a-f]{6})$/i);
      if (hex) return [0,2,4].map((i) => parseInt(hex[1].slice(i,i+2),16)).join(',');
      const parts = text.split(',').map((part) => Number(part.trim()));
      if (parts.length >= 3 && parts.slice(0,3).every(Number.isFinite)) {
        return parts.slice(0,3).map((part) => clamp(Math.round(part),0,255)).join(',');
      }
    }
    return rgbTriplet(fallback, [255,190,57]);
  };
  const stateColor = (config, stateKey, field, fallback) => {
    const mapped = config?.state_colors && typeof config.state_colors === 'object' ? config.state_colors[stateKey] : null;
    return rgbTriplet(mapped ?? config?.[field], fallback);
  };
  const setAccent = (card, rgb, rgb2 = rgb) => {
    if (!card) return;
    card.style.setProperty('--accent-rgb', rgb);
    card.style.setProperty('--accent2-rgb', rgb2);
  };
  const available = (state) => Boolean(state && !['unknown', 'unavailable'].includes(String(state.state).toLowerCase()));
  const active = (state) => Boolean(state && ACTIVE_STATES.has(String(state.state).toLowerCase()));

  const supportsBrightness = (state) => Boolean(state && (
    state.attributes?.brightness != null ||
    state.attributes?.supported_color_modes?.some((mode) => !['onoff', 'unknown'].includes(mode))
  ));

  const moreInfo = (host, entityId) => {
    if (!entityId) return;
    host.dispatchEvent(new CustomEvent('hass-more-info', {
      detail: { entityId }, bubbles: true, composed: true,
    }));
  };

  const notify = (host, message) => host.dispatchEvent(new CustomEvent('hass-notification', {
    detail: { message }, bubbles: true, composed: true,
  }));

  const ICONS = {
    light: 'mdi:lightbulb',
    lightOn: 'mdi:lightbulb-on',
    lightOff: 'mdi:lightbulb-outline',
    switchOn: 'mdi:toggle-switch',
    switchOff: 'mdi:toggle-switch-off-outline',
    person: 'mdi:account',
    home: 'mdi:home',
    zone: 'mdi:map-marker',
    away: 'mdi:exit-run',
    unknown: 'mdi:help-circle-outline',
    sensor: 'mdi:gauge',
    chevron: 'mdi:chevron-right',
    info: 'mdi:information-outline',
    battery: 'mdi:battery',
    batteryUnknown: 'mdi:battery-unknown',
    thermostat: 'mdi:thermostat',
    heating: 'mdi:radiator',
    cooling: 'mdi:snowflake',
    minus: 'mdi:minus',
    plus: 'mdi:plus',
    navigate: 'mdi:arrow-right',
  };

  /*
   * The compact breakpoints keep the normal one-row layout as long as possible.
   * Wrapping/reflow only starts once the card is genuinely too narrow to fit controls.  This is where the previous version drifted furthest from
   * the reference: it was too tall, too round and inherited green accents.
   */
  const BASE_CSS = `
    :host {
      display:block;
      min-width:0;
      container-type:inline-size;
      color-scheme:dark;
      -webkit-tap-highlight-color:transparent;
      font-family:Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    *,*::before,*::after { box-sizing:border-box; }

    .card {
      --accent-rgb:255,190,57;
      --accent2-rgb:115,151,255;
      --accent:rgb(var(--accent-rgb));

      position:relative;
      isolation:isolate;
      width:100%;
      height:150px;
      min-height:150px;
      max-height:150px;
      display:grid;
      grid-template-columns:82px minmax(0,1fr) auto;
      align-items:center;
      column-gap:22px;
      padding:22px 25px;
      overflow:hidden;
      border:1px solid rgba(190,211,235,.20);
      border-radius:31px;
      color:#f7f8fb;
      background:
        linear-gradient(135deg,rgba(255,255,255,.105) 0%,rgba(255,255,255,.028) 21%,transparent 39%),
        radial-gradient(120% 155% at -14% 42%,rgba(var(--accent-rgb),.075),transparent 61%),
        radial-gradient(92% 120% at 106% -10%,rgba(var(--accent2-rgb),.055),transparent 56%),
        linear-gradient(133deg,rgba(31,43,57,.94) 0%,rgba(23,33,45,.95) 49%,rgba(13,20,29,.97) 100%);
      -webkit-backdrop-filter:blur(18px) saturate(125%);
      backdrop-filter:blur(18px) saturate(125%);
      box-shadow:
        inset 0 1px 0 rgba(255,255,255,.19),
        inset 0 0 0 1px rgba(255,255,255,.018),
        inset 0 -1px 0 rgba(0,0,0,.46),
        0 10px 24px rgba(0,0,0,.38);
      cursor:pointer;
      user-select:none;
      transform:translateZ(0);
      transition:transform .20s cubic-bezier(.2,.8,.2,1),box-shadow .25s ease,filter .25s ease;
    }

    /* broad internal light bloom */
    .card::before {
      content:'';
      position:absolute;
      inset:0;
      z-index:0;
      pointer-events:none;
      border-radius:inherit;
      background:
        radial-gradient(ellipse 78% 124% at -10% 58%,rgba(var(--accent-rgb),.14),transparent 69%),
        radial-gradient(ellipse 64% 108% at 104% -4%,rgba(var(--accent2-rgb),.075),transparent 70%),
        linear-gradient(116deg,rgba(255,255,255,.038),transparent 26% 74%,rgba(255,255,255,.012));
      opacity:.50;
    }

    /* bright reference-style perimeter */
    .card::after {
      content:'';
      position:absolute;
      inset:0;
      z-index:20;
      pointer-events:none;
      border-radius:inherit;
      padding:1.35px;
      background:linear-gradient(
        108deg,
        rgba(var(--accent-rgb),.98) 0%,
        rgba(var(--accent-rgb),.78) 27%,
        rgba(255,255,255,.24) 55%,
        rgba(var(--accent2-rgb),.80) 100%
      );
      -webkit-mask:linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0);
      -webkit-mask-composite:xor;
      mask:linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0);
      mask-composite:exclude;
      filter:
        drop-shadow(0 0 2px rgba(var(--accent-rgb),.72))
        drop-shadow(0 0 7px rgba(var(--accent-rgb),.28));
    }

    .card.glow {
      box-shadow:
        inset 0 1px 0 rgba(255,255,255,.18),
        inset 0 -1px 0 rgba(0,0,0,.46),
        inset 18px 0 48px rgba(var(--accent-rgb),.025),
        0 0 12px rgba(var(--accent-rgb),.28),
        0 0 28px rgba(var(--accent-rgb),.14),
        0 12px 28px rgba(0,0,0,.42);
    }

    .card.unavailable { opacity:.52; filter:saturate(.5); cursor:default; }

    @media (hover:hover) {
      .card:not(.unavailable):hover {
        transform:translateY(-2px);
        box-shadow:
          inset 0 1px 0 rgba(255,255,255,.20),
          inset 18px 0 50px rgba(var(--accent-rgb),.035),
          0 0 16px rgba(var(--accent-rgb),.33),
          0 0 34px rgba(var(--accent-rgb),.16),
          0 16px 31px rgba(0,0,0,.45);
      }
    }

    .card:not(.unavailable):active:not(:has([data-control]:active)) { transform:scale(.995); }
    .card:focus-visible { outline:2px solid rgba(var(--accent-rgb),.95); outline-offset:3px; }

    .icon-shell {
      position:relative;
      z-index:2;
      width:82px;
      height:82px;
      display:grid;
      place-items:center;
      border-radius:50%;
      color:rgb(var(--accent-rgb));
      border:1px solid rgba(var(--accent-rgb),.38);
      background:
        radial-gradient(circle at 30% 22%,rgba(255,255,255,.19),rgba(255,255,255,.050) 27%,transparent 46%),
        radial-gradient(circle at 52% 74%,rgba(var(--accent-rgb),.105),transparent 70%),
        linear-gradient(145deg,rgba(42,52,64,.90),rgba(27,35,45,.94) 68%,rgba(18,25,33,.96));
      -webkit-backdrop-filter:blur(10px);
      backdrop-filter:blur(10px);
      box-shadow:
        inset 0 1px 0 rgba(255,255,255,.15),
        inset 0 0 0 1px rgba(255,255,255,.015),
        0 0 0 1px rgba(var(--accent-rgb),.045),
        0 0 12px rgba(var(--accent-rgb),.11),
        0 7px 18px rgba(0,0,0,.30);
    }

    .icon-shell ha-icon {
      --mdc-icon-size:36px;
      width:36px;
      height:36px;
      display:flex;
      align-items:center;
      justify-content:center;
      place-self:center;
      margin:0;
      padding:0;
      line-height:0;
      transform:translate(0,0);
      filter:
        drop-shadow(0 1px 2px rgba(0,0,0,.42))
        drop-shadow(0 0 7px rgba(var(--accent-rgb),.30));
    }

    .badge ha-icon,.battery-status ha-icon,.info-button ha-icon,.temp-button ha-icon,.nav-action ha-icon {
      display:flex !important;
      align-items:center !important;
      justify-content:center !important;
      place-self:center !important;
      margin:0 !important;
      padding:0 !important;
      line-height:0 !important;
    }

    .content { position:relative; z-index:2; min-width:0; }

    .name {
      min-width:0;
      overflow:hidden;
      white-space:nowrap;
      text-overflow:ellipsis;
      color:#fbfbfc;
      font-size:21px;
      line-height:1.14;
      font-weight:760;
      letter-spacing:-.28px;
      text-shadow:0 1px 3px rgba(0,0,0,.34);
    }

    .state {
      min-width:0;
      margin-top:6px;
      overflow:hidden;
      white-space:nowrap;
      text-overflow:ellipsis;
      color:#c4c8d0;
      font-size:17px;
      line-height:1.18;
      font-weight:440;
    }

    .subtext {
      min-width:0;
      margin-top:8px;
      overflow:hidden;
      white-space:nowrap;
      text-overflow:ellipsis;
      color:#929aa7;
      font-size:14px;
      line-height:1.15;
      font-weight:430;
    }

    .chevron {
      position:relative;
      z-index:3;
      display:grid;
      place-items:center;
      width:30px;
      height:38px;
      color:#dbe0e8;
      opacity:.88;
      filter:drop-shadow(0 1px 2px rgba(0,0,0,.35));
    }
    .chevron ha-icon { --mdc-icon-size:31px; }

    button.control {
      position:relative;
      z-index:6;
      margin:0;
      padding:0;
      border:0;
      background:transparent;
      color:inherit;
      font:inherit;
      cursor:pointer;
    }
    button.control:focus-visible { outline:2px solid var(--accent); outline-offset:4px; border-radius:999px; }
    button.control:disabled { cursor:default; }

    .switch {
      --w:88px;
      --h:46px;
      --knob:36px;
      position:relative;
      display:block;
      width:var(--w);
      height:var(--h);
      padding:5px;
      overflow:hidden;
      border-radius:999px;
      border:1px solid rgba(var(--accent-rgb),.72);
      background:
        linear-gradient(180deg,rgba(255,255,255,.07),rgba(255,255,255,.01)),
        rgba(18,22,29,.94);
      box-shadow:
        inset 0 2px 5px rgba(0,0,0,.48),
        0 0 0 1px rgba(var(--accent-rgb),.04),
        0 3px 10px rgba(0,0,0,.28);
    }

    .switch::before {
      content:'';
      position:absolute;
      inset:0;
      border-radius:inherit;
      background:
        radial-gradient(circle at 72% 34%,rgba(255,255,255,.38),transparent 24%),
        linear-gradient(105deg,rgba(var(--accent-rgb),.98),rgba(var(--accent-rgb),.62));
      opacity:0;
      transition:opacity .20s ease;
    }

    .knob {
      position:relative;
      z-index:2;
      display:block;
      width:var(--knob);
      height:var(--knob);
      border-radius:50%;
      background:radial-gradient(circle at 34% 28%,#fff 0 28%,#eef3f8 54%,#d3dce6 100%);
      box-shadow:
        inset 0 1px 0 rgba(255,255,255,.96),
        0 0 0 1px rgba(255,255,255,.13),
        0 4px 10px rgba(0,0,0,.44);
      transform:translateX(0);
      transition:transform .24s cubic-bezier(.2,.85,.2,1),box-shadow .20s ease;
    }

    .active .switch::before { opacity:1; }
    .active .switch {
      box-shadow:
        inset 0 1px 0 rgba(255,255,255,.30),
        0 0 8px rgba(var(--accent-rgb),.56),
        0 0 20px rgba(var(--accent-rgb),.23),
        0 4px 10px rgba(0,0,0,.28);
    }
    .active .knob {
      transform:translateX(42px);
      box-shadow:
        inset 0 1px 0 rgba(255,255,255,.98),
        0 0 9px rgba(255,255,255,.72),
        0 0 18px rgba(var(--accent-rgb),.35),
        0 4px 10px rgba(0,0,0,.35);
    }

    /*
     * Light cards have a real OFF visual state.
     * Earlier versions always rendered the amber perimeter/icon glow even when
     * Home Assistant reported off, which made the card look powered on.
     */
    .light-card.active {
      background:
        linear-gradient(135deg,rgba(255,255,255,.115),rgba(255,255,255,.032) 25%,transparent 43%),
        linear-gradient(90deg,rgba(var(--accent-rgb),.18) 0%,rgba(var(--accent-rgb),.14) 28%,rgba(var(--accent-rgb),.085) 55%,rgba(var(--accent-rgb),.040) 78%,rgba(var(--accent-rgb),.012) 94%,transparent 100%),
        radial-gradient(138% 172% at -16% 48%,rgba(var(--accent-rgb),.17),transparent 76%),
        radial-gradient(94% 122% at 106% 2%,rgba(var(--accent-rgb),.055),transparent 66%),
        linear-gradient(133deg,rgba(49,45,38,.94) 0%,rgba(38,38,37,.95) 49%,rgba(18,24,31,.97) 100%) !important;
      -webkit-backdrop-filter:blur(18px) saturate(120%);
      backdrop-filter:blur(18px) saturate(120%);
    }
    .light-card.active::before { opacity:.58; }
    .light-card.active .icon-shell {
      color:rgb(var(--accent-rgb));
      border-color:rgba(var(--accent-rgb),.62);
      background:
        radial-gradient(circle at 31% 23%,rgba(255,255,255,.25),rgba(255,255,255,.07) 25%,transparent 43%),
        radial-gradient(circle at 50% 58%,rgba(var(--accent-rgb),.25),rgba(var(--accent-rgb),.095) 50%,transparent 74%),
        linear-gradient(145deg,#403728,#282b2d 67%,#171e25);
      box-shadow:
        inset 0 1px 0 rgba(255,255,255,.18),
        0 0 0 1px rgba(var(--accent-rgb),.15),
        0 0 15px rgba(var(--accent-rgb),.34),
        0 0 28px rgba(var(--accent-rgb),.13),
        0 7px 18px rgba(0,0,0,.30);
    }
    .light-card.active .icon-shell ha-icon {
      filter:drop-shadow(0 1px 2px rgba(0,0,0,.42)) drop-shadow(0 0 9px rgba(var(--accent-rgb),.55));
    }

    .light-card:not(.active) {
      border-color:rgba(128,145,166,.20);
      background:
        linear-gradient(135deg,rgba(255,255,255,.045),rgba(255,255,255,.008) 30%,transparent 48%),
        radial-gradient(95% 125% at 108% -8%,rgba(88,117,156,.055),transparent 54%),
        linear-gradient(133deg,#20262d 0%,#171d24 50%,#10161d 100%) !important;
      box-shadow:
        inset 0 1px 0 rgba(255,255,255,.075),
        inset 0 -1px 0 rgba(0,0,0,.52),
        0 9px 22px rgba(0,0,0,.36) !important;
    }
    .light-card:not(.active)::before { opacity:.12; }
    .light-card:not(.active)::after {
      background:linear-gradient(108deg,rgba(132,149,170,.28),rgba(255,255,255,.10) 55%,rgba(99,123,153,.22));
      filter:none;
    }
    .light-card:not(.active) .icon-shell {
      color:#7f8995;
      border-color:rgba(132,149,170,.22);
      background:
        radial-gradient(circle at 32% 24%,rgba(255,255,255,.09),rgba(255,255,255,.025) 28%,transparent 46%),
        linear-gradient(145deg,#252d35,#19212a 68%,#131a21);
      box-shadow:
        inset 0 1px 0 rgba(255,255,255,.07),
        0 0 0 1px rgba(255,255,255,.025),
        0 6px 16px rgba(0,0,0,.30);
    }
    .light-card:not(.active) .icon-shell ha-icon {
      filter:drop-shadow(0 1px 2px rgba(0,0,0,.42));
    }
    .light-card:not(.active) .state,
    .light-card:not(.active) .subtext { color:#858e9a; }
    .light-card:not(.active) .switch {
      border-color:rgba(137,151,169,.30);
      background:linear-gradient(180deg,rgba(255,255,255,.035),rgba(255,255,255,.006)),#12171d;
      box-shadow:inset 0 2px 5px rgba(0,0,0,.58),0 3px 10px rgba(0,0,0,.28);
    }
    .light-card:not(.active) .switch::before { opacity:0; }
    .light-card:not(.active) .knob {
      background:radial-gradient(circle at 34% 28%,#f8fafc 0 25%,#dce3ea 58%,#bcc6d0 100%);
      box-shadow:inset 0 1px 0 rgba(255,255,255,.82),0 3px 8px rgba(0,0,0,.48);
    }

    @container (max-width:430px) {
      .card {
        height:94px;
        min-height:94px;
        max-height:94px;
        grid-template-columns:50px minmax(0,1fr) auto;
        column-gap:10px;
        padding:9px 12px;
        border-radius:17px;
      }
      .icon-shell { width:44px; height:44px; justify-self:center; }
      .icon-shell ha-icon { --mdc-icon-size:23px; width:23px; height:23px; }
      .name { font-size:14.5px; letter-spacing:-.10px; }
      .state { margin-top:3px; font-size:11.5px; }
      .subtext { margin-top:3px; font-size:10.5px; }
      .chevron { width:18px; height:24px; }
      .chevron ha-icon { --mdc-icon-size:21px; }
      .switch { --w:54px; --h:28px; --knob:20px; padding:4px; }
      .active .knob { transform:translateX(26px); }
    }

    /* Keep the phone layout single-line until the card is truly cramped. */
    @container (max-width:160px) {
      .card { column-gap:8px; padding-inline:9px; }
      .name,.state,.subtext {
        white-space:normal;
        overflow:visible;
        text-overflow:clip;
        overflow-wrap:anywhere;
      }
      .name { line-height:1.12; }
      .state,.subtext { line-height:1.2; }
    }

    @container (max-width:150px) {
      .card {
        grid-template-columns:50px minmax(0,1fr);
        align-items:center;
        row-gap:10px;
        padding:12px;
      }
      .icon-shell { width:46px; height:46px; }
      .icon-shell ha-icon { --mdc-icon-size:24px; width:24px; height:24px; }
      .name { font-size:14px; }
      .state { font-size:12px; }
      .subtext { font-size:10.5px; }
    }


    /*
     * REAL PHONE RESPONSIVE MODE
     *
     * This is viewport-gated, so desktop cards retain the compact desktop
     * design even if an individual desktop card happens to be narrow.
     */
    @media (max-width:600px) {
      .card:not(.thermostat-card) {
        height:112px !important;
        min-height:112px !important;
        max-height:112px !important;
        align-content:center;
      }

      .card:not(.thermostat-card) .name {
        white-space:normal !important;
        overflow:hidden !important;
        text-overflow:clip !important;
        overflow-wrap:anywhere;
        display:-webkit-box !important;
        -webkit-box-orient:vertical;
        -webkit-line-clamp:2;
        line-clamp:2;
        line-height:1.12;
      }

      .card:not(.thermostat-card) .state {
        white-space:normal !important;
        overflow:hidden !important;
        text-overflow:clip !important;
        overflow-wrap:anywhere;
        display:-webkit-box !important;
        -webkit-box-orient:vertical;
        -webkit-line-clamp:1;
        line-clamp:1;
        line-height:1.16;
      }

      .card:not(.thermostat-card) .subtext,
      .card:not(.thermostat-card) .sensor-label {
        white-space:normal !important;
        overflow:hidden !important;
        text-overflow:clip !important;
        overflow-wrap:anywhere;
        display:-webkit-box !important;
        -webkit-box-orient:vertical;
        -webkit-line-clamp:2;
        line-clamp:2;
        line-height:1.15;
      }

      /*
       * On a phone, two-column cards are often only ~150-220px wide.
       * Give those cards a second control row instead of squeezing text into
       * a few pixels. This is intentionally BOTH viewport- and container-
       * gated, so the same narrow width on desktop does not trigger it.
       */
      @container (max-width:260px) {
        .card:not(.thermostat-card) {
          height:128px !important;
          min-height:128px !important;
          max-height:128px !important;
        }
      }
    }

    @media (prefers-reduced-motion:reduce) {
      *,*::before,*::after { transition:none!important; animation:none!important; }
      .card:hover,.card:active { transform:none!important; }
    }
  `;


  const SECTIONS_CSS = `
    :host {
      height:100%;
      min-height:0;
    }

    .card {
      height:100% !important;
      min-height:120px !important;
      max-height:none !important;
      grid-template-columns:64px minmax(0,1fr) auto !important;
      grid-template-rows:1fr !important;
      column-gap:14px !important;
      row-gap:0 !important;
      padding:14px 16px !important;
      border-radius:22px !important;
    }

    /* Beat the legacy phone rules that used higher-specificity !important heights. */
    .card:not(.thermostat-card) {
      height:100% !important;
      min-height:120px !important;
      max-height:none !important;
    }

    .icon-shell {
      width:60px !important;
      height:60px !important;
    }

    .icon-shell ha-icon {
      --mdc-icon-size:29px !important;
      width:29px !important;
      height:29px !important;
    }

    .name {
      font-size:18px;
      line-height:1.12;
      letter-spacing:-.2px;
    }

    .state {
      margin-top:4px;
      font-size:14px;
      line-height:1.15;
    }

    .subtext {
      margin-top:5px;
      font-size:12px;
      line-height:1.15;
    }

    /* Keep interactive affordances finger-friendly without visually bloating them. */
    button.control,
    .battery-status,
    .info-button,
    .nav-action,
    .temp-button {
      min-width:40px;
      min-height:40px;
    }

    .switch {
      --w:68px;
      --h:36px;
      --knob:28px;
      padding:4px;
    }

    .active .knob { transform:translateX(32px); }

    /* Dimmable lights reserve a clean lower lane for the slider. */
    .card:has(.slider-row) {
      padding-bottom:36px !important;
    }

    .slider-row {
      left:14px !important;
      right:14px !important;
      bottom:8px !important;
      width:auto !important;
      height:24px !important;
    }

    .slider-wrap,
    input[type=range] {
      height:24px !important;
    }

    .track,
    input[type=range]::-webkit-slider-runnable-track,
    input[type=range]::-moz-range-track {
      height:6px !important;
    }

    input[type=range]::-webkit-slider-thumb {
      width:22px !important;
      height:22px !important;
      margin-top:-8px !important;
      border-width:2px !important;
    }

    input[type=range]::-moz-range-thumb {
      width:20px !important;
      height:20px !important;
      border-width:2px !important;
    }

    .percent { display:none !important; }

    /* Person cards: use the same footprint as the standard icon treatment. */
    .avatar {
      width:60px !important;
      height:60px !important;
    }

    .portrait,
    .fallback {
      width:56px !important;
      height:56px !important;
    }

    .badge {
      width:22px !important;
      height:22px !important;
      top:-1px !important;
      right:-1px !important;
    }

    .badge ha-icon {
      --mdc-icon-size:12px !important;
      width:12px !important;
      height:12px !important;
    }

    /* Thermostat is intentionally full-width by default and fits a 2-row cell. */
    .thermostat-card {
      min-height:120px !important;
      grid-template-columns:48px minmax(0,1fr) !important;
      grid-template-rows:auto auto !important;
      row-gap:6px !important;
      padding:10px 12px !important;
    }

    .thermostat-card .icon-shell {
      width:44px !important;
      height:44px !important;
    }

    .thermostat-card .icon-shell ha-icon {
      --mdc-icon-size:23px !important;
      width:23px !important;
      height:23px !important;
    }

    .thermostat-card .name { font-size:16px; }
    .current { margin-top:3px !important; font-size:11px !important; }

    .thermostat-controls {
      width:min(100%,286px) !important;
      grid-template-columns:40px minmax(76px,1fr) 40px !important;
      gap:8px !important;
    }

    .temp-button {
      width:40px !important;
      height:40px !important;
    }

    .temp-button ha-icon {
      --mdc-icon-size:19px !important;
      width:19px !important;
      height:19px !important;
    }

    .target-display {
      padding:6px 9px !important;
      border-radius:10px !important;
    }

    .target { font-size:21px !important; letter-spacing:-.45px !important; }
    .target-unit { font-size:11px !important; }

    /* Standard section / phone width. */
    @container (max-width:430px) {
      .card {
        grid-template-columns:48px minmax(0,1fr) auto !important;
        column-gap:10px !important;
        padding:10px 12px !important;
        border-radius:18px !important;
      }

      .icon-shell {
        width:44px !important;
        height:44px !important;
      }

      .icon-shell ha-icon {
        --mdc-icon-size:23px !important;
        width:23px !important;
        height:23px !important;
      }

      .card:not(.thermostat-card) .content .name,
      .card:not(.thermostat-card) .content .state,
      .card:not(.thermostat-card) .content .subtext,
      .card:not(.thermostat-card) .content .sensor-label {
        white-space:nowrap !important;
        overflow:hidden !important;
        text-overflow:ellipsis !important;
        overflow-wrap:normal !important;
        display:block !important;
        -webkit-line-clamp:unset !important;
        line-clamp:unset !important;
      }

      .name {
        font-size:14.5px !important;
        line-height:1.12 !important;
        white-space:nowrap !important;
        overflow:hidden !important;
        text-overflow:ellipsis !important;
        display:block !important;
      }

      .state {
        margin-top:3px !important;
        font-size:11.5px !important;
        line-height:1.12 !important;
        white-space:nowrap !important;
        overflow:hidden !important;
        text-overflow:ellipsis !important;
        display:block !important;
      }

      .subtext,
      .sensor-label {
        margin-top:3px !important;
        font-size:10.5px !important;
        line-height:1.12 !important;
        white-space:nowrap !important;
        overflow:hidden !important;
        text-overflow:ellipsis !important;
        display:block !important;
      }

      .avatar {
        width:46px !important;
        height:46px !important;
      }

      .portrait,
      .fallback {
        width:42px !important;
        height:42px !important;
      }

      .badge {
        width:19px !important;
        height:19px !important;
        border-width:1.5px !important;
      }

      .battery-status,
      .info-button,
      .nav-action {
        width:36px !important;
        height:36px !important;
        min-width:36px !important;
        min-height:36px !important;
      }

      .navigation-card .subtext { font-size:10.5px !important; }

      .card:has(.slider-row) {
        padding-bottom:34px !important;
      }

      .slider-row {
        left:12px !important;
        right:12px !important;
        bottom:7px !important;
      }
    }

    /* Half-section cards: prioritize the primary information, then controls. */
    @container (max-width:280px) {
      .card:not(.thermostat-card) {
        grid-template-columns:44px minmax(0,1fr) !important;
        grid-template-rows:minmax(0,1fr) auto !important;
        column-gap:8px !important;
        row-gap:6px !important;
        padding:9px 10px !important;
        border-radius:16px !important;
      }

      .icon-shell,
      .avatar {
        grid-column:1 !important;
        grid-row:1 !important;
        align-self:center !important;
        width:40px !important;
        height:40px !important;
      }

      .icon-shell ha-icon {
        --mdc-icon-size:21px !important;
        width:21px !important;
        height:21px !important;
      }

      .portrait,
      .fallback {
        width:38px !important;
        height:38px !important;
      }

      .content {
        grid-column:2 !important;
        grid-row:1 !important;
        align-self:center !important;
        min-width:0 !important;
      }

      .name {
        font-size:13.5px !important;
        line-height:1.1 !important;
      }

      .state { font-size:10.5px !important; }
      .subtext,
      .sensor-label { font-size:9.5px !important; }

      /* A basic toggle gets its own bottom lane instead of crushing the label. */
      .light-card > button.control:not(.power-toggle) {
        grid-column:1 / -1 !important;
        grid-row:2 !important;
        justify-self:end !important;
        align-self:end !important;
      }

      .power-only .power-toggle {
        display:block !important;
        grid-column:1 / -1 !important;
        grid-row:2 !important;
        justify-self:end !important;
        align-self:end !important;
      }

      .battery-status {
        grid-column:1 / -1 !important;
        grid-row:2 !important;
        justify-self:end !important;
        align-self:end !important;
      }

      /* These are redundant on narrow cards: tapping the whole card does the job. */
      .sensor-card .info-button,
      .navigation-card .nav-action {
        display:none !important;
      }

      .sensor-card {
        grid-template-rows:1fr !important;
      }

      .sensor-card .content {
        grid-row:1 !important;
      }

      .reading { margin-top:2px !important; gap:3px !important; }
      .value { font-size:23px !important; letter-spacing:-.45px !important; }
      .unit { font-size:11px !important; }

      /* Slider cards use the whole bottom edge as one large drag target. */
      .card:has(.slider-row) {
        grid-template-rows:1fr !important;
        padding-bottom:32px !important;
      }

      .card:has(.slider-row) .slider-row {
        left:10px !important;
        right:10px !important;
        bottom:6px !important;
      }

      .switch {
        --w:58px;
        --h:30px;
        --knob:22px;
        padding:4px;
      }

      .active .knob { transform:translateX(28px); }
    }

    /* Emergency narrow resize support. HA defaults prevent this in normal use. */
    @container (max-width:180px) {
      .card:not(.thermostat-card) {
        grid-template-columns:38px minmax(0,1fr) !important;
        column-gap:6px !important;
        padding-inline:8px !important;
      }

      .icon-shell,
      .avatar {
        width:36px !important;
        height:36px !important;
      }

      .portrait,
      .fallback {
        width:34px !important;
        height:34px !important;
      }

      .name { font-size:12.5px !important; }
      .state { font-size:10px !important; }
      .subtext,
      .sensor-label { display:none !important; }
    }

    @media (pointer:coarse) {
      .card { cursor:default; }
      .card:not(.unavailable):active:not(:has([data-control]:active)) { transform:none; }
    }
  `;

  class ReferenceCardBase extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode:'open' });
      this._hass = null;
      this.config = null;
      this._holdTimer = null;
      this._held = false;
    }

    set hass(value) { this._hass = value; this.update(); }
    get hass() { return this._hass; }

    getCardSize() { return 2; }
    getGridOptions() {
      return { rows:2, columns:6, min_rows:2, min_columns:6 };
    }

    entity(entityId = this.config?.entity) {
      return entityId ? this._hass?.states?.[entityId] : null;
    }

    name(state, fallback) {
      // `name` is the explicit card-level friendly-name override. If omitted,
      // Home Assistant's entity friendly_name is used automatically.
      return this.config?.name || this.config?.friendly_name || state?.attributes?.friendly_name || fallback;
    }

    entityLabel(entityId = this.config?.entity, fallback = 'Entity') {
      const objectId = String(entityId || '').split('.')[1] || '';
      if (!objectId) return fallback;
      return objectId
        .replace(/[_-]+/g, ' ')
        .replace(/\b\w/g, (char) => char.toUpperCase());
    }

    stateIcon(state, fallback = ICONS.sensor) {
      const isOn = active(state);
      if (isOn && this.config?.icon_on) return this.config.icon_on;
      if (!isOn && this.config?.icon_off) return this.config.icon_off;
      if (this.config?.icon) return this.config.icon;
      if (state?.attributes?.icon) return state.attributes.icon;

      const domain = String(state?.entity_id || this.config?.entity || '').split('.')[0];
      if (domain === 'light') return isOn ? ICONS.lightOn : ICONS.lightOff;
      if (domain === 'switch' || domain === 'input_boolean') return isOn ? ICONS.switchOn : ICONS.switchOff;
      return fallback;
    }

    stateText(state) {
      if (!state) return 'Unavailable';
      return this._hass?.formatEntityState?.(state) || String(state.state || '');
    }

    async service(domain, service, data) {
      try {
        await this._hass?.callService(domain, service, data);
        return true;
      } catch (error) {
        console.error(`[reference-glow-cards] ${domain}.${service}`, error);
        notify(this, error?.message || 'Unable to update entity');
        return false;
      }
    }

    toggle(entityId = this.config?.entity) {
      const state = this.entity(entityId);
      if (!available(state)) return;
      return this.service('homeassistant', 'toggle', { entity_id:entityId });
    }

    bindCard(card, tap, detailEntity = () => this.config?.entity) {
      if (!card) return;
      card.tabIndex = 0;
      card.setAttribute('role', 'button');

      card.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;

        if (event.target.closest('[data-control]')) return;

        this._held = false;
        clearTimeout(this._holdTimer);
        this._holdTimer = setTimeout(() => {
          this._held = true;
          moreInfo(this, detailEntity?.());
        }, 650);
      });

      ['pointerup','pointercancel'].forEach((type) => {
        card.addEventListener(type, () => {
          clearTimeout(this._holdTimer);
        });
      });

      card.addEventListener('pointerleave', () => {
        clearTimeout(this._holdTimer);
        if (!card.matches(':active')) {
        }
      });

      card.addEventListener('click', (event) => {
        if (event.target.closest('[data-control]')) return;
        if (this._held) { this._held = false; return; }
        tap?.(event);
      });

      card.addEventListener('keydown', (event) => {
        if (event.target !== card || event.repeat) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          tap?.(event);
        }
      });
    }

    disconnectedCallback() { clearTimeout(this._holdTimer); }
    render() {}
    update() {}
  }

  class ReferenceBasicLightCard extends ReferenceCardBase {
    setConfig(config) {
      if (!config?.entity) throw new Error('Reference Basic Light Card requires an entity');
      this.config = { ...config };
      this.render();
      this.update();
    }

    render() {
      this.shadowRoot.innerHTML = `
        <style>
          ${BASE_CSS}
          .card {
            --accent-rgb:255,190,57;
            --accent2-rgb:111,142,204;
            background:
              linear-gradient(135deg,rgba(255,255,255,.08),rgba(255,255,255,.015) 28%,transparent 44%),
              radial-gradient(120% 150% at -12% 42%,rgba(255,190,57,.10),transparent 65%),
              radial-gradient(90% 130% at 108% -6%,rgba(103,133,190,.10),transparent 49%),
              linear-gradient(133deg,#2a2b2c 0%,#20252b 48%,#131a22 100%);
          }
          @container (max-width:150px) {
            button.control { grid-column:1 / -1; justify-self:end; }
          }
        
          @media (max-width:600px) {
            @container (max-width:260px) {
              .card {
                grid-template-columns:50px minmax(0,1fr) !important;
                grid-template-rows:1fr auto !important;
                row-gap:7px;
                padding:10px 12px !important;
              }

              button.control {
                grid-column:1 / -1 !important;
                grid-row:2 !important;
                justify-self:end;
                align-self:end;
              }

              .content {
                grid-column:2;
                grid-row:1;
                min-width:0;
              }
            }
          }

          ${SECTIONS_CSS}
        </style>
        <div class="card glow light-card">
          <div class="icon-shell"><ha-icon class="main-icon"></ha-icon></div>
          <div class="content">
            <div class="name"></div>
            <div class="state"></div>
            <div class="subtext"></div>
          </div>
          <button class="control" type="button" data-control aria-label="Toggle">
            <span class="switch" aria-hidden="true"><span class="knob"></span></span>
          </button>
        </div>`;

      const card = this.shadowRoot.querySelector('.card');
      const button = this.shadowRoot.querySelector('button.control');
      this.bindCard(card, () => this.toggle());
      button.addEventListener('click', (event) => { event.stopPropagation(); this.toggle(); });
    }

    update() {
      const state = this.entity();
      const card = this.shadowRoot.querySelector('.card');
      if (!state || !card) return;
      const isOn = active(state);
      const isAvailable = available(state);
      setAccent(card, stateColor(this.config, isOn ? 'on' : 'off', isOn ? 'active_color' : 'inactive_color', isOn ? [255,190,57] : [132,149,170]));
      card.classList.toggle('active', isOn);
      card.classList.toggle('unavailable', !isAvailable);
      card.setAttribute('aria-pressed', String(isOn));
      card.setAttribute('aria-disabled', String(!isAvailable));
      card.setAttribute('aria-label', `${this.name(state,'Light')}: ${isAvailable ? (isOn ? 'On' : 'Off') : 'Unavailable'}`);

      this.shadowRoot.querySelector('.name').textContent = this.name(state,'Light');
      this.shadowRoot.querySelector('.state').textContent = isAvailable ? (isOn ? 'On' : 'Off') : 'Unavailable';
      const sub = this.shadowRoot.querySelector('.subtext');
      sub.textContent = this.config.subtitle || '';
      sub.hidden = !sub.textContent;
      this.shadowRoot.querySelector('.main-icon').icon = this.stateIcon(state, ICONS.light);
      const control = this.shadowRoot.querySelector('button.control');
      control.disabled = !isAvailable;
      control.setAttribute('aria-pressed', String(isOn));
    }

    static getStubConfig(hass) {
      const entity = Object.keys(hass?.states || {}).find((id) => ['light','switch','input_boolean'].includes(id.split('.')[0])) || '';
      return { entity };
    }
  }

  class ReferenceBrightnessLightCard extends ReferenceCardBase {
    getGridOptions() {
      return { rows:2, columns:12, min_rows:2, min_columns:6 };
    }

    constructor() {
      super();
      this._editing = false;
      this._refreshTimer = null;
    }

    setConfig(config) {
      if (!config?.entity) throw new Error('Reference Brightness Light Card requires an entity');
      this.config = { ...config };
      this.render();
      this.update();
    }

    render() {
      this.shadowRoot.innerHTML = `
        <style>
          ${BASE_CSS}

          /*
           * v19: same visual height as the other non-thermostat cards.
           * The icon spans the two desktop rows so the slider no longer forces
           * the entire card to become taller than a normal light/person/sensor.
           */
          .card {
            --accent-rgb:255,190,57;
            --accent2-rgb:111,142,204;

            --dim-a1:.18;
            --dim-a2:.14;
            --dim-a3:.085;
            --dim-a4:.040;
            --dim-radial:.17;
            --dim-before:.58;

            --dim-edge1:.98;
            --dim-edge2:.78;
            --dim-edge3:.80;
            --dim-edge-glow1:.72;
            --dim-edge-glow2:.28;

            --dim-icon-border:.62;
            --dim-icon-core:.25;
            --dim-icon-core2:.095;
            --dim-icon-glow1:.34;
            --dim-icon-glow2:.13;
            --dim-icon-filter:.55;

            --dim-card-glow1:.28;
            --dim-card-glow2:.14;

            height:150px;
            min-height:150px;
            max-height:150px;
            grid-template-columns:82px minmax(0,1fr);
            grid-template-rows:1fr;
            column-gap:22px;
            row-gap:0;
            padding:18px 24px 48px;
            background:
              linear-gradient(135deg,rgba(255,255,255,.08),rgba(255,255,255,.015) 28%,transparent 44%),
              radial-gradient(116% 140% at -10% 30%,rgba(255,190,57,.10),transparent 66%),
              radial-gradient(82% 105% at 110% -8%,rgba(103,133,190,.08),transparent 54%),
              linear-gradient(133deg,#2b2b2c 0%,#21252a 47%,#131a22 100%);
          }

          .icon-shell {
            grid-column:1;
            grid-row:1;
            align-self:center;
          }

          .content {
            grid-column:2;
            grid-row:1;
            align-self:center;
          }

          /*
           * Brightness now controls the strength of the card illumination.
           * The RGB accent itself stays the configured color; only its visual
           * intensity fades down with the brightness percentage.
           */
          .light-card.active {
            background:
              linear-gradient(135deg,rgba(255,255,255,.115),rgba(255,255,255,.032) 25%,transparent 43%),
              linear-gradient(
                90deg,
                rgba(var(--accent-rgb),var(--dim-a1)) 0%,
                rgba(var(--accent-rgb),var(--dim-a2)) 28%,
                rgba(var(--accent-rgb),var(--dim-a3)) 55%,
                rgba(var(--accent-rgb),var(--dim-a4)) 78%,
                rgba(var(--accent-rgb),.010) 94%,
                transparent 100%
              ),
              radial-gradient(
                138% 172% at -16% 48%,
                rgba(var(--accent-rgb),var(--dim-radial)),
                transparent 76%
              ),
              radial-gradient(
                94% 122% at 106% 2%,
                rgba(var(--accent-rgb),.035),
                transparent 66%
              ),
              linear-gradient(
                133deg,
                rgba(49,45,38,.94) 0%,
                rgba(38,38,37,.95) 49%,
                rgba(18,24,31,.97) 100%
              ) !important;
          }

          .light-card.active::before {
            opacity:var(--dim-before);
          }

          .light-card.active::after {
            background:linear-gradient(
              108deg,
              rgba(var(--accent-rgb),var(--dim-edge1)) 0%,
              rgba(var(--accent-rgb),var(--dim-edge2)) 27%,
              rgba(255,255,255,.20) 55%,
              rgba(var(--accent-rgb),var(--dim-edge3)) 100%
            );
            filter:
              drop-shadow(0 0 2px rgba(var(--accent-rgb),var(--dim-edge-glow1)))
              drop-shadow(0 0 7px rgba(var(--accent-rgb),var(--dim-edge-glow2)));
          }

          .light-card.active.glow {
            box-shadow:
              inset 0 1px 0 rgba(255,255,255,.18),
              inset 0 -1px 0 rgba(0,0,0,.46),
              inset 18px 0 48px rgba(var(--accent-rgb),.020),
              0 0 12px rgba(var(--accent-rgb),var(--dim-card-glow1)),
              0 0 28px rgba(var(--accent-rgb),var(--dim-card-glow2)),
              0 12px 28px rgba(0,0,0,.42);
          }

          .light-card.active .icon-shell {
            color:rgb(var(--accent-rgb));
            border-color:rgba(var(--accent-rgb),var(--dim-icon-border));
            background:
              radial-gradient(
                circle at 31% 23%,
                rgba(255,255,255,.22),
                rgba(255,255,255,.06) 25%,
                transparent 43%
              ),
              radial-gradient(
                circle at 50% 58%,
                rgba(var(--accent-rgb),var(--dim-icon-core)),
                rgba(var(--accent-rgb),var(--dim-icon-core2)) 50%,
                transparent 74%
              ),
              linear-gradient(145deg,#403728,#282b2d 67%,#171e25);
            box-shadow:
              inset 0 1px 0 rgba(255,255,255,.18),
              0 0 0 1px rgba(var(--accent-rgb),.10),
              0 0 15px rgba(var(--accent-rgb),var(--dim-icon-glow1)),
              0 0 28px rgba(var(--accent-rgb),var(--dim-icon-glow2)),
              0 7px 18px rgba(0,0,0,.30);
          }

          .light-card.active .icon-shell ha-icon {
            filter:
              drop-shadow(0 1px 2px rgba(0,0,0,.42))
              drop-shadow(0 0 9px rgba(var(--accent-rgb),var(--dim-icon-filter)));
          }

          @media (hover:hover) {
            .light-card.active:hover {
              box-shadow:
                inset 0 1px 0 rgba(255,255,255,.20),
                inset 18px 0 50px rgba(var(--accent-rgb),.025),
                0 0 16px rgba(var(--accent-rgb),var(--dim-card-glow1)),
                0 0 34px rgba(var(--accent-rgb),var(--dim-card-glow2)),
                0 16px 31px rgba(0,0,0,.45);
            }
          }

          .slider-row {
            position:absolute;
            z-index:7;
            left:24px;
            right:24px;
            bottom:15px;
            width:auto;
            min-width:0;
            display:block;
            height:32px;
          }

          .slider-wrap {
            position:relative;
            width:100%;
            min-width:0;
            height:32px;
            display:flex;
            align-items:center;
          }

          .track {
            position:absolute;
            left:1px;
            right:1px;
            height:9px;
            border-radius:999px;
            overflow:visible;
            background:linear-gradient(180deg,#2d333b,#252b33);
            box-shadow:
              inset 0 2px 4px rgba(0,0,0,.44),
              inset 0 1px 0 rgba(255,255,255,.04);
          }

          .track::before {
            content:'';
            position:absolute;
            inset:0 auto 0 0;
            width:var(--fill,0%);
            border-radius:inherit;
            background:linear-gradient(
              90deg,
              rgb(var(--accent-rgb)),
              rgba(var(--accent-rgb),.78)
            );
            box-shadow:
              0 0 6px rgba(var(--accent-rgb),.86),
              0 0 16px rgba(var(--accent-rgb),.36),
              inset 0 1px 0 rgba(255,255,255,.36);
          }

          input[type=range] {
            position:relative;
            z-index:3;
            width:100%;
            min-width:0;
            height:32px;
            margin:0;
            appearance:none;
            -webkit-appearance:none;
            background:transparent;
            cursor:pointer;
          }

          input[type=range]::-webkit-slider-runnable-track {
            height:9px;
            background:transparent;
          }

          input[type=range]::-moz-range-track {
            height:9px;
            background:transparent;
          }

          input[type=range]::-webkit-slider-thumb {
            appearance:none;
            -webkit-appearance:none;
            width:28px;
            height:28px;
            margin-top:-9.5px;
            border:3px solid rgb(var(--accent-rgb));
            border-radius:50%;
            background:radial-gradient(
              circle at 34% 28%,
              #fff,
              #eef2f6 58%,
              #d1d9e1
            );
            box-shadow:
              0 0 0 1px rgba(255,255,255,.30),
              0 0 8px rgba(255,255,255,.52),
              0 0 16px rgba(var(--accent-rgb),.68),
              0 5px 9px rgba(0,0,0,.42);
          }

          input[type=range]::-moz-range-thumb {
            width:24px;
            height:24px;
            border:3px solid rgb(var(--accent-rgb));
            border-radius:50%;
            background:radial-gradient(
              circle at 34% 28%,
              #fff,
              #eef2f6 58%,
              #d1d9e1
            );
            box-shadow:
              0 0 8px rgba(255,255,255,.52),
              0 0 16px rgba(var(--accent-rgb),.68),
              0 5px 9px rgba(0,0,0,.42);
          }

          input[type=range]:disabled {
            opacity:.35;
            cursor:default;
          }

          input[type=range]:focus-visible { outline:none; }

          .percent {
            position:absolute;
            right:0;
            bottom:36px;
            min-width:64px;
            padding:8px 7px;
            border:1px solid rgba(var(--accent-rgb),.55);
            border-radius:11px;
            background:
              linear-gradient(
                145deg,
                rgba(var(--accent-rgb),.11),
                rgba(255,255,255,.025)
              ),
              #25272a;
            color:rgb(var(--accent-rgb));
            font-size:14px;
            font-weight:760;
            line-height:1;
            text-align:center;
            font-variant-numeric:tabular-nums;
            box-shadow:
              inset 0 1px 0 rgba(255,255,255,.10),
              0 0 11px rgba(var(--accent-rgb),.15),
              0 4px 10px rgba(0,0,0,.25);
          }

          /*
           * The tooltip is only enabled by the phone container query below.
           * On desktop/tablet the permanent percentage badge is retained.
           */
          .slider-tooltip {
            display:none;
          }

          .light-card:not(.active) .track {
            background:linear-gradient(180deg,#252b32,#1c2229);
            box-shadow:
              inset 0 2px 4px rgba(0,0,0,.50),
              inset 0 1px 0 rgba(255,255,255,.025);
          }

          .light-card:not(.active) .track::before {
            background:#687482;
            box-shadow:none;
          }

          .light-card:not(.active) input[type=range]::-webkit-slider-thumb {
            border-color:#7b8794;
            box-shadow:
              0 0 0 1px rgba(255,255,255,.12),
              0 4px 8px rgba(0,0,0,.40);
          }

          .light-card:not(.active) input[type=range]::-moz-range-thumb {
            border-color:#7b8794;
            box-shadow:0 4px 8px rgba(0,0,0,.40);
          }

          .light-card:not(.active) .percent {
            border-color:rgba(135,149,166,.27);
            background:
              linear-gradient(
                145deg,
                rgba(255,255,255,.035),
                rgba(255,255,255,.008)
              ),
              #1b2026;
            color:#8994a1;
            box-shadow:
              inset 0 1px 0 rgba(255,255,255,.055),
              0 4px 9px rgba(0,0,0,.24);
          }

          .power-toggle { display:none; }
          .power-only .slider-row { display:none; }
          .power-only {
            height:150px;
            min-height:150px;
            max-height:150px;
            grid-template-columns:82px minmax(0,1fr) auto;
            grid-template-rows:auto;
            padding:22px 25px;
          }
          .power-only .icon-shell {
            grid-column:1;
            grid-row:1;
          }
          .power-only .content {
            grid-column:2;
            grid-row:1;
            align-self:center;
          }
          .power-only .power-toggle {
            display:block;
            grid-column:3;
            grid-row:1;
          }

          /* Slider interaction feedback. */

          /*
           * Compact phone mode:
           * - same 78px baseline height as the other non-thermostat cards
           * - no permanent percentage badge
           * - slider gets the entire card width
           * - percentage appears only as a floating tooltip while dragging
           */
          @container (max-width:430px) {
            /*
             * Dimmable cards need a little more vertical room than the
             * one-action cards because the slider is a second control row.
             * 94px keeps the phone layout compact without crushing the text.
             */
            .card {
              height:94px;
              min-height:94px;
              max-height:94px;
              grid-template-columns:50px minmax(0,1fr);
              grid-template-rows:1fr;
              column-gap:10px;
              row-gap:0;
              padding:10px 12px 27px;
              border-radius:18px;
            }

            .icon-shell {
              grid-column:1;
              grid-row:1;
              align-self:center;
              justify-self:center;
              width:46px;
              height:46px;
            }

            .icon-shell ha-icon {
              --mdc-icon-size:24px;
              width:24px;
              height:24px;
            }

            .content {
              grid-column:2;
              grid-row:1;
              align-self:center;
              min-height:0;
              padding-bottom:0;
            }

            .content .name {
              font-size:14.5px;
              line-height:1.08;
              letter-spacing:-.10px;
            }

            .content .state {
              margin-top:2px;
              font-size:11.5px;
              line-height:1.08;
            }

            .content .subtext {
              margin-top:2px;
              font-size:10px;
              line-height:1.05;
            }

            .name,
            .state,
            .subtext {
              white-space:nowrap;
              overflow:hidden;
              text-overflow:ellipsis;
            }

            /*
             * Match the target layout: the slider begins at the text column,
             * not underneath the icon, and runs to the right card padding.
             */
            .slider-row {
              position:absolute;
              z-index:8;
              left:12px;
              right:12px;
              bottom:8px;
              width:auto;
              min-width:0;
              display:block;
              height:18px;
            }

            .slider-wrap {
              position:relative;
              width:100%;
              min-width:0;
              height:18px;
              display:flex;
              align-items:center;
            }

            .track {
              left:0;
              right:0;
              height:5px;
            }

            input[type=range] {
              width:100%;
              min-width:0;
              height:18px;
            }

            input[type=range]::-webkit-slider-runnable-track {
              height:5px;
            }

            input[type=range]::-moz-range-track {
              height:5px;
            }

            input[type=range]::-webkit-slider-thumb {
              width:18px;
              height:18px;
              margin-top:-6.5px;
              border-width:2px;
              transform:none !important;
              transition:none !important;
            }

            input[type=range]::-moz-range-thumb {
              width:18px;
              height:18px;
              border-width:2px;
              transform:none !important;
              transition:none !important;
            }

            .percent {
              display:none;
            }

            .slider-tooltip {
              position:absolute;
              z-index:12;
              display:block;
              left:var(--tooltip-left,50%);
              bottom:19px;
              min-width:40px;
              padding:4px 6px;
              border:1px solid rgba(var(--accent-rgb),.52);
              border-radius:8px;
              background:
                linear-gradient(
                  145deg,
                  rgba(var(--accent-rgb),.14),
                  rgba(255,255,255,.035)
                ),
                rgba(19,24,30,.96);
              color:#f8fafc;
              font-size:10px;
              line-height:1;
              font-weight:760;
              text-align:center;
              font-variant-numeric:tabular-nums;
              box-shadow:
                inset 0 1px 0 rgba(255,255,255,.10),
                0 0 10px rgba(var(--accent-rgb),.24),
                0 4px 10px rgba(0,0,0,.34);
              pointer-events:none;
              opacity:0;
              transform:translateX(-50%);
              transition:opacity .10s linear;
            }

            .slider-tooltip::after {
              content:'';
              position:absolute;
              left:50%;
              top:100%;
              width:7px;
              height:7px;
              border-right:1px solid rgba(var(--accent-rgb),.40);
              border-bottom:1px solid rgba(var(--accent-rgb),.40);
              background:rgba(19,24,30,.96);
              transform:translate(-50%,-4px) rotate(45deg);
            }

            .card.slider-interacting .slider-tooltip {
              opacity:1;
              transform:translateX(-50%);
            }

            /*
             * Non-dimmable fallback stays the same compact height as a
             * standard light card because it has no slider row.
             */
            .power-only {
              height:94px;
              min-height:94px;
              max-height:94px;
              grid-template-columns:50px minmax(0,1fr) auto;
              grid-template-rows:1fr;
              column-gap:10px;
              padding:9px 12px;
            }

            .power-only .icon-shell {
              grid-column:1;
              grid-row:1;
              width:44px;
              height:44px;
            }

            .power-only .content {
              grid-column:2;
              grid-row:1;
              align-self:center;
              padding-bottom:0;
            }

            .power-only .power-toggle {
              display:block;
              position:static;
              grid-column:3;
              grid-row:1;
              align-self:center;
            }
          }

          /*
           * Only reflow controls once the card is genuinely too narrow.
           * Normal phone widths keep the compact 78px layout.
           */
          @container (max-width:150px) {
            /*
             * At very narrow widths the slider may use the whole lower row
             * so it remains practical to drag. The card gains only a few
             * pixels instead of collapsing the slider.
             */
            .card:not(.power-only) {
              height:94px;
              min-height:94px;
              max-height:94px;
              padding-bottom:27px;
            }

            .card:not(.power-only) .slider-row {
              left:8px;
              right:8px;
              bottom:7px;
            }

            .card:not(.power-only) .name,
            .card:not(.power-only) .state,
            .card:not(.power-only) .subtext {
              white-space:nowrap;
              overflow:hidden;
              text-overflow:ellipsis;
            }

            .power-only {
              height:94px;
              min-height:94px;
              max-height:94px;
              grid-template-columns:44px minmax(0,1fr) auto;
              grid-template-rows:1fr;
              column-gap:6px;
              padding:8px;
            }

            .power-only .power-toggle {
              grid-column:3;
              grid-row:1;
              justify-self:end;
            }

            .power-only .name,
            .power-only .state,
            .power-only .subtext {
              white-space:nowrap;
              overflow:hidden;
              text-overflow:ellipsis;
            }
          }
        
          @media (max-width:600px) {
            .card:not(.power-only) {
              padding-bottom:31px;
            }

            .card:not(.power-only) .content .name {
              white-space:normal !important;
              overflow:hidden !important;
              text-overflow:clip !important;
              overflow-wrap:anywhere;
              display:-webkit-box !important;
              -webkit-box-orient:vertical;
              -webkit-line-clamp:2;
              line-clamp:2;
            }

            .card:not(.power-only) .content .state,
            .card:not(.power-only) .content .subtext {
              white-space:normal !important;
              overflow:hidden !important;
              text-overflow:clip !important;
            }

            .card:not(.power-only) .content .subtext {
              display:-webkit-box !important;
              -webkit-box-orient:vertical;
              -webkit-line-clamp:1;
              line-clamp:1;
            }

            /* Keep the full-width slider across the phone card. */
            .card:not(.power-only) .slider-row {
              left:12px;
              right:12px;
              bottom:8px;
            }

            .power-only {
              height:112px !important;
              min-height:112px !important;
              max-height:112px !important;
            }
          }

        
          @media (max-width:600px) {
            .card:not(.power-only) {
              height:112px !important;
              min-height:112px !important;
              max-height:112px !important;
              padding-bottom:31px !important;
            }

            .card:not(.power-only) .content .name {
              white-space:normal !important;
              overflow:hidden !important;
              text-overflow:clip !important;
              overflow-wrap:anywhere;
              display:-webkit-box !important;
              -webkit-box-orient:vertical;
              -webkit-line-clamp:2;
              line-clamp:2;
            }

            /* Slider uses the full inner width of the card. */
            .card:not(.power-only) .slider-row {
              left:12px !important;
              right:12px !important;
              bottom:8px !important;
              width:auto !important;
            }

            .power-only {
              height:112px !important;
              min-height:112px !important;
              max-height:112px !important;
            }

            @container (max-width:260px) {
              .card:not(.power-only) {
                height:128px !important;
                min-height:128px !important;
                max-height:128px !important;
                padding-bottom:33px !important;
              }

              .card:not(.power-only) {
                grid-template-columns:50px minmax(0,1fr) !important;
                grid-template-rows:1fr !important;
              }

              .card:not(.power-only) .slider-row {
                left:10px !important;
                right:10px !important;
                bottom:9px !important;
              }

              .power-only {
                height:128px !important;
                min-height:128px !important;
                max-height:128px !important;
                grid-template-columns:50px minmax(0,1fr) !important;
                grid-template-rows:1fr auto !important;
                row-gap:7px;
                padding:10px 12px !important;
              }

              .power-only .power-toggle {
                grid-column:1 / -1 !important;
                grid-row:2 !important;
                justify-self:end;
                align-self:end;
              }

              .power-only .content {
                grid-column:2 !important;
                grid-row:1 !important;
              }
            }
          }

          ${SECTIONS_CSS}
        </style>

        <div class="card glow light-card">
          <div class="icon-shell">
            <ha-icon class="main-icon"></ha-icon>
          </div>

          <div class="content">
            <div class="name"></div>
            <div class="state"></div>
            <div class="subtext"></div>
          </div>

          <button
            class="control power-toggle"
            type="button"
            data-control
            aria-label="Toggle"
          >
            <span class="switch">
              <span class="knob"></span>
            </span>
          </button>

          <div class="slider-row" data-control>
            <div class="slider-wrap">
              <div class="track" aria-hidden="true"></div>
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                value="0"
                aria-label="Brightness"
              >
              <div class="slider-tooltip" aria-hidden="true">0%</div>
            </div>
            <div class="percent">0%</div>
          </div>
        </div>`;

      const card = this.shadowRoot.querySelector('.card');
      const slider = this.shadowRoot.querySelector('input[type=range]');
      const power = this.shadowRoot.querySelector('.power-toggle');

      this.bindCard(card, () => this.toggle());

      const startSliderFeedback = () => {
        // Used only to reveal the compact percentage tooltip.
        card.classList.add('slider-interacting');
      };

      const stopSliderFeedback = () => {
        card.classList.remove('slider-interacting');
      };

      const commitSliderFeedback = () => {
        // No press/commit animation; just hide the drag tooltip.
        stopSliderFeedback();
      };

      slider.addEventListener('pointerdown', () => {
        startSliderFeedback();
      });

      slider.addEventListener('pointerup', () => {
        stopSliderFeedback();
        card.classList.remove('control-pressed');
      });

      slider.addEventListener('focus', () => {
        if (this._editing) startSliderFeedback();
      });

      slider.addEventListener('input', () => {
        this._editing = true;
        startSliderFeedback();

        const value = Number(slider.value);
        this.paint(value);
        card.classList.toggle('active', value > 0);
      });

      slider.addEventListener('change', () => {
        this._editing = false;
        commitSliderFeedback();
        this.commit(Number(slider.value));
      });

      slider.addEventListener('pointercancel', () => {
        stopSliderFeedback();
        card.classList.remove('control-pressed');
        this._editing = false;
        this.update();
      });

      slider.addEventListener('blur', stopSliderFeedback);

      power.addEventListener('click', (event) => {
        event.stopPropagation();
        this.toggle();
      });
    }

    brightnessEntityId() {
      if (this.config?.brightness_entity) {
        return this.config.brightness_entity;
      }

      return this.config?.entity?.startsWith('light.')
        ? this.config.entity
        : null;
    }

    currentBrightness() {
      const state = this.entity(this.brightnessEntityId());

      if (!state || state.state !== 'on') return 0;

      const raw = Number(state.attributes?.brightness);

      /*
       * A few integrations report "on" before a brightness attribute arrives.
       * Treat that as fully lit instead of visually fading the card to 0%.
       */
      if (!Number.isFinite(raw)) return 100;

      return clamp(Math.round((raw / 255) * 100), 0, 100);
    }

    applyBrightnessVisual(value) {
      const card = this.shadowRoot.querySelector('.card');
      if (!card) return;

      const pct = clamp(Math.round(Number(value) || 0), 0, 100);
      const level = pct / 100;

      /*
       * Keep a small amount of color at very low non-zero brightness so "on"
       * still reads as on, then scale smoothly up to the full target look.
       */
      const visual = pct > 0 ? 0.18 + (0.82 * level) : 0;

      const set = (name, value) => {
        card.style.setProperty(name, String(value.toFixed(4)));
      };

      set('--dim-a1', .035 + (.145 * visual));
      set('--dim-a2', .025 + (.115 * visual));
      set('--dim-a3', .014 + (.071 * visual));
      set('--dim-a4', .007 + (.033 * visual));
      set('--dim-radial', .025 + (.145 * visual));
      set('--dim-before', .14 + (.44 * visual));

      set('--dim-edge1', .30 + (.68 * visual));
      set('--dim-edge2', .22 + (.56 * visual));
      set('--dim-edge3', .24 + (.56 * visual));
      set('--dim-edge-glow1', .08 + (.64 * visual));
      set('--dim-edge-glow2', .035 + (.245 * visual));

      set('--dim-icon-border', .20 + (.42 * visual));
      set('--dim-icon-core', .035 + (.215 * visual));
      set('--dim-icon-core2', .015 + (.080 * visual));
      set('--dim-icon-glow1', .045 + (.295 * visual));
      set('--dim-icon-glow2', .020 + (.110 * visual));
      set('--dim-icon-filter', .10 + (.45 * visual));

      set('--dim-card-glow1', .055 + (.225 * visual));
      set('--dim-card-glow2', .025 + (.115 * visual));
    }

    paint(value) {
      const pct = clamp(Math.round(Number(value) || 0), 0, 100);
      const slider = this.shadowRoot.querySelector('input[type=range]');
      const track = this.shadowRoot.querySelector('.track');
      const percent = this.shadowRoot.querySelector('.percent');
      const tooltip = this.shadowRoot.querySelector('.slider-tooltip');

      if (!slider || !track) return;

      slider.value = String(pct);
      track.style.setProperty('--fill', `${pct}%`);

      if (percent) percent.textContent = `${pct}%`;

      if (tooltip) {
        tooltip.textContent = `${pct}%`;

        /*
         * Native range thumbs do not travel from x=0 to x=100%; their center
         * travels from half a thumb-width to width-half a thumb-width.
         * Correct for the 17px compact thumb so the tooltip follows the thumb
         * precisely instead of following the raw track percentage.
         *
         * x = pct% + thumbWidth * (0.5 - pct/100)
         */
        const thumbWidth = 18;
        const correction = thumbWidth * (0.5 - (pct / 100));
        tooltip.style.setProperty(
          '--tooltip-left',
          `calc(${pct}% + ${correction.toFixed(2)}px)`
        );
      }

      this.applyBrightnessVisual(pct);
    }

    async commit(value) {
      const entityId = this.brightnessEntityId();
      const state = this.entity(entityId);

      if (
        !entityId ||
        !available(state) ||
        !supportsBrightness(state)
      ) {
        this.update();
        return;
      }

      const pct = clamp(Math.round(Number(value) || 0), 0, 100);

      clearTimeout(this._refreshTimer);

      const ok = await this.service(
        'light',
        pct === 0 ? 'turn_off' : 'turn_on',
        {
          entity_id:entityId,
          ...(pct > 0 ? { brightness_pct:pct } : {}),
        }
      );

      this._refreshTimer = setTimeout(
        () => this.update(),
        ok ? 300 : 0
      );
    }

    update() {
      const state = this.entity();
      const card = this.shadowRoot.querySelector('.card');

      if (!state || !card) return;

      const isOn = active(state);
      const isAvailable = available(state);

      setAccent(
        card,
        stateColor(
          this.config,
          isOn ? 'on' : 'off',
          isOn ? 'active_color' : 'inactive_color',
          isOn ? [255,190,57] : [132,149,170]
        )
      );

      const dimEntity = this.entity(this.brightnessEntityId());
      const canDim = Boolean(
        available(dimEntity) &&
        supportsBrightness(dimEntity)
      );

      card.classList.toggle('active', isOn);
      card.classList.toggle('unavailable', !isAvailable);
      card.classList.toggle('power-only', !canDim);

      card.setAttribute('aria-pressed', String(isOn));
      card.setAttribute('aria-disabled', String(!isAvailable));

      this.shadowRoot.querySelector('.name').textContent =
        this.name(state,'Dimmable Light');

      this.shadowRoot.querySelector('.state').textContent =
        isAvailable
          ? (isOn ? 'On' : 'Off')
          : 'Unavailable';

      const sub = this.shadowRoot.querySelector('.subtext');
      sub.textContent = this.config.subtitle || '';
      sub.hidden = !sub.textContent;

      this.shadowRoot.querySelector('.main-icon').icon =
        this.stateIcon(state, ICONS.light);

      const slider = this.shadowRoot.querySelector('input[type=range]');
      slider.disabled = !canDim;

      if (!this._editing) {
        this.paint(canDim ? this.currentBrightness() : 0);
      }

      const powerToggle =
        this.shadowRoot.querySelector('.power-toggle');

      powerToggle.disabled = !isAvailable;
      powerToggle.setAttribute('aria-pressed', String(isOn));
    }

    disconnectedCallback() {
      super.disconnectedCallback();
      clearTimeout(this._refreshTimer);
    }

    static getStubConfig(hass) {
      const entity =
        Object.keys(hass?.states || {}).find(
          (id) =>
            id.startsWith('light.') &&
            supportsBrightness(hass.states[id])
        ) ||
        Object.keys(hass?.states || {}).find(
          (id) => ['light','switch'].includes(id.split('.')[0])
        ) ||
        '';

      return { entity };
    }
  }

  class ReferencePersonCard extends ReferenceCardBase {
    setConfig(config) {
      if (!config?.entity) throw new Error('Reference Person Picture Card requires a person entity');
      this.config = { ...config };
      this.render();
      this.update();
    }

    render() {
      this.shadowRoot.innerHTML = `
        <style>
          ${BASE_CSS}
          .card { grid-template-columns:92px minmax(0,1fr) auto; }

          .person-home {
            background:
              linear-gradient(135deg,rgba(255,255,255,.105),rgba(255,255,255,.026) 26%,transparent 43%),
              linear-gradient(90deg,rgba(var(--accent-rgb),.115),rgba(var(--accent-rgb),.050) 56%,rgba(var(--accent-rgb),.012) 88%,transparent 100%),
              radial-gradient(122% 158% at -12% 44%,rgba(var(--accent-rgb),.115),transparent 72%),
              linear-gradient(133deg,rgba(24,44,38,.94) 0%,rgba(23,37,37,.95) 44%,rgba(15,25,31,.97) 100%);
          }
          .person-zone {
            background:
              linear-gradient(135deg,rgba(255,255,255,.105),rgba(255,255,255,.026) 26%,transparent 43%),
              linear-gradient(90deg,rgba(var(--accent-rgb),.115),rgba(var(--accent-rgb),.050) 56%,rgba(var(--accent-rgb),.012) 88%,transparent 100%),
              radial-gradient(122% 158% at -12% 44%,rgba(var(--accent-rgb),.120),transparent 72%),
              linear-gradient(133deg,rgba(27,45,62,.94) 0%,rgba(23,35,50,.95) 44%,rgba(14,23,34,.97) 100%);
          }
          /* Away is deliberately one hue: red only, no purple second accent. */
          .person-away {
            background:
              linear-gradient(135deg,rgba(255,255,255,.095),rgba(255,255,255,.023) 26%,transparent 43%),
              linear-gradient(90deg,rgba(var(--accent-rgb),.130),rgba(var(--accent-rgb),.055) 58%,rgba(var(--accent-rgb),.014) 90%,transparent 100%),
              radial-gradient(124% 158% at -12% 44%,rgba(var(--accent-rgb),.135),transparent 73%),
              linear-gradient(133deg,rgba(48,29,32,.94) 0%,rgba(37,27,30,.95) 46%,rgba(20,22,27,.97) 100%);
          }
          .person-unknown {
            background:
              linear-gradient(135deg,rgba(255,255,255,.055),rgba(255,255,255,.012) 28%,transparent 44%),
              linear-gradient(133deg,#252b31 0%,#1b2128 48%,#11171e 100%);
          }

          .avatar {
            position:relative;
            z-index:3;
            width:82px;
            height:82px;
            display:grid;
            place-items:center;
            justify-self:center;
          }
          .portrait,.fallback {
            width:76px;
            height:76px;
            display:grid;
            place-items:center;
            overflow:hidden;
            border-radius:50%;
            border:2px solid rgb(var(--accent-rgb));
            background:linear-gradient(145deg,#28364a,#172033);
            box-shadow:
              0 0 0 1px rgba(var(--accent-rgb),.20),
              0 0 12px rgba(var(--accent-rgb),.78),
              0 0 25px rgba(var(--accent-rgb),.30),
              0 7px 17px rgba(0,0,0,.34);
          }
          .portrait { object-fit:cover; object-position:center; }
          .fallback ha-icon { --mdc-icon-size:32px; color:rgb(var(--accent-rgb)); }

          .badge {
            position:absolute;
            top:-2px;
            right:-2px;
            width:30px;
            height:30px;
            display:grid;
            place-items:center;
            padding:0;
            overflow:hidden;
            border-radius:50%;
            border:2px solid rgb(var(--accent-rgb));
            background:
              radial-gradient(circle at 35% 28%,rgba(var(--accent-rgb),.12),transparent 38%),
              linear-gradient(145deg,rgba(24,30,39,.98),rgba(7,11,17,.99));
            color:rgb(var(--accent-rgb));
            box-shadow:
              inset 0 1px 0 rgba(255,255,255,.09),
              0 0 0 1px rgba(var(--accent-rgb),.16),
              0 0 8px rgba(var(--accent-rgb),.82),
              0 0 17px rgba(var(--accent-rgb),.38),
              0 4px 9px rgba(0,0,0,.36);
          }
          .badge ha-icon {
            --mdc-icon-size:17px;
            width:17px;
            height:17px;
            display:grid;
            place-items:center;
            color:rgb(var(--accent-rgb));
            filter:drop-shadow(0 0 5px rgba(var(--accent-rgb),.62));
          }

          .person-away .portrait,.person-away .fallback {
            filter:grayscale(1) saturate(.08);
            opacity:.62;
          }
          .person-unknown .portrait,.person-unknown .fallback {
            filter:grayscale(1);
            opacity:.45;
          }

          /* Battery is intentionally only a symbol: no pill, ring or visible percentage. */
          .battery-status {
            position:relative;
            z-index:6;
            width:32px;
            height:32px;
            min-width:32px;
            display:grid;
            place-items:center;
            padding:0;
            border:0 !important;
            border-radius:8px !important;
            background:transparent !important;
            color:rgb(var(--accent-rgb));
            box-shadow:none !important;
            opacity:.92;
            transition:opacity .16s ease,transform .16s ease;
          }
          @media (hover:hover) { .battery-status:hover { opacity:1; } }
          .battery-status:active { transform:scale(.92); }
          .battery-status ha-icon {
            --mdc-icon-size:26px;
            width:26px;
            height:26px;
            color:rgb(var(--accent-rgb));
            filter:drop-shadow(0 0 4px rgba(var(--accent-rgb),.20));
          }
          .battery-status[hidden] { display:none !important; }

          @container (max-width:430px) {
            .card { grid-template-columns:50px minmax(0,1fr) auto; height:94px; min-height:94px; max-height:94px; }
            .avatar { width:46px; height:46px; }
            .portrait,.fallback { width:42px; height:42px; }
            .badge { width:19px; height:19px; border-width:1.5px; }
            .badge ha-icon { --mdc-icon-size:10px; width:10px; height:10px; }
            .battery-status { width:25px; height:25px; min-width:25px; }
            .battery-status ha-icon { --mdc-icon-size:20px; width:20px; height:20px; }
          }
          @container (max-width:150px) {
            .card { grid-template-columns:58px minmax(0,1fr); row-gap:8px; }
            .battery-status { grid-column:1/-1; justify-self:end; }
          }
          @container (max-width:140px) {
            .card { grid-template-columns:50px minmax(0,1fr); }
            .avatar { width:48px; height:48px; }
            .portrait,.fallback { width:44px; height:44px; }
          }
        
          @media (max-width:600px) {
            @container (max-width:260px) {
              .card {
                grid-template-columns:50px minmax(0,1fr) !important;
                grid-template-rows:1fr auto !important;
                row-gap:6px;
                padding:10px 12px !important;
              }

              .avatar {
                grid-column:1;
                grid-row:1;
                align-self:center;
              }

              .content {
                grid-column:2;
                grid-row:1;
                min-width:0;
              }

              .battery-status {
                grid-column:1 / -1 !important;
                grid-row:2 !important;
                justify-self:end;
                align-self:end;
              }
            }
          }

          ${SECTIONS_CSS}
        </style>
        <div class="card glow">
          <div class="avatar"></div>
          <div class="content">
            <div class="name"></div>
            <div class="state"></div>
          </div>
          <button class="control battery-status" type="button" data-control hidden aria-label="Battery details">
            <ha-icon class="battery-icon" icon="${ICONS.battery}"></ha-icon>
          </button>
        </div>`;

      this.bindCard(this.shadowRoot.querySelector('.card'), () => moreInfo(this, this.config.entity));
      this.shadowRoot.querySelector('.battery-status').addEventListener('click', (event) => {
        event.stopPropagation();
        if (this.config.battery_entity) moreInfo(this, this.config.battery_entity);
      });
    }

    batteryIcon(value, availableState) {
      if (!availableState || !Number.isFinite(value)) return ICONS.batteryUnknown;
      const level = clamp(Math.round(value / 10) * 10, 10, 100);
      return level >= 100 ? 'mdi:battery' : `mdi:battery-${level}`;
    }

    update() {
      const state = this.entity();
      const card = this.shadowRoot.querySelector('.card');
      if (!state || !card) return;
      const isAvailable = available(state);
      const raw = isAvailable ? String(state.state) : 'unknown';
      const presence = raw === 'home' ? 'home' : raw === 'not_home' ? 'away' : isAvailable ? 'zone' : 'unknown';
      const fallbackName = this.entityLabel(this.config.entity, 'Person');
      const displayName = this.name(state, fallbackName);
      const presenceColors = {
        home: stateColor(this.config, 'home', 'home_color', [70,223,107]),
        zone: stateColor(this.config, raw, 'zone_color', [75,169,255]),
        away: stateColor(this.config, 'away', 'away_color', [255,73,57]),
        unknown: stateColor(this.config, 'unknown', 'unknown_color', [135,145,158]),
      };
      setAccent(card, presenceColors[presence], presenceColors[presence]);

      card.classList.remove('person-home','person-zone','person-away','person-unknown');
      card.classList.add(`person-${presence}`);
      card.classList.toggle('active', presence === 'home' || presence === 'zone');
      card.classList.toggle('unavailable', !isAvailable);
      card.setAttribute('aria-label', `${displayName}: ${isAvailable ? this.stateText(state) : 'Unavailable'}`);

      this.shadowRoot.querySelector('.name').textContent = displayName;
      this.shadowRoot.querySelector('.state').textContent = isAvailable ? this.stateText(state) : 'Unavailable';
      const badgeIcon = presence === 'home' ? ICONS.home : presence === 'zone' ? ICONS.zone : presence === 'away' ? ICONS.away : ICONS.unknown;
      const picture = state.attributes?.entity_picture;
      this.shadowRoot.querySelector('.avatar').innerHTML = picture
        ? `<img class="portrait" alt="" src="${escapeHtml(picture)}"><span class="badge" aria-hidden="true"><ha-icon icon="${badgeIcon}"></ha-icon></span>`
        : `<div class="fallback"><ha-icon icon="${escapeHtml(this.config.icon || state.attributes?.icon || ICONS.person)}"></ha-icon></div><span class="badge" aria-hidden="true"><ha-icon icon="${badgeIcon}"></ha-icon></span>`;

      const battery = this.shadowRoot.querySelector('.battery-status');
      const batteryId = this.config.battery_entity;
      const batteryState = batteryId ? this.entity(batteryId) : null;
      battery.hidden = !batteryId;
      if (batteryId) {
        const batteryAvailable = available(batteryState);
        const numeric = Number(batteryState?.state);
        const hasNumber = batteryAvailable && Number.isFinite(numeric);
        const unit = String(batteryState?.attributes?.unit_of_measurement || (hasNumber ? '%' : '')).trim();
        this.shadowRoot.querySelector('.battery-icon').icon = this.batteryIcon(numeric, batteryAvailable);
        battery.setAttribute('title', batteryAvailable ? `Battery ${String(batteryState.state)}${unit ? ` ${unit}` : ''}` : 'Battery unavailable');
        battery.setAttribute('aria-label', `Battery: ${batteryAvailable ? String(batteryState.state) + (unit ? ` ${unit}` : '') : 'Unavailable'}. More details`);
      }
    }

    static getStubConfig(hass) {
      const entity = Object.keys(hass?.states || {}).find((id) => id.startsWith('person.')) || '';
      return { entity };
    }
  }

  class ReferenceSensorCard extends ReferenceCardBase {
    setConfig(config) {
      if (!config?.entity) throw new Error('Reference Sensor State Card requires an entity');
      this.config = { ...config };
      this.render();
      this.update();
    }

    render() {
      this.shadowRoot.innerHTML = `
        <style>
          ${BASE_CSS}
          .card {
            --accent-rgb:56,169,255;
            --accent2-rgb:56,169,255;
            grid-template-columns:82px minmax(0,1fr) auto;
          }

          /* Inactive sensors use the same neutral/dark treatment as an OFF light. */
          .sensor-card:not(.active) {
            border-color:rgba(128,145,166,.20);
            background:
              linear-gradient(135deg,rgba(255,255,255,.045),rgba(255,255,255,.008) 30%,transparent 48%),
              radial-gradient(95% 125% at 108% -8%,rgba(88,117,156,.055),transparent 54%),
              linear-gradient(133deg,#20262d 0%,#171d24 50%,#10161d 100%) !important;
            box-shadow:
              inset 0 1px 0 rgba(255,255,255,.075),
              inset 0 -1px 0 rgba(0,0,0,.52),
              0 9px 22px rgba(0,0,0,.36) !important;
          }
          .sensor-card:not(.active)::before { opacity:.10; }
          .sensor-card:not(.active)::after {
            background:linear-gradient(108deg,rgba(132,149,170,.28),rgba(255,255,255,.10) 55%,rgba(99,123,153,.22));
            filter:none;
          }
          .sensor-card:not(.active) .icon-shell {
            color:#7f8995;
            border-color:rgba(132,149,170,.22);
            background:
              radial-gradient(circle at 32% 24%,rgba(255,255,255,.09),rgba(255,255,255,.025) 28%,transparent 46%),
              linear-gradient(145deg,#252d35,#19212a 68%,#131a21);
            box-shadow:inset 0 1px 0 rgba(255,255,255,.07),0 6px 16px rgba(0,0,0,.30);
          }
          .sensor-card:not(.active) .icon-shell ha-icon {
            filter:drop-shadow(0 1px 2px rgba(0,0,0,.42));
          }
          .sensor-card:not(.active) .sensor-label,
          .sensor-card:not(.active) .unit { color:#87919d; }

          .sensor-card.active {
            background:
              linear-gradient(135deg,rgba(255,255,255,.11),rgba(255,255,255,.03) 26%,transparent 43%),
              linear-gradient(90deg,rgba(var(--accent-rgb),.15),rgba(var(--accent-rgb),.085) 52%,rgba(var(--accent-rgb),.030) 80%,rgba(var(--accent-rgb),.010) 95%,transparent 100%),
              radial-gradient(128% 158% at -13% 44%,rgba(var(--accent-rgb),.15),transparent 74%),
              linear-gradient(133deg,rgba(29,49,67,.94) 0%,rgba(23,38,55,.95) 49%,rgba(14,23,33,.97) 100%);
            -webkit-backdrop-filter:blur(18px) saturate(120%);
            backdrop-filter:blur(18px) saturate(120%);
            box-shadow:
              inset 0 1px 0 rgba(255,255,255,.18),
              inset 0 0 0 1px rgba(255,255,255,.015),
              inset 0 -1px 0 rgba(0,0,0,.43),
              0 0 12px rgba(var(--accent-rgb),.25),
              0 0 28px rgba(var(--accent-rgb),.11),
              0 12px 28px rgba(0,0,0,.42);
          }
          .sensor-card.active::before { opacity:.58; }
          .sensor-card.active .icon-shell {
            color:rgb(var(--accent-rgb));
            border-color:rgba(var(--accent-rgb),.60);
            background:
              radial-gradient(circle at 32% 24%,rgba(255,255,255,.20),rgba(255,255,255,.055) 25%,transparent 44%),
              radial-gradient(circle at 50% 62%,rgba(var(--accent-rgb),.21),rgba(var(--accent-rgb),.080) 50%,transparent 73%),
              linear-gradient(145deg,#27435d,#1c3044 68%,#142233);
            box-shadow:
              inset 0 1px 0 rgba(255,255,255,.13),
              0 0 0 1px rgba(var(--accent-rgb),.10),
              0 0 14px rgba(var(--accent-rgb),.31),
              0 0 26px rgba(var(--accent-rgb),.11),
              0 7px 18px rgba(0,0,0,.30);
          }
          .sensor-card.active .icon-shell ha-icon {
            filter:
              drop-shadow(0 1px 2px rgba(0,0,0,.42))
              drop-shadow(0 0 9px rgba(var(--accent-rgb),.60));
          }
          .sensor-card.activity-unavailable .icon-shell {
            filter:saturate(.55);
            opacity:.65;
          }

          .sensor-label {
            color:#9db2cb;
            font-size:15px;
            line-height:1.1;
            font-weight:520;
          }
          .reading {
            margin-top:7px;
            display:flex;
            flex-wrap:wrap;
            align-items:baseline;
            gap:7px;
            min-width:0;
          }
          .value {
            color:#f7f9fc;
            font-size:43px;
            line-height:.95;
            font-weight:770;
            letter-spacing:-1.25px;
            font-variant-numeric:tabular-nums;
            overflow-wrap:anywhere;
          }
          .unit {
            color:#bdc9d9;
            font-size:19px;
            line-height:1;
            font-weight:430;
          }

          /* Symbol-only info action, matching the person battery treatment. */
          .info-button {
            width:32px;
            height:32px;
            min-width:32px;
            display:grid;
            place-items:center;
            border:0 !important;
            border-radius:8px !important;
            background:transparent !important;
            color:#8f9aa6 !important;
            box-shadow:none !important;
            opacity:.92;
            transition:opacity .16s ease;
          }
          @media (hover:hover) {
            .info-button:hover { opacity:1; }
          }
          .info-button ha-icon {
            --mdc-icon-size:25px;
            width:25px;
            height:25px;
            display:flex;
            align-items:center;
            justify-content:center;
            filter:drop-shadow(0 0 4px rgba(var(--accent-rgb),.16));
          }
          .sensor-card.active .info-button {
            color:rgb(var(--accent-rgb)) !important;
          }

          @container (max-width:430px) {
            .card {
              grid-template-columns:50px minmax(0,1fr) auto;
              height:94px;
              min-height:94px;
              max-height:94px;
            }
            .sensor-label { font-size:10.5px; }
            .reading { margin-top:3px; gap:4px; }
            .value { font-size:25px; letter-spacing:-.55px; }
            .unit { font-size:12px; }
            .info-button {
              width:25px;
              height:25px;
              min-width:25px;
            }
            .info-button ha-icon {
              --mdc-icon-size:19px;
              width:19px;
              height:19px;
            }
          }
          @container (max-width:150px) {
            .card { grid-template-columns:50px minmax(0,1fr); }
            .info-button {
              grid-column:1/-1;
              justify-self:end;
            }
          }
        
          @media (max-width:600px) {
            .sensor-label {
              white-space:normal;
              overflow:hidden;
              overflow-wrap:anywhere;
              display:-webkit-box;
              -webkit-box-orient:vertical;
              -webkit-line-clamp:2;
              line-clamp:2;
            }

            @container (max-width:260px) {
              .card {
                grid-template-columns:50px minmax(0,1fr) !important;
                grid-template-rows:1fr auto !important;
                row-gap:5px;
                padding:10px 12px !important;
              }

              .icon-shell {
                grid-column:1;
                grid-row:1;
              }

              .content {
                grid-column:2;
                grid-row:1;
                min-width:0;
              }

              .info-button {
                grid-column:1 / -1 !important;
                grid-row:2 !important;
                justify-self:end;
                align-self:end;
              }
            }
          }

          ${SECTIONS_CSS}
        </style>

        <div class="card glow sensor-card">
          <div class="icon-shell"><ha-icon class="main-icon"></ha-icon></div>
          <div class="content">
            <div class="sensor-label"></div>
            <div class="reading">
              <span class="value"></span>
              <span class="unit"></span>
            </div>
          </div>
          <button class="control info-button" type="button" data-control aria-label="More information">
            <ha-icon icon="${ICONS.info}"></ha-icon>
          </button>
        </div>`;

      this.bindCard(this.shadowRoot.querySelector('.card'), () => moreInfo(this, this.config.entity));
      this.shadowRoot.querySelector('.info-button').addEventListener('click', (event) => {
        event.stopPropagation();
        moreInfo(this, this.config.entity);
      });
    }

    update() {
      const state = this.entity();
      const card = this.shadowRoot.querySelector('.card');
      if (!state || !card) return;

      const isAvailable = available(state);
      const unit = String(this.config.unit ?? state.attributes?.unit_of_measurement ?? '').trim();
      const numeric = Number(state.state);
      const value = isAvailable
        ? (String(state.state).trim() !== '' && Number.isFinite(numeric)
          ? new Intl.NumberFormat(this._hass?.locale?.language || 'en', {
              maximumFractionDigits:3,
            }).format(numeric)
          : String(state.state))
        : 'Unavailable';

      const activityState = this.config.active_entity ? this.entity(this.config.active_entity) : null;
      const activityAvailable = this.config.active_entity ? available(activityState) : true;
      const activitySource = activityState || state;
      const exactActiveState =
        this.config.active_state != null && String(this.config.active_state).trim() !== ''
          ? String(this.config.active_state)
          : null;

      const isActive = this.config.active_entity
        ? Boolean(
            activityAvailable &&
            (exactActiveState != null
              ? String(activityState.state) === exactActiveState
              : active(activityState))
          )
        : active(state);

      const activityKey = String(activitySource?.state ?? (isActive ? 'active' : 'inactive'));
      const sensorAccent = isActive
        ? stateColor(this.config, activityKey, 'active_color', [56,169,255])
        : stateColor(this.config, 'inactive', 'inactive_color', [132,149,170]);

      setAccent(card, sensorAccent, sensorAccent);
      card.classList.toggle('active', isActive);
      card.classList.toggle(
        'activity-unavailable',
        Boolean(this.config.active_entity && !activityAvailable)
      );
      card.classList.toggle('unavailable', !isAvailable);

      this.shadowRoot.querySelector('.sensor-label').textContent =
        this.name(state, this.entityLabel(this.config.entity,'Sensor'));
      this.shadowRoot.querySelector('.value').textContent = value;
      this.shadowRoot.querySelector('.unit').textContent = isAvailable ? unit : '';

      const stateKey = String(activitySource?.state ?? '');
      const stateMap =
        this.config.icon_states && typeof this.config.icon_states === 'object'
          ? this.config.icon_states
          : null;

      const sensorIcon =
        stateMap?.[stateKey] ||
        (isActive
          ? (this.config.icon_active || this.config.icon_on)
          : (this.config.icon_inactive || this.config.icon_off)) ||
        this.config.icon ||
        state.attributes?.icon ||
        ICONS.sensor;

      this.shadowRoot.querySelector('.main-icon').icon = sensorIcon;

      const activityText = this.config.active_entity
        ? `; activity ${activityAvailable ? String(activityState.state) : 'unavailable'}`
        : '';

      card.setAttribute(
        'aria-label',
        `${this.name(state,'Sensor')}: ${value}${unit ? ` ${unit}` : ''}${activityText}`
      );
    }

    static getStubConfig(hass) {
      const entity =
        Object.keys(hass?.states || {}).find(
          (id) =>
            id.startsWith('sensor.') &&
            hass.states[id].attributes?.unit_of_measurement
        ) ||
        Object.keys(hass?.states || {}).find((id) => id.startsWith('sensor.')) ||
        '';
      return { entity };
    }
  }


  class ReferenceThermostatCard extends ReferenceCardBase {
    getGridOptions() {
      return { rows:2, columns:12, min_rows:2, min_columns:6 };
    }

    constructor() {
      super();
      this._draftTarget = null;
      this._lastSentTarget = null;
      this._commitTimer = null;
      this._ackTimer = null;
      this._holdDelay = null;
      this._holdRepeat = null;
    }

    setConfig(config) {
      if (!config?.entity) throw new Error('Reference Thermostat Card requires a climate entity');
      this.config = { ...config };
      this.render();
      this.update();
    }

    render() {
      this.shadowRoot.innerHTML = `
        <style>
          ${BASE_CSS}

          .thermostat-card {
            height:auto;
            max-height:none;
            --accent-rgb:108,163,220;
            --accent2-rgb:108,163,220;
            min-height:188px;
            grid-template-columns:82px minmax(0,1fr);
            grid-template-rows:auto auto;
            row-gap:16px;
            background:
              linear-gradient(135deg,rgba(255,255,255,.075),rgba(255,255,255,.012) 30%,transparent 48%),
              radial-gradient(95% 125% at 108% -8%,rgba(var(--accent-rgb),.055),transparent 54%),
              linear-gradient(133deg,#20262d 0%,#171d24 50%,#10161d 100%);
          }

          .thermostat-card.heating,
          .thermostat-card.cooling {
            background:
              linear-gradient(135deg,rgba(255,255,255,.105),rgba(255,255,255,.026) 26%,transparent 44%),
              linear-gradient(90deg,rgba(var(--accent-rgb),.14),rgba(var(--accent-rgb),.075) 52%,rgba(var(--accent-rgb),.018) 88%,transparent),
              linear-gradient(133deg,rgba(42,38,36,.95),rgba(31,32,34,.96) 50%,rgba(17,23,29,.98) 100%);
            box-shadow:
              inset 0 1px 0 rgba(255,255,255,.17),
              0 0 12px rgba(var(--accent-rgb),.26),
              0 0 27px rgba(var(--accent-rgb),.11),
              0 11px 26px rgba(0,0,0,.40);
          }

          .thermostat-card.idle::after,
          .thermostat-card.off::after {
            background:
              linear-gradient(
                108deg,
                rgba(var(--accent-rgb),.34),
                rgba(255,255,255,.10) 55%,
                rgba(var(--accent-rgb),.22)
              );
            filter:none;
          }

          .thermostat-card.idle .icon-shell,
          .thermostat-card.off .icon-shell {
            color:rgb(var(--accent-rgb));
            border-color:rgba(var(--accent-rgb),.30);
            box-shadow:
              inset 0 1px 0 rgba(255,255,255,.07),
              0 0 10px rgba(var(--accent-rgb),.08),
              0 6px 16px rgba(0,0,0,.30);
          }

          .thermostat-main {
            min-width:0;
            align-self:center;
          }

          /* Only the current temperature is kept as the card subtext. */
          .current {
            margin-top:6px;
            color:#aeb9c7;
            font-size:14px;
            line-height:1.2;
            font-variant-numeric:tabular-nums;
          }

          .thermostat-controls {
            position:relative;
            z-index:7;
            grid-column:1/-1;
            grid-row:2;
            justify-self:center;
            width:min(100%,330px);
            display:grid;
            grid-template-columns:44px minmax(96px,1fr) 44px;
            align-items:center;
            gap:14px;
          }

          .target-display {
            min-width:0;
            display:flex;
            align-items:baseline;
            justify-content:center;
            gap:6px;
            padding:9px 14px;
            border:1px solid rgba(var(--accent-rgb),.26);
            border-radius:14px;
            background:
              linear-gradient(
                145deg,
                rgba(var(--accent-rgb),.075),
                rgba(255,255,255,.018)
              ),
              rgba(13,19,26,.58);
            box-shadow:
              inset 0 1px 0 rgba(255,255,255,.07),
              0 4px 12px rgba(0,0,0,.23);
          }

          .target {
            color:#f8fafc;
            font-size:29px;
            line-height:1;
            font-weight:780;
            letter-spacing:-.8px;
            font-variant-numeric:tabular-nums;
          }

          .target-unit {
            color:#b7c4d3;
            font-size:15px;
            font-weight:500;
          }

          .temp-button {
            width:44px;
            height:44px;
            display:grid;
            place-items:center;
            border:1px solid rgba(var(--accent-rgb),.32) !important;
            border-radius:50% !important;
            background:
              linear-gradient(
                145deg,
                rgba(255,255,255,.065),
                rgba(255,255,255,.012)
              ),
              rgba(14,20,27,.78) !important;
            color:rgb(var(--accent-rgb)) !important;
            box-shadow:
              inset 0 1px 0 rgba(255,255,255,.08),
              0 4px 11px rgba(0,0,0,.28);
            touch-action:none;
            -webkit-user-select:none;
            user-select:none;
          }

          .temp-button ha-icon {
            --mdc-icon-size:22px;
            width:22px;
            height:22px;
            display:flex;
            align-items:center;
            justify-content:center;
          }

          /*
           * Deliberately no :active scale/brightness/card animation.
           * Temperature changes are shown only in the target number.
           */
          .temp-button:disabled { opacity:.34; }

          @container (max-width:430px) {
            .thermostat-card {
              height:auto;
              min-height:118px;
              max-height:none;
              grid-template-columns:50px minmax(0,1fr);
              grid-template-rows:auto auto;
              row-gap:7px;
              padding-block:10px;
            }

            .current {
              margin-top:3px;
              font-size:10.5px;
            }

            .thermostat-controls {
              width:min(100%,230px);
              grid-template-columns:30px minmax(72px,1fr) 30px;
              gap:7px;
            }

            .target-display {
              padding:5px 8px;
              border-radius:8px;
            }

            .target {
              font-size:18px;
              letter-spacing:-.35px;
            }

            .target-unit { font-size:10px; }

            .temp-button {
              width:30px;
              height:30px;
            }

            .temp-button ha-icon {
              --mdc-icon-size:16px;
              width:16px;
              height:16px;
            }
          }

          @container (max-width:210px) {
            .thermostat-controls {
              width:100%;
              grid-template-columns:28px minmax(58px,1fr) 28px;
              gap:5px;
            }
            .target { font-size:16px; }
          }
          ${SECTIONS_CSS}
        </style>

        <div class="card thermostat-card idle">
          <div class="icon-shell">
            <ha-icon class="main-icon"></ha-icon>
          </div>

          <div class="content thermostat-main">
            <div class="name"></div>
            <div class="current"></div>
          </div>

          <div class="thermostat-controls" data-control>
            <button
              class="control temp-button temp-down"
              type="button"
              aria-label="Decrease target temperature"
            >
              <ha-icon icon="${ICONS.minus}"></ha-icon>
            </button>

            <div class="target-display" aria-live="polite">
              <span class="target"></span>
              <span class="target-unit"></span>
            </div>

            <button
              class="control temp-button temp-up"
              type="button"
              aria-label="Increase target temperature"
            >
              <ha-icon icon="${ICONS.plus}"></ha-icon>
            </button>
          </div>
        </div>`;

      const card = this.shadowRoot.querySelector('.card');
      this.bindCard(card, () => moreInfo(this, this.config.entity));

      this.bindTemperatureButton(
        this.shadowRoot.querySelector('.temp-down'),
        -1
      );
      this.bindTemperatureButton(
        this.shadowRoot.querySelector('.temp-up'),
        1
      );
    }

    bindTemperatureButton(button, direction) {
      if (!button) return;

      button.addEventListener('pointerdown', (event) => {
        if (event.button !== 0 || button.disabled) return;

        event.stopPropagation();

        try {
          button.setPointerCapture?.(event.pointerId);
        } catch (_) {}

        this.stopTemperatureHold();
        this.adjustDraft(direction);

        /*
         * One immediate step, then repeat while held.
         * Every repeated step resets the 2-second service debounce.
         */
        this._holdDelay = setTimeout(() => {
          this._holdRepeat = setInterval(() => {
            if (!button.disabled) this.adjustDraft(direction);
          }, 125);
        }, 420);
      });

      const stop = (event) => {
        event?.stopPropagation?.();
        this.stopTemperatureHold();
        this.shadowRoot.querySelector('.thermostat-card')?.classList.remove('control-pressed');
      };

      button.addEventListener('pointerup', stop);
      button.addEventListener('pointercancel', stop);
      button.addEventListener('lostpointercapture', stop);

      /*
       * Pointer interaction is handled on pointerdown so holding works.
       * A keyboard-generated click has detail === 0 and gets one step here.
       */
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        if (event.detail === 0 && !button.disabled) {
          this.adjustDraft(direction);
        }
      });
    }

    stopTemperatureHold() {
      clearTimeout(this._holdDelay);
      clearInterval(this._holdRepeat);
      this._holdDelay = null;
      this._holdRepeat = null;
    }

    unit() {
      const state = this.entity();
      return (
        state?.attributes?.temperature_unit ||
        this._hass?.config?.unit_system?.temperature ||
        '°'
      );
    }

    step() {
      const state = this.entity();
      const configured = Number(this.config?.temperature_step);
      const native = Number(state?.attributes?.target_temp_step);

      if (Number.isFinite(configured) && configured > 0) return configured;
      if (Number.isFinite(native) && native > 0) return native;
      return 0.5;
    }

    targetData(state = this.entity()) {
      const single = Number(state?.attributes?.temperature);
      if (Number.isFinite(single)) {
        return { kind:'single', value:single };
      }

      const low = Number(state?.attributes?.target_temp_low);
      const high = Number(state?.attributes?.target_temp_high);

      if (Number.isFinite(low) && Number.isFinite(high)) {
        return { kind:'range', low, high };
      }

      return { kind:'none' };
    }

    copyTarget(target) {
      if (!target) return null;
      if (target.kind === 'single') {
        return { kind:'single', value:Number(target.value) };
      }
      if (target.kind === 'range') {
        return {
          kind:'range',
          low:Number(target.low),
          high:Number(target.high),
        };
      }
      return { kind:'none' };
    }

    targetsEqual(a, b) {
      if (!a || !b || a.kind !== b.kind) return false;
      const epsilon = 0.001;

      if (a.kind === 'single') {
        return Math.abs(Number(a.value) - Number(b.value)) <= epsilon;
      }

      if (a.kind === 'range') {
        return (
          Math.abs(Number(a.low) - Number(b.low)) <= epsilon &&
          Math.abs(Number(a.high) - Number(b.high)) <= epsilon
        );
      }

      return a.kind === 'none' && b.kind === 'none';
    }

    targetText(state = this.entity()) {
      const target = this._draftTarget || this.targetData(state);

      if (target.kind === 'single') {
        return this.formatTemp(target.value);
      }

      if (target.kind === 'range') {
        return `${this.formatTemp(target.low)}–${this.formatTemp(target.high)}`;
      }

      return '—';
    }

    formatTemp(value) {
      const step = this.step();
      const digits = step < 1 ? 1 : 0;

      return Number(value).toLocaleString(
        this._hass?.locale?.language || 'en',
        {
          minimumFractionDigits:digits,
          maximumFractionDigits:digits,
        }
      );
    }

    adjustDraft(direction) {
      const state = this.entity();
      if (!available(state)) return;

      const source = this._draftTarget || this.targetData(state);
      if (!source || source.kind === 'none') return;

      const target = this.copyTarget(source);
      const delta = this.step() * direction;
      const min = Number(state.attributes?.min_temp);
      const max = Number(state.attributes?.max_temp);

      const clampTemp = (value) =>
        clamp(
          value,
          Number.isFinite(min) ? min : -100,
          Number.isFinite(max) ? max : 100
        );

      if (target.kind === 'single') {
        target.value = clampTemp(target.value + delta);
      } else {
        target.low = clampTemp(target.low + delta);
        target.high = clampTemp(target.high + delta);
      }

      this._draftTarget = target;
      this._lastSentTarget = null;

      /*
       * Do not call Home Assistant yet. Every change restarts this timer.
       * The climate.set_temperature service is called only after the target
       * has remained unchanged for 2 full seconds.
       */
      clearTimeout(this._commitTimer);
      this._commitTimer = setTimeout(() => {
        this.commitDraft();
      }, 2000);

      this.update();
    }

    async commitDraft() {
      const draft = this.copyTarget(this._draftTarget);
      if (!draft || draft.kind === 'none') return;

      clearTimeout(this._commitTimer);
      this._commitTimer = null;

      const data = { entity_id:this.config.entity };

      if (draft.kind === 'single') {
        data.temperature = draft.value;
      } else {
        data.target_temp_low = draft.low;
        data.target_temp_high = draft.high;
      }

      const ok = await this.service(
        'climate',
        'set_temperature',
        data
      );

      /*
       * The user may already have changed the draft again while this service
       * call was in flight. Never clear or overwrite that newer draft.
       */
      if (!this.targetsEqual(this._draftTarget, draft)) return;

      if (!ok) {
        this._draftTarget = null;
        this._lastSentTarget = null;
        this.update();
        return;
      }

      this._lastSentTarget = draft;

      /*
       * Normally update() clears the draft as soon as Home Assistant reports
       * the requested target. This timeout is only a fallback for devices
       * that acknowledge slowly or do not immediately echo their setpoint.
       */
      clearTimeout(this._ackTimer);
      this._ackTimer = setTimeout(() => {
        if (
          this.targetsEqual(this._draftTarget, draft) &&
          this.targetsEqual(this._lastSentTarget, draft)
        ) {
          this._draftTarget = null;
          this._lastSentTarget = null;
          this.update();
        }
      }, 5000);
    }

    update() {
      const state = this.entity();
      const card = this.shadowRoot.querySelector('.card');
      if (!state || !card) return;

      /*
       * Once HA reports the value we sent, the local draft is no longer
       * necessary. The rendered number stays identical, so there is no jump.
       */
      if (
        this._draftTarget &&
        this._lastSentTarget &&
        this.targetsEqual(this._draftTarget, this._lastSentTarget) &&
        this.targetsEqual(this.targetData(state), this._lastSentTarget)
      ) {
        this._draftTarget = null;
        this._lastSentTarget = null;
        clearTimeout(this._ackTimer);
        this._ackTimer = null;
      }

      const isAvailable = available(state);
      const action = String(
        state.attributes?.hvac_action ||
        (state.state === 'off' ? 'off' : 'idle')
      ).toLowerCase();

      const visual =
        action === 'heating'
          ? 'heating'
          : action === 'cooling'
            ? 'cooling'
            : state.state === 'off'
              ? 'off'
              : 'idle';

      const colorField =
        visual === 'heating'
          ? 'heating_color'
          : visual === 'cooling'
            ? 'cooling_color'
            : visual === 'off'
              ? 'off_color'
              : 'idle_color';

      const fallbackColor =
        visual === 'heating'
          ? [255,112,67]
          : visual === 'cooling'
            ? [75,169,255]
            : visual === 'off'
              ? [120,132,147]
              : [108,163,220];

      const accent = stateColor(
        this.config,
        visual,
        colorField,
        fallbackColor
      );

      setAccent(card, accent, accent);

      card.classList.remove('heating','cooling','idle','off');
      card.classList.add(visual);
      card.classList.toggle('unavailable', !isAvailable);

      const icon =
        this.config.icon ||
        (
          visual === 'heating'
            ? this.config.icon_heating
            : visual === 'cooling'
              ? this.config.icon_cooling
              : visual === 'off'
                ? this.config.icon_off
                : this.config.icon_idle
        ) ||
        (
          visual === 'heating'
            ? ICONS.heating
            : visual === 'cooling'
              ? ICONS.cooling
              : ICONS.thermostat
        );

      this.shadowRoot.querySelector('.main-icon').icon = icon;
      this.shadowRoot.querySelector('.name').textContent =
        this.name(
          state,
          this.entityLabel(this.config.entity, 'Thermostat')
        );

      this.shadowRoot.querySelector('.target').textContent =
        this.targetText(state);
      this.shadowRoot.querySelector('.target-unit').textContent =
        this.unit();

      /* Requested subtext: current temperature only. */
      const current = Number(state.attributes?.current_temperature);
      const currentEl = this.shadowRoot.querySelector('.current');
      currentEl.textContent = Number.isFinite(current)
        ? `${this.formatTemp(current)}${this.unit()}`
        : '';
      currentEl.hidden = !currentEl.textContent;

      const adjustable =
        isAvailable &&
        this.targetData(state).kind !== 'none';

      this.shadowRoot.querySelector('.temp-down').disabled = !adjustable;
      this.shadowRoot.querySelector('.temp-up').disabled = !adjustable;

      card.setAttribute(
        'aria-label',
        `${this.name(state,'Thermostat')}: target ${this.targetText(state)}${this.unit()}, current ${currentEl.textContent || 'unavailable'}, ${action}`
      );
    }

    disconnectedCallback() {
      super.disconnectedCallback();
      this.stopTemperatureHold();
      clearTimeout(this._commitTimer);
      clearTimeout(this._ackTimer);
    }

    static getStubConfig(hass) {
      const entity =
        Object.keys(hass?.states || {}).find(
          (id) => id.startsWith('climate.')
        ) || '';
      return { entity };
    }
  }


  class ReferenceNavigationCard extends ReferenceCardBase {
    setConfig(config) {
      if (!config?.navigation_path) throw new Error('Reference Navigation Card requires navigation_path');
      this.config = { icon:ICONS.navigate, ...config };
      this.render();
      this.update();
    }

    render() {
      this.shadowRoot.innerHTML = `
        <style>
          ${BASE_CSS}
          .navigation-card {
            --accent-rgb:116,137,255;
            --accent2-rgb:116,137,255;
            min-height:150px;
            background:
              linear-gradient(135deg,rgba(255,255,255,.09),rgba(255,255,255,.018) 27%,transparent 46%),
              linear-gradient(90deg,rgba(var(--accent-rgb),.085),rgba(var(--accent-rgb),.035) 52%,transparent 88%),
              radial-gradient(88% 120% at 110% -8%,rgba(var(--accent-rgb),.07),transparent 56%),
              linear-gradient(133deg,#22293a 0%,#192131 49%,#111823 100%);
          }
          .navigation-card .icon-shell {
            color:rgb(var(--accent-rgb));
            border-color:rgba(var(--accent-rgb),.44);
            box-shadow:inset 0 1px 0 rgba(255,255,255,.14),0 0 13px rgba(var(--accent-rgb),.18),0 7px 18px rgba(0,0,0,.30);
          }
          .navigation-card .subtext { margin-top:7px; color:#a9b1bf; font-size:15px; }
          .nav-action {
            position:relative;
            z-index:4;
            width:42px;
            height:42px;
            display:grid;
            place-items:center;
            border-radius:50%;
            border:1px solid rgba(var(--accent-rgb),.28);
            background:rgba(12,18,27,.52);
            color:rgb(var(--accent-rgb));
            box-shadow:inset 0 1px 0 rgba(255,255,255,.06),0 0 12px rgba(var(--accent-rgb),.11),0 4px 10px rgba(0,0,0,.25);
            transition:transform .18s ease,box-shadow .18s ease;
          }
          .nav-action ha-icon { --mdc-icon-size:23px; width:23px; height:23px; }
          .navigation-card:active .nav-action { transform:translateX(3px); }
          @media (hover:hover) { .navigation-card:hover .nav-action { transform:translateX(3px); box-shadow:inset 0 1px 0 rgba(255,255,255,.07),0 0 16px rgba(var(--accent-rgb),.20),0 4px 10px rgba(0,0,0,.25); } }
          @container (max-width:430px) {
            .navigation-card { height:94px; min-height:94px; max-height:94px; grid-template-columns:50px minmax(0,1fr) auto; }
            .navigation-card .subtext { margin-top:3px; font-size:10.5px; }
            .nav-action { width:28px; height:28px; }
            .nav-action ha-icon { --mdc-icon-size:17px; width:17px; height:17px; }
          }
          @container (max-width:150px) {
            .navigation-card { grid-template-columns:50px minmax(0,1fr); }
            .nav-action { grid-column:1/-1; justify-self:end; }
          }
        
          @media (max-width:600px) {
            .navigation-card .subtext {
              white-space:normal !important;
              overflow:hidden !important;
              text-overflow:clip !important;
              overflow-wrap:anywhere;
              display:-webkit-box !important;
              -webkit-box-orient:vertical;
              -webkit-line-clamp:2;
              line-clamp:2;
            }

            @container (max-width:260px) {
              .navigation-card {
                grid-template-columns:50px minmax(0,1fr) !important;
                grid-template-rows:1fr auto !important;
                row-gap:6px;
                padding:10px 12px !important;
              }

              .navigation-card .content {
                grid-column:2;
                grid-row:1;
                min-width:0;
              }

              .nav-action {
                grid-column:1 / -1 !important;
                grid-row:2 !important;
                justify-self:end;
                align-self:end;
              }
            }
          }

          ${SECTIONS_CSS}
        </style>
        <div class="card glow navigation-card">
          <div class="icon-shell"><ha-icon class="main-icon"></ha-icon></div>
          <div class="content">
            <div class="name"></div>
            <div class="subtext"></div>
          </div>
          <span class="nav-action" aria-hidden="true"><ha-icon icon="${ICONS.navigate}"></ha-icon></span>
        </div>`;
      this.bindCard(this.shadowRoot.querySelector('.card'), () => this.navigate());
    }

    navigate() {
      const path = String(this.config.navigation_path || '').trim();
      if (!path) return;
      if (/^https?:\/\//i.test(path)) {
        window.location.href = path;
        return;
      }
      history.pushState(null, '', path);
      window.dispatchEvent(new CustomEvent('location-changed'));
    }

    update() {
      const card = this.shadowRoot.querySelector('.card');
      if (!card) return;
      const accent = stateColor(this.config, 'active', 'active_color', [116,137,255]);
      setAccent(card, accent, accent);
      this.shadowRoot.querySelector('.main-icon').icon = this.config.icon || ICONS.navigate;
      const name = this.config.name || 'Navigate';
      const subtext = this.config.subtitle || this.config.subtext || this.config.navigation_path;
      this.shadowRoot.querySelector('.name').textContent = name;
      this.shadowRoot.querySelector('.subtext').textContent = subtext;
      card.setAttribute('aria-label', `${name}: ${subtext}. Opens ${this.config.navigation_path}`);
    }

    static getStubConfig() {
      return { name:'Navigate', subtitle:'Open dashboard page', navigation_path:'/lovelace', icon:ICONS.navigate };
    }
  }

  class ReferenceCardsEditor extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode:'open' });
      this._hass = null;
      this._config = null;
      this.kind = 'basic';
    }

    set hass(value) { this._hass = value; this.render(); }
    setConfig(value) { this._config = { ...value }; this.render(); }

    schema() {
      const common = [
        { name:'entity', required:true, selector:{ entity:{} } },
        { name:'name', selector:{ text:{} } },
      ];
      if (this.kind === 'basic') return [...common, { name:'subtitle', selector:{ text:{} } }, { name:'icon', selector:{ icon:{} } }, { name:'icon_on', selector:{ icon:{} } }, { name:'icon_off', selector:{ icon:{} } }, { name:'active_color', selector:{ color_rgb:{} } }];
      if (this.kind === 'brightness') return [...common, { name:'brightness_entity', selector:{ entity:{ domain:'light' } } }, { name:'subtitle', selector:{ text:{} } }, { name:'icon', selector:{ icon:{} } }, { name:'icon_on', selector:{ icon:{} } }, { name:'icon_off', selector:{ icon:{} } }, { name:'active_color', selector:{ color_rgb:{} } }];
      if (this.kind === 'person') return [...common, { name:'battery_entity', selector:{ entity:{} } }, { name:'icon', selector:{ icon:{} } }, { name:'home_color', selector:{ color_rgb:{} } }, { name:'zone_color', selector:{ color_rgb:{} } }, { name:'away_color', selector:{ color_rgb:{} } }, { name:'unknown_color', selector:{ color_rgb:{} } }];
      if (this.kind === 'sensor') return [...common, { name:'unit', selector:{ text:{} } }, { name:'active_entity', selector:{ entity:{} } }, { name:'active_state', selector:{ text:{} } }, { name:'icon', selector:{ icon:{} } }, { name:'icon_active', selector:{ icon:{} } }, { name:'icon_inactive', selector:{ icon:{} } }, { name:'active_color', selector:{ color_rgb:{} } }];
      if (this.kind === 'thermostat') return [
        { name:'entity', required:true, selector:{ entity:{ domain:'climate' } } },
        { name:'name', selector:{ text:{} } },
        { name:'temperature_step', selector:{ number:{ min:0.1, max:5, step:0.1, mode:'box' } } },
        { name:'icon', selector:{ icon:{} } },
        { name:'icon_heating', selector:{ icon:{} } },
        { name:'icon_cooling', selector:{ icon:{} } },
        { name:'icon_idle', selector:{ icon:{} } },
        { name:'icon_off', selector:{ icon:{} } },
        { name:'heating_color', selector:{ color_rgb:{} } },
        { name:'cooling_color', selector:{ color_rgb:{} } },
        { name:'idle_color', selector:{ color_rgb:{} } },
        { name:'off_color', selector:{ color_rgb:{} } },
      ];
      if (this.kind === 'navigation') return [
        { name:'navigation_path', required:true, selector:{ text:{} } },
        { name:'name', selector:{ text:{} } },
        { name:'subtitle', selector:{ text:{} } },
        { name:'icon', selector:{ icon:{} } },
        { name:'active_color', selector:{ color_rgb:{} } },
      ];
      return common;
    }

    render() {
      if (!this._config) return;
      if (!this.shadowRoot.querySelector('ha-form')) {
        this.shadowRoot.innerHTML = '<style>:host{display:block}ha-form{display:block;padding:5px 0}</style><ha-form></ha-form>';
        this.shadowRoot.querySelector('ha-form').addEventListener('value-changed', (event) => {
          event.stopPropagation();
          const next = { ...this._config, ...event.detail.value };
          for (const key of ['name','friendly_name','subtitle','subtext','icon','icon_on','icon_off','icon_active','icon_inactive','icon_heating','icon_cooling','icon_idle','unit','brightness_entity','battery_entity','active_entity','active_state','temperature_step','navigation_path','active_color','inactive_color','home_color','zone_color','away_color','unknown_color','heating_color','cooling_color','idle_color','off_color']) {
            if (next[key] === '' || next[key] == null) delete next[key];
          }
          this._config = next;
          this.dispatchEvent(new CustomEvent('config-changed', {
            detail:{ config:{ ...next } }, bubbles:true, composed:true,
          }));
        });
      }
      const form = this.shadowRoot.querySelector('ha-form');
      form.hass = this._hass;
      form.data = this._config;
      form.schema = this.schema();
      form.computeLabel = (schema) => ({
        entity:'Entity',
        name:'Friendly name / name override',
        subtitle:'Subtitle / room',
        icon:'Icon override (all states)',
        icon_on:'On-state icon override',
        icon_off:'Off-state icon override',
        unit:'Unit override',
        active_entity:'Entity that controls active state',
        active_state:'Exact active state (blank = standard active states)',
        icon_active:'Active-state icon override',
        icon_inactive:'Inactive-state icon override',
        brightness_entity:'Brightness light',
        battery_entity:'Battery entity',
        temperature_step:'Temperature adjustment step',
        icon_heating:'Heating icon override',
        icon_cooling:'Cooling icon override',
        icon_idle:'Idle icon override',
        navigation_path:'Navigation path (for example /lovelace/bedroom)',
        active_color:'Active / highlight color',
        home_color:'Home color',
        zone_color:'Known-place color',
        away_color:'Away color',
        unknown_color:'Unknown / unavailable color',
        heating_color:'Heating color',
        cooling_color:'Cooling color',
        idle_color:'Idle color',
        off_color:'Off color',
      }[schema.name] || schema.name);
    }
  }

  const editorFor = (kind) => {
    const editor = document.createElement('reference-glow-cards-editor');
    editor.kind = kind;
    return editor;
  };

  ReferenceBasicLightCard.getConfigElement = () => editorFor('basic');
  ReferenceBrightnessLightCard.getConfigElement = () => editorFor('brightness');
  ReferencePersonCard.getConfigElement = () => editorFor('person');
  ReferenceSensorCard.getConfigElement = () => editorFor('sensor');
  ReferenceThermostatCard.getConfigElement = () => editorFor('thermostat');
  ReferenceNavigationCard.getConfigElement = () => editorFor('navigation');

  const define = (name, klass) => {
    if (!customElements.get(name)) customElements.define(name, klass);
  };

  // v19 names are unique so an older cached custom element cannot win.
  define('reference-glow-cards-editor', ReferenceCardsEditor);
  define('reference-basic-light-card', ReferenceBasicLightCard);
  define('reference-brightness-light-card', ReferenceBrightnessLightCard);
  define('reference-person-picture-card', ReferencePersonCard);
  define('reference-sensor-state-card', ReferenceSensorCard);
  define('reference-thermostat-card', ReferenceThermostatCard);
  define('reference-navigation-card', ReferenceNavigationCard);

  // Earlier compatible names are registered when they are still free.
  if (!customElements.get('reference-glow-cards-editor')) define('reference-glow-cards-editor', class extends ReferenceCardsEditor {});
  if (!customElements.get('reference-basic-light-card')) define('reference-basic-light-card', class extends ReferenceBasicLightCard {});
  if (!customElements.get('reference-brightness-light-card')) define('reference-brightness-light-card', class extends ReferenceBrightnessLightCard {});
  if (!customElements.get('reference-person-picture-card')) define('reference-person-picture-card', class extends ReferencePersonCard {});
  if (!customElements.get('reference-sensor-state-card')) define('reference-sensor-state-card', class extends ReferenceSensorCard {});
  if (!customElements.get('reference-thermostat-card')) define('reference-thermostat-card', class extends ReferenceThermostatCard {});
  if (!customElements.get('reference-navigation-card')) define('reference-navigation-card', class extends ReferenceNavigationCard {});

  // Legacy aliases only when not already claimed by another resource.
  if (!customElements.get('basic-light-card')) define('basic-light-card', class extends ReferenceBasicLightCard {});
  if (!customElements.get('brightness-light-card')) define('brightness-light-card', class extends ReferenceBrightnessLightCard {});
  if (!customElements.get('person-picture-card')) define('person-picture-card', class extends ReferencePersonCard {});
  if (!customElements.get('sensor-state-card')) define('sensor-state-card', class extends ReferenceSensorCard {});
  if (!customElements.get('thermostat-card')) define('thermostat-card', class extends ReferenceThermostatCard {});
  if (!customElements.get('navigation-card')) define('navigation-card', class extends ReferenceNavigationCard {});

  window.customCards = window.customCards || [];
  const cards = [
    { type:'reference-basic-light-card', name:'Reference · Light', description:'State-aware amber light card', preview:true },
    { type:'reference-brightness-light-card', name:'Reference · Dimmable Light', description:'State-aware dimmable card with glowing slider', preview:true },
    { type:'reference-person-picture-card', name:'Reference · Person', description:'Presence-colored person card with optional battery entity', preview:true },
    { type:'reference-sensor-state-card', name:'Reference · Sensor', description:'Dark inactive / blue active sensor with separate activity entity and state-aware icons', preview:true },
    { type:'reference-thermostat-card', name:'Reference · Thermostat', description:'Climate card with target between minus/plus controls and per-state colors', preview:true },
    { type:'reference-navigation-card', name:'Reference · Navigation', description:'Glass navigation card with explicit name and subtext', preview:true },
  ];
  for (const card of cards) {
    if (!window.customCards.some((item) => item.type === card.type)) window.customCards.push(card);
  }

  console.info(
    `%c REFERENCE-GLOW-CARDS %c v${VERSION} `,
    'background:#182333;color:#fff;padding:3px 6px;border-radius:4px 0 0 4px;font-weight:700',
    'background:#ffbd39;color:#111;padding:3px 6px;border-radius:0 4px 4px 0;font-weight:700'
  );
})();