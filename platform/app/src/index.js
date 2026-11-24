/**
 * Entry point for development and production PWA builds.
 */
import 'regenerator-runtime/runtime';
import { createRoot } from 'react-dom/client';
import App from './App';
import React from 'react';

/**
 * EXTENSIONS AND MODES
 * =================
 * pluginImports.js is dynamically generated from extension and mode
 * configuration at build time.
 *
 * pluginImports.js imports all of the modes and extensions and adds them
 * to the window for processing.
 */
import { modes as defaultModes, extensions as defaultExtensions } from './pluginImports';
import loadDynamicConfig from './loadDynamicConfig';
import { publicUrl } from './utils/publicUrl';
import { createArImageReadGrantSession, attachArImageReadHeaders } from './utils/arImageReadGrant';
export { history } from './utils/history';
export { preserveQueryParameters, preserveQueryStrings } from './utils/preserveQueryParameters';

loadDynamicConfig(window.config).then(async config_json => {
  // Reset Dynamic config if defined
  if (config_json !== null) {
    window.config = config_json;
  }
  window.config.routerBasename ||= publicUrl;
  // Only explicitly bound AR learner/research windows request image grants.
  // iUSCAN /bviewer and ordinary viewers return early without any new API
  // calls or injected headers. Await grants before the first metadata/pixel
  // request, rather than racing the OHIF data source initialization.
  const imageGrant = createArImageReadGrantSession({ href: window.location.href });
  if (await imageGrant.initialize()) {
    if (typeof window.config === 'function') {
      const priorConfig = window.config;
      window.config = async (...args) =>
        attachArImageReadHeaders(
          await priorConfig(...args),
          imageGrant.getHeaders,
          window.location.origin,
          imageGrant.target.studyInstanceUID
        );
    } else {
      attachArImageReadHeaders(
        window.config, imageGrant.getHeaders, window.location.origin,
        imageGrant.target.studyInstanceUID
      );
    }
    window.addEventListener('pagehide', imageGrant.dispose, { once: true });
  }


  /**
   * Combine our appConfiguration with installed extensions and modes.
   * In the future appConfiguration may contain modes added at runtime.
   *  */
  const appProps = {
    config: window ? window.config : {},
    defaultExtensions,
    defaultModes,
  };

  const container = document.getElementById('root');

  const root = createRoot(container);
  root.render(React.createElement(App, appProps));
}).catch(() => {
  // A protected attempt must not load even one ungranted DICOM frame.
  // Do not log grant tokens or case identifiers.
  const container = document.getElementById('root');
  if (container) {
    container.textContent =
      'Image access could not be verified. Close and reopen this viewer.';
  }
});
