import React, { useEffect, useState } from 'react';
import { Select } from '../../../../platform/ui/src/components';
import PropTypes from 'prop-types';
import { SyncControls } from '../components/SyncControls';

/*
 * FilterStageView panel enables the user to select dobutamine stress echo stage or view.
 */

const PROTOCOL_PREFIX = 'extension-dobutamine.hangingProtocolModule.hp';

const firstDropdownOptions = [
  { value: 'Stage', label: 'by Stage' },
  { value: 'View', label: 'by View' },
];

const secondDropdownDefaults = {
  Stage: 'DobutamineResting',
  View: 'PLAX',
};

const secondDropdownOptions = {
  Stage: [
    { value: 'DobutamineResting', label: 'Resting' },
    { value: 'LowDose', label: 'Low dose' },
    { value: 'PeakDose', label: 'Peak dose' },
    { value: 'DobutamineRecovery', label: 'Recovery' },
  ],
  View: [
    { value: 'PLAX', label: 'PLAX' },
    { value: 'SAXBase', label: 'SAX base' },
    { value: 'SAXMid', label: 'SAX mid' },
    { value: 'SAXApex', label: 'SAX apex' },
    { value: 'Apical4', label: 'Apical 4' },
    { value: 'Apical2', label: 'Apical 2' },
    { value: 'Apical3', label: 'Apical 3' },
  ],
};

const getOptionLabel = (group, value) =>
  secondDropdownOptions[group]?.find(option => option.value === value)?.label || value;

export default function FilterStageView({ servicesManager, commandsManager }) {
  const [firstDropdownValue, setFirstDropdownValue] = useState('Stage');
  const [filterBy, setFilterBy] = useState(secondDropdownDefaults.Stage);

  const handleFirstDropdownChange = option => {
    if (!option?.value) {
      return;
    }

    setFirstDropdownValue(option.value);
  };

  useEffect(() => {
    setFilterBy(secondDropdownDefaults[firstDropdownValue]);
  }, [firstDropdownValue]);

  useEffect(() => {
    if (!filterBy) {
      return;
    }

    const protocolId = `${PROTOCOL_PREFIX}${filterBy}`;
    console.log('[dobutamine] filterBy useEffect protocolID', protocolId, filterBy);

    const updateCurrentProtocol = commandsManager.runCommand('setHangingProtocol', {
      activeStudyUID: '',
      protocolId,
    });

    console.log('updateCurrentProtocol', updateCurrentProtocol);
  }, [filterBy, commandsManager]);

  const handleSecondDropdownChange = option => {
    if (!option?.value) {
      return;
    }

    setFilterBy(option.value);
  };

  return (
    <div className="invisible-scrollbar">
      <div className="flex flex-col">
        <div className="bg-primary-dark flex flex-col space-y-4 p-4">
          <div className="flex items-center gap-2 text-xs text-green-400">
            <svg
              className="h-3 w-3"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.5}
              strokeLinecap="round"
            >
              <polyline points="2,12 6,12 8,4 11,20 14,10 16,14 18,12 22,12" />
            </svg>
            <span className="font-semibold uppercase tracking-wide">Synchronized</span>
          </div>
          <SyncControls servicesManager={servicesManager} />
          <Select
            id="first-dropdown"
            value={firstDropdownValue}
            onChange={handleFirstDropdownChange}
            isClearable={false}
            components={
              {
                //                DropdownIndicator: () => <Icon name="chevron-down" className="mr-2" />,
              }
            }
            isSearchable={false}
            className="text-aqua-pale w-30 h-[13px] text-[26px]"
            options={firstDropdownOptions}
          />

          <Select
            id="second-dropdown"
            value={filterBy}
            placeholder={getOptionLabel(firstDropdownValue, filterBy)}
            onChange={handleSecondDropdownChange}
            isClearable={false}
            components={{}}
            isSearchable={false}
            className="text-aqua-pale w-30 h-[13px] text-[26px]"
            options={secondDropdownOptions[firstDropdownValue]}
          />
        </div>
      </div>
    </div>
  );
}

FilterStageView.propTypes = {
  commandsManager: PropTypes.shape({
    runCommand: PropTypes.func.isRequired,
  }).isRequired,
  servicesManager: PropTypes.shape({
    services: PropTypes.object,
  }).isRequired,
};
