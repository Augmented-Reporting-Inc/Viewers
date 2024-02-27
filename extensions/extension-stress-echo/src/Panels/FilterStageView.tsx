import React, { useEffect, useState } from 'react';
import { Select, Icon } from '../../../../platform/ui/src/components';
import PropTypes from 'prop-types';
// import { ServicesManager } from '@ohif/core';
/*
 * FilterStageView panel enables the user to select stress echo stage or view
 */

export default function FilterStageView({ /** servicesManager,*/ commandsManager }) {
  //  const { displaySetService, hangingProtocolService } = (servicesManager as ServicesManager)
  //    .services;
  //  const [svDisplaySet, setSvDisplaySet] = useState(null);

  const [firstDropdownValue, setFirstDropdownValue] = useState('Stage');
  const [filterBy, setFilterBy] = useState('Rest');

  const handleFirstDropdownChange = options => {
    setFirstDropdownValue(options.value);
    // setFilterBy(''); or else triggers setHangingProtocol with undefined id
  };

  const firstDropdownOptions = [
    { value: 'Stage', label: 'by Stage' },
    { value: 'Value', label: 'by Value' },
  ];

  /** side effect for change to filterBy */
  useEffect(() => {
    const protocol = 'extension-stress-echo.hangingProtocolModule.hp' + filterBy;
    console.log('filterBy useEffect protocolID', protocol, filterBy);

    const updateCurrentProtocol = commandsManager.runCommand('setHangingProtocol', {
      activeStudyUID: '',
      protocolId: protocol,
    });
    console.log('updateCurrentProtocol', updateCurrentProtocol);
  }, [filterBy, commandsManager]);

  const FilterSelect = () => {
    const handleSecondDropdownChange = options => {
      setFilterBy(options.value); // Notify the parent
    };

    /**     useEffect(() => {
      // Update the second dropdown value when the first dropdown value changes
      setFilterBy('');
    }, [firstDropdownValue]);
*/

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
        { value: 'AP2', label: 'AP2' },
        { value: 'AP3', label: 'AP3' },
        { value: 'View6', label: 'View 6' },
      ],
    };

    return (
      <div>
        {/**
         */}
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
  /**
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
        console.log('svDisplaySet after protocol change', svDisplaySet);
        setSvDisplaySet(svDisplaySet);
      }
    );
    return () => {
      unsubscribe();
    };
  }, []);
*/
  return (
    <div className="invisible-scrollbar">
      {
        <div className="flex flex-col">
          <div className="bg-primary-dark flex flex-col space-y-4 p-4">
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
            <FilterSelect />
          </div>
        </div>
      }
    </div>
  );
}

FilterStageView.propTypes = {
  commandsManager: PropTypes.shape({
    runCommand: PropTypes.func.isRequired,
  }),
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
