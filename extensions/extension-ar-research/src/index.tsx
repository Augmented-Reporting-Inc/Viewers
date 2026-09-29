import { Types } from '@ohif/core';
import { id } from './id';
import getPanelModule from './getPanelModule';

const arResearchExtension = {
  id,
  getPanelModule,
};

export default arResearchExtension as Types.Extensions.Extension;
