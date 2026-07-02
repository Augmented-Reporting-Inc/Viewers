import { id } from './id';
import getPanelModule from './getPanelModule';

export default {
  id,

  preRegistration: ({ servicesManager, commandsManager, configuration = {} }) => {},

  getPanelModule,
};
