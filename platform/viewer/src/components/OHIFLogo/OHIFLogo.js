import './OHIFLogo.css';

import React from 'react';

import ImgLogo from './futurePACS_logo.svg';
import TextLogo from './futurePACS_text_logo.svg';

function OHIFLogo() {
  return (
    <a
      target="_blank"
      rel="noopener noreferrer"
      className="header-brand"
      href="https://futurepacs.com/"
    >
      <ImgLogo className="header-logo-image" />
      {/* Logo text would fit smaller displays at two lines:
       *
       * Open Health
       * Imaging Foundation
       *
       * Or as `OHIF` on really small displays
       */}
      <TextLogo className="header-logo-text" />
    </a>
  );
}

export default OHIFLogo;
