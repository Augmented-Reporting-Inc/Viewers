import './OHIFLogo.css';

import { Icon } from '@ohif/ui';
import React from 'react';

function OHIFLogo() {
  return (
    <a
      target="_blank"
      rel="noopener noreferrer"
      className="header-brand"
      href="https://futurepacs.com/"
    >
      <img
        src="/assets/futurePACS_logo.svg"
        className="header-logo-image"
        alt=""
      />
      {/* Logo text would fit smaller displays at two lines:
       *
       * Open Health
       * Imaging Foundation
       *
       * Or as `OHIF` on really small displays
       */}
      <img
        src="/assets/futurePACS_text_logo.svg"
        className="header-logo-text"
        alt=""
      />
    </a>
  );
}

export default OHIFLogo;
