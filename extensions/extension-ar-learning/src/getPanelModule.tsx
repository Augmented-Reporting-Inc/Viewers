import React from 'react';
import CaseQuestionsPanel from './panels/CaseQuestionsPanel';

const getPanelModule = ({ commandsManager, servicesManager, extensionManager }: withAppTypes) => {
  const WrappedCaseQuestionsPanel = ({ configuration }) => {
    return (
      <CaseQuestionsPanel
        commandsManager={commandsManager}
        servicesManager={servicesManager}
        extensionManager={extensionManager}
        configuration={{
          ...configuration,
        }}
      />
    );
  };

  return [
    {
      name: 'caseQuestions',
      iconName: 'ListView',
      iconLabel: 'Questions',
      label: 'Case Questions',
      component: WrappedCaseQuestionsPanel,
    },
  ];
};

export default getPanelModule;
