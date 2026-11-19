export const BASE_CSS = `
.gis-workbench, .gis-workbench *, .gis-chat-wrap, .gis-chat-wrap *, .gis-tool-card, .gis-tool-card *,
.gis-overlay, .gis-overlay * {
  box-sizing: border-box;
}
.gis-overlay {
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  z-index: 1;
  display: flex;
  min-width: 0;
  overflow: hidden;
  pointer-events: auto;
  background: var(--dsw-alias-bg-base);
  border-right: 1px solid var(--dsw-alias-border-l1);
  box-shadow: 8px 0 28px rgba(0, 0, 0, 0.1);
}
.gis-overlay > .gis-workbench {
  flex: 1;
  min-width: 0;
}
.gis-workbench {
  --gis-map-bg: #e8ece4;
  --gis-map-grid: rgba(71, 96, 87, 0.1);
  --gis-map-glow: rgba(47, 125, 109, 0.12);
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font-family: inherit;
}
.gis-workbench.gis-dark {
  --gis-map-bg: #121b1a;
  --gis-map-grid: rgba(173, 204, 192, 0.09);
  --gis-map-glow: rgba(86, 173, 148, 0.14);
}
.gis-topbar {
  flex: none;
  min-height: 56px;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 0 16px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
}
.gis-brand { display: flex; align-items: center; gap: 10px; min-width: 0; flex: none; }
.gis-brand-mark {
  width: 34px; height: 34px; border-radius: 10px; flex: none;
  display: grid; place-items: center;
  color: var(--dsw-alias-brand-primary);
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 13%, var(--dsw-alias-bg-layer-1));
  border: 1px solid color-mix(in srgb, var(--dsw-alias-brand-primary) 24%, transparent);
}
.gis-brand-text { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.gis-brand-title { font-size: 14px; font-weight: 600; letter-spacing: 0.01em; white-space: nowrap; }
.gis-brand-sub { font-size: 11px; color: var(--dsw-alias-label-secondary); white-space: nowrap; }
.gis-topbar-center { display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1; justify-content: center; }
.gis-mode-chip {
  display: inline-flex; align-items: center; gap: 6px;
  height: 24px; padding: 0 9px; border-radius: 999px;
  font-size: 11px; font-weight: 600; white-space: nowrap;
  color: var(--dsw-alias-brand-primary);
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--dsw-alias-brand-primary) 22%, transparent);
}
.gis-mode-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--dsw-alias-brand-primary); }
.gis-topbar-meta { font-size: 11px; color: var(--dsw-alias-label-secondary); white-space: nowrap; }
.gis-topbar-actions { display: flex; align-items: center; gap: 8px; flex: none; }
.gis-btn {
  appearance: none; -webkit-appearance: none;
  height: 32px; padding: 0 11px; border-radius: 8px;
  display: inline-flex; align-items: center; justify-content: center; gap: 7px;
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  font: inherit; font-size: 12px; font-weight: 550; white-space: nowrap; cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
}
.gis-btn:hover { background: color-mix(in srgb, var(--dsw-alias-label-primary) 6%, var(--dsw-alias-bg-layer-2)); }
.gis-btn-primary {
  color: var(--dsw-alias-brand-primary);
  border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 34%, var(--dsw-alias-border-l1));
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 11%, var(--dsw-alias-bg-layer-1));
}
.gis-btn-primary:hover { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 17%, var(--dsw-alias-bg-layer-1)); }
.gis-btn:focus-visible, .gis-icon-btn:focus-visible, .gis-rail-btn:focus-visible,
.gis-layer-action:focus-visible, .gis-launcher:focus-visible, .gis-chat-collapse:focus-visible,
.gis-tool-btn:focus-visible, .gis-link-button:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px;
}
.gis-main { flex: 1; min-height: 0; display: flex; }
.gis-rail {
  flex: none; width: 56px;
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  padding: 10px 0;
  border-right: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
}
.gis-rail-btn {
  width: 38px; height: 38px; border: 0; border-radius: 10px;
  display: grid; place-items: center;
  background: transparent; color: var(--dsw-alias-label-secondary);
  cursor: pointer; transition: background 120ms ease, color 120ms ease;
}
.gis-rail-btn:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.gis-rail-btn.is-active {
  color: var(--dsw-alias-brand-primary);
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, transparent);
}
.gis-rail-divider { width: 22px; height: 1px; background: var(--dsw-alias-border-l1); margin: 3px 0; }
.gis-rail-foot { margin-top: auto; display: flex; flex-direction: column; align-items: center; gap: 5px; padding-bottom: 2px; }
.gis-rail-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--dsw-alias-state-success-primary); }
.gis-rail-version { font-size: 9px; color: var(--dsw-alias-label-secondary); letter-spacing: 0.04em; }
.gis-stage { position: relative; flex: 1; min-width: 0; min-height: 0; padding: 12px; background: var(--dsw-alias-bg-base); }
.gis-map-shell.is-measuring .maplibregl-canvas,
.gis-map-shell.is-measuring .maplibregl-canvas-container { cursor: crosshair !important; }
.gis-map-shell {
  position: relative; width: 100%; height: 100%; border-radius: 14px; overflow: hidden;
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--gis-map-bg);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
}
.gis-map {
  position: absolute; inset: 0;
  background-color: var(--gis-map-bg);
  background-image:
    radial-gradient(circle at 50% 42%, var(--gis-map-glow), transparent 55%),
    linear-gradient(var(--gis-map-grid) 1px, transparent 1px),
    linear-gradient(90deg, var(--gis-map-grid) 1px, transparent 1px);
  background-size: auto, 44px 44px, 44px 44px;
}
.gis-map .maplibregl-canvas { outline: none; }
.gis-map .maplibregl-ctrl-logo { margin: 0 0 11px 11px !important; opacity: 0.72; }
.gis-map .maplibregl-ctrl-bottom-left { z-index: 3; }
.gis-map .maplibregl-ctrl-scale {
  margin: 0 0 12px 12px !important;
  border-color: var(--dsw-alias-label-secondary) !important;
  color: var(--dsw-alias-label-secondary) !important;
  background: color-mix(in srgb, var(--dsw-alias-bg-overlay) 78%, transparent) !important;
  border-radius: 4px !important;
  font-size: 9px !important;
}
.gis-map-loading, .gis-map-error {
  position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
  z-index: 3; display: flex; align-items: center; gap: 8px;
  padding: 8px 12px; border-radius: 8px;
  font-size: 11.5px; color: var(--dsw-alias-label-secondary);
  background: color-mix(in srgb, var(--dsw-alias-bg-overlay) 92%, transparent);
  border: 1px solid var(--dsw-alias-border-l1);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.08);
  pointer-events: none; white-space: nowrap;
}
.gis-map-error { color: var(--dsw-alias-state-error-primary); }
.gis-empty {
  position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
  z-index: 2; width: min(380px, calc(100% - 80px));
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  text-align: center; pointer-events: none;
}
.gis-empty-icon {
  width: 46px; height: 46px; border-radius: 14px;
  display: grid; place-items: center;
  color: var(--dsw-alias-brand-primary);
  background: color-mix(in srgb, var(--dsw-alias-bg-overlay) 88%, transparent);
  border: 1px solid color-mix(in srgb, var(--dsw-alias-brand-primary) 24%, var(--dsw-alias-border-l1));
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08);
}
.gis-empty-title { margin-top: 2px; font-size: 15px; font-weight: 650; }
.gis-empty-body { font-size: 11.5px; line-height: 1.55; color: var(--dsw-alias-label-secondary); }
.gis-empty-prompt {
  margin-top: 3px; display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 10px; border-radius: 8px;
  border: 1px dashed color-mix(in srgb, var(--dsw-alias-brand-primary) 38%, var(--dsw-alias-border-l1));
  background: color-mix(in srgb, var(--dsw-alias-bg-overlay) 86%, transparent);
  color: var(--dsw-alias-brand-primary);
  font-size: 11px; font-weight: 600; white-space: nowrap;
}
.gis-panel {
  position: absolute; top: 14px; left: 14px; z-index: 4;
  width: 296px; max-width: calc(100% - 92px); max-height: calc(100% - 92px);
  display: flex; flex-direction: column;
  padding: 10px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 12px;
  background: color-mix(in srgb, var(--dsw-alias-bg-overlay) 94%, transparent);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.09);
  backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
  overflow: auto;
}
.gis-panel-head { flex: none; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 1px 2px 7px; }
.gis-panel-head-actions { display: flex; align-items: center; gap: 5px; }
.gis-measure-close { width: 22px; height: 22px; border-radius: 6px; }
.gis-panel-title { font-size: 11px; font-weight: 650; letter-spacing: 0.04em; color: var(--dsw-alias-label-secondary); text-transform: uppercase; }
.gis-panel-count { font-size: 10px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }
.gis-layer-list { display: flex; flex-direction: column; gap: 5px; }
.gis-layer-empty {
  display: flex; flex-direction: column; gap: 6px;
  padding: 12px; border-radius: 9px;
  border: 1px dashed var(--dsw-alias-border-l2);
  background: color-mix(in srgb, var(--dsw-alias-bg-base) 68%, transparent);
}
.gis-layer-empty-title { font-size: 12px; font-weight: 600; }
.gis-layer-empty-body { font-size: 10.5px; line-height: 1.5; color: var(--dsw-alias-label-secondary); }
.gis-layer-example {
  margin-top: 2px; padding: 5px 7px; border-radius: 6px;
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 8%, transparent);
  color: var(--dsw-alias-brand-primary);
  font-size: 10px; line-height: 1.4;
}
.gis-layer-item {
  position: relative;
  display: flex; align-items: center; gap: 8px;
  cursor: grab;
  padding: 7px; border-radius: 9px;
  border: 1px solid var(--dsw-alias-border-l1);
  background: color-mix(in srgb, var(--dsw-alias-bg-layer-1) 78%, transparent);
}
.gis-layer-thumb {
  flex: none; width: 30px; height: 30px; border-radius: 7px;
  display: grid; place-items: center;
  color: var(--dsw-alias-brand-primary);
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--dsw-alias-brand-primary) 18%, transparent), transparent),
    var(--dsw-alias-bg-layer-2);
  border: 1px solid color-mix(in srgb, var(--dsw-alias-brand-primary) 20%, var(--dsw-alias-border-l1));
}
.gis-layer-copy { display: flex; flex-direction: column; gap: 1px; min-width: 0; flex: 1; }
.gis-layer-name { font-size: 12px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gis-layer-meta { font-size: 9.5px; color: var(--dsw-alias-label-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gis-layer-actions { display: flex; align-items: center; gap: 2px; flex: none; }
.gis-layer-action {
  width: 24px; height: 24px; border: 0; border-radius: 6px; padding: 0;
  display: grid; place-items: center; background: transparent;
  color: var(--dsw-alias-label-secondary); cursor: pointer;
}
.gis-layer-action:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.gis-layer-action.is-off { color: var(--dsw-alias-state-idle-primary); }
.gis-panel-foot {
  flex: none; margin-top: 8px; padding-top: 8px;
  border-top: 1px solid var(--dsw-alias-border-l1);
  font-size: 9.5px; color: var(--dsw-alias-label-secondary);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.gis-map-title-card {
  position: absolute; top: 14px; left: 50%; transform: translateX(-50%); z-index: 3;
  display: flex; flex-direction: column; align-items: center; gap: 1px;
  padding: 7px 14px; border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l1);
  background: color-mix(in srgb, var(--dsw-alias-bg-overlay) 92%, transparent);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.06);
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
  pointer-events: none; white-space: nowrap;
}
.gis-map-title-text { font-size: 12px; font-weight: 600; }
.gis-map-title-sub { font-size: 9.5px; color: var(--dsw-alias-label-secondary); letter-spacing: 0.04em; }
.gis-map-actions { position: absolute; top: 14px; right: 14px; z-index: 4; display: flex; flex-direction: column; align-items: center; gap: 6px; }
.gis-compass {
  width: 38px; height: 38px; border-radius: 50%;
  display: grid; place-items: center;
  border: 1px solid var(--dsw-alias-border-l1);
  background: color-mix(in srgb, var(--dsw-alias-bg-overlay) 94%, transparent);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.08);
}
.gis-icon-btn {
  appearance: none; -webkit-appearance: none;
  width: 34px; height: 34px; border-radius: 9px; padding: 0;
  display: grid; place-items: center;
  border: 1px solid var(--dsw-alias-border-l1);
  background: color-mix(in srgb, var(--dsw-alias-bg-overlay) 94%, transparent);
  color: var(--dsw-alias-label-primary);
  cursor: pointer; box-shadow: 0 4px 14px rgba(0, 0, 0, 0.08);
}
.gis-icon-btn:hover { background: var(--dsw-alias-bg-layer-2); }
.gis-readout {
  position: absolute; right: 14px; bottom: 14px; z-index: 4;
  display: flex; align-items: center; gap: 12px;
  padding: 6px 9px; border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l1);
  background: color-mix(in srgb, var(--dsw-alias-bg-overlay) 92%, transparent);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.06);
  pointer-events: none; font-variant-numeric: tabular-nums;
}
.gis-readout-item { display: flex; align-items: baseline; gap: 4px; }
.gis-readout-key { font-size: 8.5px; font-weight: 650; letter-spacing: 0.05em; color: var(--dsw-alias-label-secondary); text-transform: uppercase; }
.gis-readout-val { font-size: 10.5px; color: var(--dsw-alias-label-primary); min-width: 43px; }
.gis-hint {
  position: absolute; left: 50%; bottom: 14px; transform: translateX(-50%); z-index: 3;
  padding: 5px 10px; border-radius: 999px;
  font-size: 10.5px; color: var(--dsw-alias-label-secondary);
  background: color-mix(in srgb, var(--dsw-alias-bg-overlay) 88%, transparent);
  border: 1px solid var(--dsw-alias-border-l1);
  pointer-events: none; white-space: nowrap;
}
.gis-toast {
  position: absolute; top: 62px; left: 50%; transform: translateX(-50%); z-index: 9;
  padding: 7px 12px; border-radius: 8px;
  font-size: 11.5px; color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-overlay);
  border: 1px solid var(--dsw-alias-border-l1);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.14);
  animation: gis-toast-in 140ms ease-out;
}
.gis-launcher {
  appearance: none; -webkit-appearance: none;
  height: 26px; padding: 0 8px; border-radius: 7px;
  display: inline-flex; align-items: center; justify-content: center; gap: 5px;
  border: 1px solid color-mix(in srgb, var(--dsw-alias-brand-primary) 26%, var(--dsw-alias-border-l1));
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 8%, transparent);
  color: var(--dsw-alias-brand-primary);
  font: inherit; font-size: 10.5px; font-weight: 700; letter-spacing: 0.03em;
  cursor: pointer; white-space: nowrap;
}
.gis-launcher:hover { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 15%, transparent); }
.gis-chat-wrap { display: flex; flex-direction: column; height: 100%; min-height: 0; background: var(--dsw-alias-bg-base); }
.gis-chat-top {
  flex: none; display: flex; align-items: center; gap: 8px;
  padding: 6px 10px; border-bottom: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
}
.gis-chat-status-dot { flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--dsw-alias-state-success-primary); box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-state-success-primary) 15%, transparent); }
.gis-chat-meta { display: flex; flex-direction: column; gap: 0; min-width: 0; }
.gis-chat-title { font-size: 11px; font-weight: 600; white-space: nowrap; }
.gis-chat-sub { font-size: 9.5px; color: var(--dsw-alias-label-secondary); white-space: nowrap; }
.gis-chat-collapse {
  margin-left: auto; width: 24px; height: 24px; border: 0; border-radius: 6px; padding: 0;
  display: grid; place-items: center; background: transparent;
  color: var(--dsw-alias-label-secondary); cursor: pointer;
}
.gis-chat-collapse:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.gis-chat-body { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
.gis-chat-body > * { flex: 1; min-height: 0; }
.gis-chat-empty { flex: 1; display: flex; align-items: center; justify-content: center; padding: 24px; font-size: 12px; color: var(--dsw-alias-label-secondary); text-align: center; }
.gis-tool-card {
  margin: 3px 0;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-1);
  overflow: hidden;
}
.gis-tool-head { display: flex; align-items: center; gap: 9px; padding: 10px 11px; }
.gis-tool-icon {
  flex: none; width: 30px; height: 30px; border-radius: 8px;
  display: grid; place-items: center;
  color: var(--dsw-alias-brand-primary);
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 11%, transparent);
  border: 1px solid color-mix(in srgb, var(--dsw-alias-brand-primary) 20%, transparent);
}
.gis-tool-copy { display: flex; flex-direction: column; gap: 1px; min-width: 0; flex: 1; }
.gis-tool-title { font-size: 12px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gis-tool-sub { font-size: 10px; color: var(--dsw-alias-label-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gis-tool-state {
  flex: none; padding: 2px 7px; border-radius: 999px;
  font-size: 9.5px; font-weight: 650; white-space: nowrap;
  color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-bg-layer-2);
}
.gis-tool-state.is-ok { color: var(--dsw-alias-state-success-primary); background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 11%, transparent); }
.gis-tool-state.is-error { color: var(--dsw-alias-state-error-primary); background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 11%, transparent); }
.gis-tool-body { display: flex; flex-direction: column; gap: 7px; padding: 0 11px 10px; }
.gis-tool-url {
  padding: 5px 7px; border-radius: 6px;
  background: var(--dsw-alias-bg-base);
  border: 1px solid var(--dsw-alias-border-l1);
  color: var(--dsw-alias-label-secondary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 9.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.gis-tool-error {
  padding: 6px 8px; border-radius: 6px;
  color: var(--dsw-alias-state-error-primary);
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent);
  font-size: 10.5px; line-height: 1.45;
}
.gis-tool-actions { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
.gis-tool-btn, .gis-link-button {
  appearance: none; -webkit-appearance: none;
  height: 26px; padding: 0 9px; border-radius: 7px;
  display: inline-flex; align-items: center; gap: 5px;
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  font: inherit; font-size: 10.5px; font-weight: 550; cursor: pointer; white-space: nowrap;
}
.gis-tool-btn:hover, .gis-link-button:hover { background: color-mix(in srgb, var(--dsw-alias-label-primary) 6%, var(--dsw-alias-bg-layer-2)); }
.gis-tool-btn.is-primary {
  color: var(--dsw-alias-brand-primary);
  border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 30%, var(--dsw-alias-border-l1));
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 9%, transparent);
}
.gis-link-button { border-color: transparent; background: transparent; color: var(--dsw-alias-label-secondary); padding: 0 5px; }
.gis-link-button:hover { color: var(--dsw-alias-state-error-primary); background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent); }
.gis-loading-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--dsw-alias-brand-primary); animation: gis-pulse 1.1s ease-in-out infinite; }
@keyframes gis-pulse { 0%, 100% { opacity: 0.25; } 50% { opacity: 1; } }
@keyframes gis-toast-in { from { opacity: 0; transform: translate(-50%, -4px); } to { opacity: 1; transform: translate(-50%, 0); } }
@media (max-width: 1180px) {
  .gis-map-title-card { display: none; }
  .gis-topbar-center { justify-content: flex-start; }
}
@media (max-width: 940px) {
  .gis-brand-sub, .gis-topbar-meta { display: none; }
  .gis-btn-label { display: none; }
  .gis-btn { width: 32px; padding: 0; }
  .gis-rail { width: 48px; }
  .gis-stage { padding: 8px; }
  .gis-panel { width: 254px; max-width: calc(100% - 74px); }
  .gis-hint { display: none; }
}
@media (max-width: 680px) {
  .gis-mode-chip { display: none; }
  .gis-topbar { gap: 8px; padding: 0 10px; }
  .gis-brand-title { font-size: 13px; }
  .gis-panel { width: 220px; max-width: calc(100% - 62px); padding: 8px; }
  .gis-readout { gap: 7px; padding: 5px 7px; }
  .gis-readout-val { min-width: 34px; font-size: 9.5px; }
}
@media (prefers-reduced-motion: reduce) {
  .gis-loading-dot, .gis-toast { animation: none; }
}

.gis-project-control {
  display: flex; align-items: center; gap: 6px; min-width: 0; flex: none;
  padding: 3px 4px 3px 8px; border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary);
}
.gis-project-select {
  appearance: auto; -webkit-appearance: auto;
  max-width: 168px; min-width: 84px; border: 0; outline: 0;
  background: transparent; color: var(--dsw-alias-label-primary);
  font: inherit; font-size: 12px; font-weight: 550; cursor: pointer;
}
.gis-project-select:disabled { color: var(--dsw-alias-label-secondary); cursor: default; }
.gis-project-control:focus-within { border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 45%, var(--dsw-alias-border-l1)); }
.gis-icon-btn-sm { width: 26px; height: 26px; border-radius: 7px; box-shadow: none; }
.gis-layer-item.is-unsupported { opacity: 0.72; }
.gis-layer-item.is-unsupported .gis-layer-thumb { color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-2); }
.gis-modal {
  position: absolute; inset: 0; z-index: 60;
  display: grid; place-items: center; padding: 24px;
  background: color-mix(in srgb, var(--dsw-alias-bg-mask-1) 75%, transparent);
  backdrop-filter: blur(3px); -webkit-backdrop-filter: blur(3px);
  pointer-events: auto;
}
.gis-modal-card {
  width: min(820px, calc(100vw - 64px));
  max-height: min(82vh, 760px);
  display: flex; flex-direction: column;
  border-radius: 14px; overflow: hidden;
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-overlay);
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.22);
}
.gis-modal-small { width: min(420px, calc(100vw - 48px)); max-height: none; }
.gis-modal-head {
  flex: none; display: flex; align-items: center; gap: 10px;
  padding: 14px 16px; border-bottom: 1px solid var(--dsw-alias-border-l1);
}
.gis-modal-title { flex: 1; font-size: 14px; font-weight: 650; }
.gis-modal-body { flex: 1; min-height: 0; overflow: auto; padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; }
.gis-modal-actions { flex: none; display: flex; justify-content: flex-end; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--dsw-alias-border-l1); }
.gis-tabs { flex: none; display: flex; gap: 2px; padding: 0 12px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.gis-tab {
  appearance: none; -webkit-appearance: none;
  padding: 9px 10px; border: 0; border-bottom: 2px solid transparent;
  background: transparent; color: var(--dsw-alias-label-secondary);
  font: inherit; font-size: 12px; font-weight: 550; cursor: pointer; white-space: nowrap;
}
.gis-tab:hover { color: var(--dsw-alias-label-primary); }
.gis-tab.is-active { color: var(--dsw-alias-brand-primary); border-bottom-color: var(--dsw-alias-brand-primary); }
.gis-modal-message {
  flex: none; margin: 10px 16px 0; padding: 7px 9px; border-radius: 7px;
  font-size: 11px; color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1);
  overflow-wrap: anywhere;
}
.gis-field-label { font-size: 11px; font-weight: 600; color: var(--dsw-alias-label-secondary); }
.gis-input {
  width: 100%; height: 32px; padding: 0 9px; border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary);
  font: inherit; font-size: 12px; outline: 0;
}
.gis-input:focus { border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 55%, var(--dsw-alias-border-l1)); }
.gis-input-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 10.5px; }
.gis-form-error { font-size: 11px; color: var(--dsw-alias-state-error-primary); }
.gis-dataset-list { display: flex; flex-direction: column; gap: 6px; }
.gis-dataset-card {
  display: flex; align-items: center; gap: 10px;
  padding: 9px; border-radius: 10px;
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
}
.gis-dataset-icon {
  flex: none; width: 32px; height: 32px; border-radius: 8px;
  display: grid; place-items: center;
  color: var(--dsw-alias-brand-primary);
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 10%, transparent);
}
.gis-dataset-copy { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.gis-dataset-name { font-size: 12px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gis-dataset-meta { font-size: 10px; color: var(--dsw-alias-label-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gis-dataset-uri { font-size: 9.5px; color: var(--dsw-alias-label-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.gis-dataset-actions { flex: none; display: flex; align-items: center; gap: 5px; }
.gis-browse { display: flex; flex-direction: column; gap: 8px; min-height: 0; flex: 1; }
.gis-browse-bar { display: flex; align-items: center; gap: 6px; }
.gis-browse-bar .gis-input { flex: 1; }
.gis-browse-list {
  flex: 1; min-height: 180px; max-height: 330px; overflow: auto;
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 9px;
  background: var(--dsw-alias-bg-base); padding: 4px;
}
.gis-browse-row {
  display: flex; align-items: center; gap: 8px; width: 100%;
  padding: 6px 7px; border: 0; border-radius: 6px;
  background: transparent; color: var(--dsw-alias-label-primary);
  font: inherit; font-size: 12px; text-align: left; cursor: pointer;
}
.gis-browse-row:hover { background: var(--dsw-alias-bg-layer-2); }
.gis-browse-row.is-selected { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent); color: var(--dsw-alias-brand-primary); }
.gis-browse-row.is-disabled { opacity: 0.45; cursor: not-allowed; }
.gis-browse-icon { flex: none; width: 18px; display: grid; place-items: center; color: var(--dsw-alias-label-secondary); }
.gis-browse-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gis-browse-meta { flex: none; font-size: 9.5px; color: var(--dsw-alias-label-secondary); }
.gis-browse-foot { display: flex; align-items: center; gap: 8px; margin-top: 2px; }
.gis-selected-path { flex: 1; min-width: 0; font-size: 10.5px; color: var(--dsw-alias-label-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gis-upload { display: flex; flex-direction: column; gap: 10px; }
.gis-file-input { font-size: 11px; color: var(--dsw-alias-label-secondary); }
.gis-empty-note { padding: 12px; font-size: 11px; color: var(--dsw-alias-label-secondary); text-align: center; }
.gis-btn:disabled, .gis-tool-btn:disabled, .gis-link-button:disabled { opacity: 0.5; cursor: not-allowed; }
@media (max-width: 1180px) {
  .gis-project-select { max-width: 120px; }
}
@media (max-width: 940px) {
  .gis-project-control { padding: 2px 3px 2px 6px; }
  .gis-project-select { max-width: 96px; min-width: 60px; }
  .gis-modal { padding: 12px; }
  .gis-modal-card { width: calc(100vw - 24px); }
  .gis-dataset-actions .gis-tool-btn { padding: 0 6px; }
}

.gis-browse-roots { display: flex; gap: 5px; flex-wrap: wrap; }
.gis-root-chip {
  max-width: 100%; padding: 3px 7px; border-radius: 5px;
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary);
  font: inherit; font-size: 9.5px; cursor: pointer;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.gis-root-chip:hover { color: var(--dsw-alias-label-primary); }
.gis-root-chip.is-active { color: var(--dsw-alias-brand-primary); border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 35%, var(--dsw-alias-border-l1)); }

.gis-save-button { position: relative; }
.gis-save-button.is-dirty {
  border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 38%, var(--dsw-alias-border-l1));
}
.gis-save-dot {
  width: 5px; height: 5px; border-radius: 50%;
  background: var(--dsw-alias-state-warn-primary);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-state-warn-primary) 18%, transparent);
  flex: none;
}

.gis-upload-hint { font-size: 10px; color: var(--dsw-alias-brand-primary); }
.gis-upload-progress { display: flex; flex-direction: column; gap: 5px; }
.gis-progress-track {
  width: 100%; height: 7px; border-radius: 999px; overflow: hidden;
  background: var(--dsw-alias-bg-layer-2);
  border: 1px solid var(--dsw-alias-border-l1);
}
.gis-progress-fill {
  height: 100%; border-radius: inherit;
  background: linear-gradient(90deg, var(--dsw-alias-brand-primary), color-mix(in srgb, var(--dsw-alias-brand-primary) 60%, #7fbfb0));
  transition: width 160ms ease;
}
.gis-progress-meta { font-size: 10px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }
.gis-upload-status { font-size: 10.5px; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }
.gis-upload-status.is-error { color: var(--dsw-alias-state-error-primary); }

.gis-tool-panel { width: 280px; }
.gis-measure-tabs { display: flex; gap: 4px; padding: 2px 0 8px; }
.gis-measure-tabs .gis-tab {
  flex: 1; padding: 5px 8px; border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 7px; font-size: 11px;
}
.gis-measure-tabs .gis-tab.is-active {
  color: var(--dsw-alias-brand-primary);
  border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 40%, var(--dsw-alias-border-l1));
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 8%, transparent);
}
.gis-measure-value {
  font-size: 22px; font-weight: 650; letter-spacing: -0.02em;
  color: var(--dsw-alias-label-primary); font-variant-numeric: tabular-nums;
  padding: 2px 2px 6px;
}
.gis-tool-hint { font-size: 10.5px; color: var(--dsw-alias-label-secondary); line-height: 1.45; padding: 0 2px 8px; }
.gis-tool-hint.is-finished { color: var(--dsw-alias-brand-primary); font-weight: 600; }
.gis-tool-actions { display: flex; gap: 6px; flex-wrap: wrap; padding: 0 2px; }
.gis-annotation-list { display: flex; flex-direction: column; gap: 5px; max-height: 260px; overflow: auto; padding-bottom: 6px; }
.gis-annotation-row { display: flex; align-items: center; gap: 4px; }
.gis-annotation-index {
  flex: none; width: 18px; height: 18px; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  background: var(--dsw-alias-brand-primary); color: #fff;
  font-size: 9px; font-weight: 700;
}
.gis-annotation-input { height: 26px; min-width: 0; flex: 1; font-size: 10.5px; }
.gis-marker {
  min-width: 24px; height: 24px; padding: 0 6px;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 999px; border: 2px solid #fff;
  background: var(--dsw-alias-brand-primary); color: #fff;
  font: 600 11px/1 var(--dsw-font-family, sans-serif);
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.28);
  cursor: default; user-select: none;
}

.gis-database { display: flex; flex-direction: column; gap: 10px; }
.gis-db-heading { display: flex; flex-direction: column; gap: 2px; }
.gis-db-title { font-size: 13px; font-weight: 650; color: var(--dsw-alias-label-primary); }
.gis-db-list { display: flex; flex-direction: column; gap: 5px; }
.gis-db-item {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 5px 7px; border-radius: 7px; border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
}
.gis-db-item.is-active { border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 38%, var(--dsw-alias-border-l1)); }
.gis-db-select {
  display: flex; align-items: center; gap: 6px; min-width: 0;
  border: 0; background: transparent; color: var(--dsw-alias-label-primary);
  font: inherit; font-size: 11px; cursor: pointer; text-align: left;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.gis-db-form { display: grid; grid-template-columns: 1fr 1fr; gap: 7px 9px; }
.gis-db-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.gis-db-field .gis-input { height: 29px; }
.gis-db-status { font-size: 10px; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }
.gis-db-tables { display: flex; flex-direction: column; gap: 5px; border-top: 1px solid var(--dsw-alias-border-l1); padding-top: 8px; }
.gis-db-table {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 6px 7px; border-radius: 7px; border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
}
.gis-db-table-copy { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.gis-db-table-name { font-size: 11px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gis-db-table-meta { font-size: 9.5px; color: var(--dsw-alias-label-secondary); }

.gis-layer-legend { display: flex; flex-wrap: wrap; gap: 3px 7px; padding-top: 3px; }
.gis-legend-item { display: inline-flex; align-items: center; gap: 3px; font-size: 9px; color: var(--dsw-alias-label-secondary); }
.gis-legend-swatch { width: 8px; height: 8px; border-radius: 2px; flex: none; border: 1px solid rgba(0,0,0,0.08); }
.gis-legend-label { line-height: 1.1; }

.gis-context-backdrop { position: fixed; inset: 0; z-index: 80; background: transparent; }
.gis-context-menu {
  position: fixed; z-index: 81; width: 244px; max-width: calc(100vw - 16px);
  padding: 6px; border-radius: 9px;
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-overlay);
  box-shadow: 0 12px 36px rgba(0, 0, 0, 0.2);
  backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
}
.gis-context-title {
  padding: 5px 7px 6px; font-size: 10.5px; font-weight: 650;
  color: var(--dsw-alias-label-secondary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.gis-context-action {
  width: 100%; display: flex; align-items: center; gap: 7px;
  padding: 7px; border: 0; border-radius: 6px;
  background: transparent; color: var(--dsw-alias-label-primary);
  font: inherit; font-size: 11.5px; text-align: left; cursor: pointer;
}
.gis-context-action:hover { background: var(--dsw-alias-bg-layer-2); }
.gis-context-action svg { color: var(--dsw-alias-brand-primary); }

.gis-layer-item:active { cursor: grabbing; }
.gis-layer-item.is-dragging { opacity: 0.5; }
.gis-layer-item.is-drop-before::before,
.gis-layer-item.is-drop-after::after {
  content: ''; position: absolute; left: 5px; right: 5px; height: 2px;
  border-radius: 999px; background: var(--dsw-alias-brand-primary);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-brand-primary) 16%, transparent);
}
.gis-layer-item.is-drop-before::before { top: -2px; }
.gis-layer-item.is-drop-after::after { bottom: -2px; }

.gis-draw-target {
  font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-primary);
  padding: 2px 2px 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

.gis-context-subtitle { padding: 0 7px 5px; font-size: 9.5px; color: var(--dsw-alias-label-secondary); }
.gis-context-action.is-danger { color: var(--dsw-alias-state-error-primary); }
.gis-context-action.is-danger svg { color: var(--dsw-alias-state-error-primary); }

.gis-vertex-marker {
  width: 12px; height: 12px; border-radius: 50%;
  background: #ffffff; border: 2px solid #ff9f1a;
  box-shadow: 0 1px 5px rgba(0, 0, 0, 0.35);
  cursor: grab;
}
.gis-vertex-marker:active { cursor: grabbing; }
`;