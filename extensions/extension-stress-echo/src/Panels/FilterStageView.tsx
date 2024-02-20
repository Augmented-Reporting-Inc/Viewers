import React, { useEffect, useState } from 'react';
import { Select, Icon } from '../../../../platform/ui/src/components';
import PropTypes from 'prop-types';
import { ServicesManager } from '@ohif/core';
import { Input } from '@ohif/ui';
import { useTranslation } from 'react-i18next';

/*
 * FilterStageView panel enables the user to select stress echo stage or view
 */

export default function FilterStageView({ servicesManager, commandsManager }) {
  const { t } = useTranslation('FilterStageView');
  const { displaySetService, toolGroupService, toolbarService, hangingProtocolService } = (
    servicesManager as ServicesManager
  ).services;
  const [svDisplaySet, setSvDisplaySet] = useState(null);

  const MultiSelect = () => {
    const [firstDropdownValue, setFirstDropdownValue] = useState('');
    const [filterBy, setFilterBy] = useState('');

    const handleFirstDropdownChange = options => {
      setFirstDropdownValue(options.value);
      setFilterBy('');
    };

    const handleSecondDropdownChange = options => {
      setFilterBy(options.value); // Notify the parent
    };

    useEffect(() => {
      // Update the second dropdown value when the first dropdown value changes
      setFilterBy('');
    }, [firstDropdownValue]);

    useEffect(() => {
      // action when the second dropdown value
      console.log('filterBy useEffect', filterBy);
    }, [filterBy]);

    const firstDropdownOptions = [
      { value: 'Stage', label: 'by Stage' },
      { value: 'Value', label: 'by Value' },
    ];

    const secondDropdownOptions = {
      Stage: [
        { value: 'Rest', label: 'Rest' },
        { value: 'Peak', label: 'Peak' },
        { value: 'Recovery', label: 'Recovery' },
      ],
      Value: [
        { value: 'LAX', label: 'LAX' },
        { value: 'SAX', label: 'SAX' },
        { value: 'AP4', label: 'AP4' },
        { value: 'AP3', label: 'AP3' },
        { value: 'AP2', label: 'AP2' },
        { value: 'View6', label: 'View 6' },
      ],
    };

    return (
      <div>
        <Select
          id="first-dropdown"
          value={firstDropdownValue}
          onChange={handleFirstDropdownChange}
          placeholder={firstDropdownValue}
          isClearable={false}
          components={{
            DropdownIndicator: () => <Icon name={'chevron-down-new'} className="mr-2" />,
          }}
          isSearchable={false}
          className="text-aqua-pale w-30 h-[13px] text-[26px]"
          options={firstDropdownOptions}
        />
        {firstDropdownValue && (
          <div>
            <label htmlFor="second-dropdown">gap</label>
            <Select
              id="second-dropdown"
              value={filterBy}
              placeholder={filterBy}
              onChange={handleSecondDropdownChange}
              isClearable={false}
              components={{
                DropdownIndicator: () => <Icon name={'chevron-down-new'} className="mr-2" />,
              }}
              isSearchable={false}
              className="text-aqua-pale w-30 h-[13px] text-[26px]"
              options={secondDropdownOptions[firstDropdownValue]}
            ></Select>
          </div>
        )}
      </div>
    );
  };

  const getMatchingDisplaySet = viewportMatchDetails => {
    const svDisplaySet = commandsManager.runCommand('getMatchingDisplaySet', {
      viewportMatchDetails,
    });

    if (!svDisplaySet) {
      return;
    }

    return {
      svDisplaySet,
    };
  };

  useEffect(() => {
    const displaySets = displaySetService.getActiveDisplaySets();
    const { viewportMatchDetails } = hangingProtocolService.getMatchDetails();
    if (!displaySets.length) {
      return;
    }

    const displaySetInfo = getMatchingDisplaySet(viewportMatchDetails);

    if (!displaySetInfo) {
      return;
    }

    const { svDisplaySet } = displaySetInfo;
    setSvDisplaySet(svDisplaySet);
  }, []);

  // get the patientMetadata from the StudyInstanceUIDs and update the state
  useEffect(() => {
    const { unsubscribe } = hangingProtocolService.subscribe(
      hangingProtocolService.EVENTS.PROTOCOL_CHANGED,
      ({ viewportMatchDetails }) => {
        const displaySetInfo = getMatchingDisplaySet(viewportMatchDetails);

        if (!displaySetInfo) {
          return;
        }
        const { svDisplaySet } = displaySetInfo;
        setSvDisplaySet(svDisplaySet);
      }
    );
    return () => {
      unsubscribe();
    };
  }, []);

  return (
    <div className="invisible-scrollbar">
      {
        <div className="flex flex-col">
          <div className="bg-primary-dark flex flex-col space-y-4 p-4">
            <MultiSelect />
          </div>
        </div>
      }
    </div>
  );
}

FilterStageView.propTypes = {
  servicesManager: PropTypes.shape({
    services: PropTypes.shape({
      measurementService: PropTypes.shape({
        getMeasurements: PropTypes.func.isRequired,
        subscribe: PropTypes.func.isRequired,
        EVENTS: PropTypes.object.isRequired,
        VALUE_TYPES: PropTypes.object.isRequired,
      }).isRequired,
    }).isRequired,
  }).isRequired,
};
