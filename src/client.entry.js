import { createPlugin } from './plugin.js';

window.__ModuleLoader__.load({
  id: '@yinchuanqi/gis-workbench',
  factory(require) {
    const React = require('react');
    return createPlugin(React);
  },
});