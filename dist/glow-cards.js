(() => {
  'use strict';

  const VERSION = '16.0.20';
  const stylesheetUrl = new URL(`./glow-card.css?v=${VERSION}`, import.meta.url);
  const devRevision = new URL(import.meta.url).searchParams.get('dev');
  if (devRevision) stylesheetUrl.searchParams.set('dev', devRevision);
  const GLOW_CARD_CSS_URL = stylesheetUrl.href;
  const ACTIVE_STATES = new Set(['on', 'home', 'open', 'playing', 'active', 'true']);

  const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const cssColorCache = new Map();
  const cssColorTriplet = (value) => {
    const text = String(value).trim();
    if (cssColorCache.has(text)) return cssColorCache.get(text);
    if (!globalThis.CSS?.supports?.('color', text)) return null;
    const context = document.createElement('canvas').getContext('2d');
    if (!context) return null;
    context.fillStyle = text;
    const normalized = context.fillStyle;
    const hex = normalized.match(/^#([0-9a-f]{6})$/i);
    const rgb = normalized.match(/^rgba?\(\s*(\d+)\D+(\d+)\D+(\d+)/i);
    const result = hex
      ? [0,2,4].map((index) => parseInt(hex[1].slice(index,index + 2),16)).join(',')
      : rgb ? rgb.slice(1,4).map(Number).join(',') : null;
    cssColorCache.set(text, result);
    return result;
  };
  const rgbTriplet = (value, fallback = [255,190,57]) => {
    const source = value ?? fallback;
    if (Array.isArray(source) && source.length >= 3) {
      return source.slice(0,3).map((part) => clamp(Math.round(Number(part) || 0), 0, 255)).join(',');
    }
    if (typeof source === 'string') {
      const text = source.trim();
      const hex = text.match(/^#?([0-9a-f]{6})$/i);
      if (hex) return [0,2,4].map((i) => parseInt(hex[1].slice(i,i+2),16)).join(',');
      const parts = text.replace(/^[\[(]|[\])]$/g, '').split(',').map((part) => Number(part.trim()));
      if (parts.length >= 3 && parts.slice(0,3).every(Number.isFinite)) {
        return parts.slice(0,3).map((part) => clamp(Math.round(part),0,255)).join(',');
      }
      const namedColor = cssColorTriplet(text);
      if (namedColor) return namedColor;
    }
    return rgbTriplet(fallback, [255,190,57]);
  };
  const stateColor = (config, stateKey, field, fallback) => {
    return rgbTriplet(config?.[field], fallback);
  };
  // HA publishes normalized rgb_color for its supported color modes.
  const lightColor = (state) => state?.attributes?.rgb_color ?? [255,190,57];
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
  const templateBoolean = (value) => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    return ['true','yes','on','1','active','home','open'].includes(String(value ?? '').trim().toLowerCase());
  };

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

  class ReferenceCardBase extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode:'open' });
      this._hass = null;
      this.config = null;
      this._holdTimer = null;
      this._held = false;
    }

    set hass(value) { this._hass = value; this.startColorTemplates(); this.update(); }
    get hass() { return this._hass; }

    get config() { return this._config; }
    set config(value) {
      this.stopColorTemplates();
      this._rawConfig = value;
      this._config = value ? { ...value } : null;
      this._colorTemplates = [];
      this._activeTemplateResult = undefined;
      this._activeTemplateError = false;
      for (const [key, field] of Object.entries(value || {})) {
        const entries = (key === 'color' || key.endsWith('_color')) ? [[[key], field]] : [];
        for (const [path, color] of entries) {
          if (typeof color !== 'string' || !/\{[{%#]/.test(color)) continue;
          this._colorTemplates.push({ path, template:color });
          const target = path.length === 2 ? this._config[path[0]] : this._config;
          delete target[path.at(-1)];
        }
      }
      if (typeof value?.active_template === 'string' && value.active_template.trim()) {
        this._colorTemplates.push({ kind:'active', template:value.active_template });
      }
      this.startColorTemplates();
    }

    connectedCallback() { this.startColorTemplates(); }

    stopColorTemplates() {
      this._templateGeneration = (this._templateGeneration || 0) + 1;
      for (const unsubscribe of this._templateUnsubscribers || []) {
        Promise.resolve().then(unsubscribe).catch((error) => console.debug('[Glow] Template cleanup', error));
      }
      this._templateUnsubscribers = [];
      this._templateConnection = null;
    }

    startColorTemplates() {
      const connection = this._hass?.connection;
      if (!this.isConnected || !connection || !this._colorTemplates?.length || this._templateConnection === connection) return;
      this.stopColorTemplates();
      this._templateConnection = connection;
      const generation = this._templateGeneration;
      for (const { kind = 'color', path, template } of this._colorTemplates) {
        const apply = (message) => {
          if (generation !== this._templateGeneration) return;
          if (kind === 'active') {
            this._activeTemplateError = Boolean(message.error);
            this._activeTemplateResult = message.error ? false : message.result;
            if (message.error) notify(this, `Active template: ${message.error}`);
            this.update();
            return;
          }
          const target = path.length === 2 ? this._config[path[0]] : this._config;
          if (message.error) {
            delete target[path.at(-1)];
            notify(this, `Color template (${path.join('.')}): ${message.error}`);
          } else {
            target[path.at(-1)] = message.result;
          }
          this.update();
        };
        Promise.resolve().then(() => connection.subscribeMessage(apply, {
          type:'render_template', template, variables:{ config:this._rawConfig }, report_errors:true,
        })).then((unsubscribe) => {
          if (generation !== this._templateGeneration) return unsubscribe();
          this._templateUnsubscribers.push(unsubscribe);
        }).catch((error) => apply({ error:error.message || String(error) }));
      }
    }

    getCardSize() { return 2; }
    getGridOptions() { return { columns:6, min_columns:4 }; }

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

    getGridOptions() {
      const rows = this.shadowRoot?.querySelector('.grid-2-row') ? 2 : 1;
      return { rows, columns:6, min_rows:rows, max_rows:rows, min_columns:6 };
    }

    getCardSize() {
      return this.shadowRoot?.querySelector('.grid-2-row') ? 2 : 1;
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
      const icon = card.querySelector(':scope > .icon-shell, :scope > .avatar');
      const action = card.querySelector(':scope > .info-button, :scope > .battery-status, :scope > .nav-action, :scope > .control:has(.switch)');
      if (icon && action) {
        const anchor = document.createElement('div');
        anchor.className = 'icon-control';
        icon.before(anchor);
        anchor.append(icon, action);
        const badge = document.createElement('span');
        badge.className = 'badge-face compact-action';
        badge.setAttribute('aria-hidden', 'true');
        const isBattery = action.classList.contains('battery-status');
        const actionIcon = isBattery ? ICONS.battery : action.classList.contains('info-button') ? ICONS.info : action.classList.contains('nav-action') ? ICONS.navigate : 'mdi:power';
        badge.innerHTML = `<ha-icon class="${isBattery ? 'battery-icon' : ''}" icon="${actionIcon}"></ha-icon>`;
        action.append(badge);
      }
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

    disconnectedCallback() { clearTimeout(this._holdTimer); this.stopColorTemplates(); }
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
        <link rel="stylesheet" href="${GLOW_CARD_CSS_URL}">
        <div class="card grid-1-row glow light-card">
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
      setAccent(card, stateColor(this.config, isOn ? 'on' : 'off', isOn ? 'active_color' : 'inactive_color', isOn ? lightColor(state) : [132,149,170]));
      card.classList.toggle('active', isOn);
      card.classList.toggle('unavailable', !isAvailable);
      card.setAttribute('aria-pressed', String(isOn));
      card.setAttribute('aria-disabled', String(!isAvailable));
      card.setAttribute('aria-label', `${this.name(state,'Light')}: ${isAvailable ? (isOn ? 'On' : 'Off') : 'Unavailable'}`);

      this.shadowRoot.querySelector('.name').textContent = this.name(state,'Light');
      this.shadowRoot.querySelector('.state').textContent = isAvailable ? (isOn ? 'On' : 'Off') : 'Unavailable';
      const sub = this.shadowRoot.querySelector('.subtext');
      sub.textContent = '';
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
        <link rel="stylesheet" href="${GLOW_CARD_CSS_URL}">

        <div class="card grid-2-row glow light-card">
          <div class="icon-shell">
            <ha-icon class="main-icon"></ha-icon>
          </div>

          <div class="content">
            <div class="name"></div>
            <div class="state"></div>
            <div class="subtext"></div>
          </div>

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

    }

    brightnessEntityId() {
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
          isOn ? lightColor(this.entity(this.brightnessEntityId()) || state) : [132,149,170]
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
      sub.textContent = '';
      sub.hidden = !sub.textContent;

      this.shadowRoot.querySelector('.main-icon').icon =
        this.stateIcon(state, ICONS.light);

      const slider = this.shadowRoot.querySelector('input[type=range]');
      slider.disabled = !canDim;

      if (!this._editing) {
        this.paint(canDim ? this.currentBrightness() : 0);
      }

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
        <link rel="stylesheet" href="${GLOW_CARD_CSS_URL}">
        <div class="card grid-1-row glow">
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

    locationIcon(state, presence) {
      const raw = String(state?.state || '').trim();
      const normalized = raw.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
      const zone = Object.values(this._hass?.states || {}).find((candidate) => {
        if (!candidate?.entity_id?.startsWith('zone.')) return false;
        if (presence === 'home') return candidate.entity_id === 'zone.home';
        const objectId = candidate.entity_id.slice(5).toLowerCase();
        const friendlyName = String(candidate.attributes?.friendly_name || '').trim().toLowerCase();
        return presence === 'zone' && (objectId === normalized || friendlyName === raw.toLowerCase());
      });
      return zone?.attributes?.icon ||
        (presence === 'home' ? ICONS.home : presence === 'zone' ? ICONS.zone : presence === 'away' ? ICONS.away : ICONS.unknown);
    }

    isCharging(batteryState) {
      const chargingState = this.config.charging_entity ? this.entity(this.config.charging_entity) : null;
      const attributes = [chargingState?.attributes, batteryState?.attributes];
      const values = [
        chargingState?.state,
        ...attributes.flatMap((item) => item ? [item.charging, item.is_charging, item.battery_charging, item.status, item.battery_status] : []),
      ];
      return values.some((value) => value === true || ['on','true','yes','charging'].includes(String(value ?? '').trim().toLowerCase()));
    }

    batteryIcon(value, availableState, charging = false) {
      if (!availableState || !Number.isFinite(value)) return ICONS.batteryUnknown;
      const level = clamp(Math.round(value / 10) * 10, 10, 100);
      if (charging) return `mdi:battery-charging-${level}`;
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
      const badgeIcon = this.locationIcon(state, presence);
      const picture = state.attributes?.entity_picture;
      this.shadowRoot.querySelector('.avatar').innerHTML = picture
        ? `<img class="portrait" alt="" src="${escapeHtml(picture)}"><span class="badge badge-face" aria-hidden="true"><ha-icon icon="${badgeIcon}"></ha-icon></span>`
        : `<div class="fallback"><ha-icon icon="${escapeHtml(state.attributes?.icon || ICONS.person)}"></ha-icon></div><span class="badge badge-face" aria-hidden="true"><ha-icon icon="${badgeIcon}"></ha-icon></span>`;

      const battery = this.shadowRoot.querySelector('.battery-status');
      const batteryId = this.config.battery_entity;
      const batteryState = batteryId ? this.entity(batteryId) : null;
      battery.hidden = !batteryId;
      if (batteryId) {
        const batteryAvailable = available(batteryState);
        const numeric = Number(batteryState?.state);
        const hasNumber = batteryAvailable && Number.isFinite(numeric);
        const unit = String(batteryState?.attributes?.unit_of_measurement || (hasNumber ? '%' : '')).trim();
        const charging = this.isCharging(batteryState);
        this.shadowRoot.querySelectorAll('.battery-icon').forEach((icon) => {
          icon.icon = this.batteryIcon(numeric, batteryAvailable, charging);
        });
        const chargingText = charging ? ' · Charging' : '';
        battery.classList.toggle('charging', charging);
        battery.setAttribute('title', batteryAvailable ? `Battery ${String(batteryState.state)}${unit ? ` ${unit}` : ''}${chargingText}` : 'Battery unavailable');
        battery.setAttribute('aria-label', `Battery: ${batteryAvailable ? String(batteryState.state) + (unit ? ` ${unit}` : '') + (charging ? ', charging' : '') : 'Unavailable'}. More details`);
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
        <link rel="stylesheet" href="${GLOW_CARD_CSS_URL}">

        <div class="card grid-1-row glow sensor-card">
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

      const usesActiveTemplate =
        typeof this.config.active_template === 'string' &&
        this.config.active_template.trim() !== '';
      const isActive = usesActiveTemplate
        ? templateBoolean(this._activeTemplateResult)
        : active(state);
      const activitySource = state;

      const activityKey = String(activitySource?.state ?? (isActive ? 'active' : 'inactive'));
      const sensorAccent = isActive
        ? stateColor(this.config, activityKey, 'active_color', [56,169,255])
        : stateColor(this.config, 'inactive', 'inactive_color', [132,149,170]);

      setAccent(card, sensorAccent, sensorAccent);
      card.classList.toggle('active', isActive);
      card.classList.toggle(
        'activity-unavailable',
        Boolean(usesActiveTemplate && this._activeTemplateError)
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
        state.attributes?.icon ||
        ICONS.sensor;

      this.shadowRoot.querySelector('.main-icon').icon = sensorIcon;
      const subicon = this.config.subicon || ICONS.info;
      this.shadowRoot
        .querySelectorAll('.info-button > ha-icon, .info-button .compact-action ha-icon')
        .forEach((icon) => { icon.icon = subicon; });

      const activityText = usesActiveTemplate
        ? `; active ${isActive ? 'yes' : 'no'}`
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
        <link rel="stylesheet" href="${GLOW_CARD_CSS_URL}">

        <div class="card grid-2-row thermostat-card idle">
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
        <link rel="stylesheet" href="${GLOW_CARD_CSS_URL}">
        <div class="card grid-1-row glow navigation-card">
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
      const accent = stateColor(this.config, 'active', 'color', [116,137,255]);
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
      if (this.kind === 'basic') return [...common, { name:'icon_on', selector:{ icon:{} } }, { name:'icon_off', selector:{ icon:{} } }, { name:'active_color', selector:{ color_rgb:{} } }];
      if (this.kind === 'brightness') return [...common, { name:'icon_on', selector:{ icon:{} } }, { name:'icon_off', selector:{ icon:{} } }, { name:'active_color', selector:{ color_rgb:{} } }];
      if (this.kind === 'person') return [...common, { name:'battery_entity', selector:{ entity:{} } }, { name:'charging_entity', selector:{ entity:{} } }, { name:'home_color', selector:{ color_rgb:{} } }, { name:'zone_color', selector:{ color_rgb:{} } }, { name:'away_color', selector:{ color_rgb:{} } }, { name:'unknown_color', selector:{ color_rgb:{} } }];
      if (this.kind === 'sensor') return [...common, { name:'unit', selector:{ text:{} } }, { name:'active_template', selector:{ template:{} } }, { name:'icon_active', selector:{ icon:{} } }, { name:'icon_inactive', selector:{ icon:{} } }, { name:'subicon', selector:{ icon:{} } }, { name:'active_color', selector:{ color_rgb:{} } }];
      if (this.kind === 'thermostat') return [
        { name:'entity', required:true, selector:{ entity:{ domain:'climate' } } },
        { name:'name', selector:{ text:{} } },
        { name:'temperature_step', selector:{ number:{ min:0.1, max:5, step:0.1, mode:'box' } } },
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
        { name:'color', selector:{ template:{} } },
      ];
      return common;
    }

    render() {
      if (!this._config) return;
      if (!this.shadowRoot.querySelector('ha-form')) {
        this.shadowRoot.innerHTML = `<link rel="stylesheet" href="${GLOW_CARD_CSS_URL}"><ha-form></ha-form>`;
        this.shadowRoot.querySelector('ha-form').addEventListener('value-changed', (event) => {
          event.stopPropagation();
          const next = { ...this._config, ...event.detail.value };
          for (const key of ['name','friendly_name','subtitle','subtext','icon','icon_on','icon_off','icon_active','icon_inactive','subicon','icon_heating','icon_cooling','icon_idle','unit','brightness_entity','battery_entity','charging_entity','active_entity','active_state','active_template','temperature_step','navigation_path','color','active_color','inactive_color','home_color','zone_color','away_color','unknown_color','heating_color','cooling_color','idle_color','off_color']) {
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
      form.data = Object.fromEntries(Object.entries(this._config).map(([key, value]) =>
        [key, (key === 'color' || key.endsWith('_color')) && Array.isArray(value) ? JSON.stringify(value) : value]
      ));
      const schema = this.schema();
      if (['basic', 'brightness'].includes(this.kind)) schema.push({ name:'inactive_color', selector:{ text:{} } });
      form.schema = schema.map((field) => (field.name === 'color' || field.name.endsWith('_color'))
        ? { ...field, selector:{ template:{} } } : field);
      form.computeLabel = (schema) => ({
        entity:'Entity',
        name:'Friendly name / name override',
        subtitle:'Subtitle / room',
        icon:'Icon override (all states)',
        icon_on:'On-state icon override',
        icon_off:'Off-state icon override',
        unit:'Unit override',
        active_template:'Active template (true / false)',
        icon_active:'Active-state icon override',
        icon_inactive:'Inactive-state icon override',
        subicon:'Subicon',
        battery_entity:'Battery entity',
        charging_entity:'Charging entity (optional)',
        temperature_step:'Temperature adjustment step',
        icon_heating:'Heating icon override',
        icon_cooling:'Cooling icon override',
        icon_idle:'Idle icon override',
        navigation_path:'Navigation path (for example /lovelace/bedroom)',
        color:'Color',
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
