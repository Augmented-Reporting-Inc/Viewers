import React, { useEffect, useState } from 'react';
import { Select, Icon } from '../../../../platform/ui/src/components';
import PropTypes from 'prop-types';
import { Input, Button } from '@ohif/ui';
import { DicomMetadataStore, ServicesManager } from '@ohif/core';
import { useTranslation } from 'react-i18next';

const DEFAULT_METADATA = {
  PatientWeight: null,
  PatientSex: null,
  SeriesTime: null,
};

/*
 * FilterStageView panel enables the user to modify the patient related information, such as
 * patient sex, patientWeight. This is allowed since
 * sometimes these metadata are missing or wrong. By changing them
 * @param param0
 * @returns
 */
export default function FilterStageView({ servicesManager, commandsManager }) {
  const { t } = useTranslation('FilterStageView');
  const { displaySetService, toolGroupService, toolbarService, hangingProtocolService } = (
    servicesManager as ServicesManager
  ).services;
  const [metadata, setMetadata] = useState(DEFAULT_METADATA);
  const [ptDisplaySet, setPtDisplaySet] = useState(null);

  const selectOptions = [
    { value: 'Stage', label: 'by Stage' },
    { value: 'View', label: 'by View' },
  ];

  const [filterBy, setFilterBy] = useState(null);

  const onFilterChange = filterValue => {
    setFilterBy(filterValue);
    console.log('filterBy', filterBy);
  };

  const handleChange = option => {
    onFilterChange(option.value); // Notify the parent
  };

  const handleMetadataChange = metadata => {
    setMetadata(prevState => {
      const newState = { ...prevState };
      Object.keys(metadata).forEach(key => {
        if (typeof metadata[key] === 'object') {
          newState[key] = {
            ...prevState[key],
            ...metadata[key],
          };
        } else {
          newState[key] = metadata[key];
        }
      });
      return newState;
    });
  };

  const getMatchingPTDisplaySet = viewportMatchDetails => {
    const ptDisplaySet = commandsManager.runCommand('getMatchingPTDisplaySet', {
      viewportMatchDetails,
    });

    if (!ptDisplaySet) {
      return;
    }

    const metadata = commandsManager.runCommand('getPTMetadata', {
      ptDisplaySet,
    });

    return {
      ptDisplaySet,
      metadata,
    };
  };

  useEffect(() => {
    const displaySets = displaySetService.getActiveDisplaySets();
    const { viewportMatchDetails } = hangingProtocolService.getMatchDetails();
    if (!displaySets.length) {
      return;
    }

    const displaySetInfo = getMatchingPTDisplaySet(viewportMatchDetails);

    if (!displaySetInfo) {
      return;
    }

    const { ptDisplaySet, metadata } = displaySetInfo;
    setPtDisplaySet(ptDisplaySet);
    setMetadata(metadata);
  }, []);

  // get the patientMetadata from the StudyInstanceUIDs and update the state
  useEffect(() => {
    const { unsubscribe } = hangingProtocolService.subscribe(
      hangingProtocolService.EVENTS.PROTOCOL_CHANGED,
      ({ viewportMatchDetails }) => {
        const displaySetInfo = getMatchingPTDisplaySet(viewportMatchDetails);

        if (!displaySetInfo) {
          return;
        }
        const { ptDisplaySet, metadata } = displaySetInfo;
        setPtDisplaySet(ptDisplaySet);
        setMetadata(metadata);
      }
    );
    return () => {
      unsubscribe();
    };
  }, []);

  function updateMetadata() {
    if (!ptDisplaySet) {
      throw new Error('No ptDisplaySet found');
    }

    const toolGroupIds = toolGroupService.getToolGroupIds();

    // Todo: we don't have a proper way to perform a toggle command and update the
    // state for the toolbar, so here, we manually toggle the toolbar

    // Todo: Crosshairs have bugs for the camera reset currently, so we need to
    // force turn it off before we update the metadata
    toolGroupIds.forEach(toolGroupId => {
      commandsManager.runCommand('toggleCrosshairs', {
        toolGroupId,
        toggledState: false,
      });
    });

    toolbarService.state.toggles['Crosshairs'] = false;
    toolbarService._broadcastEvent(toolbarService.EVENTS.TOOL_BAR_STATE_MODIFIED);

    // metadata should be dcmjs naturalized
    DicomMetadataStore.updateMetadataForSeries(
      ptDisplaySet.StudyInstanceUID,
      ptDisplaySet.SeriesInstanceUID,
      metadata
    );

    // update the displaySets
    displaySetService.setDisplaySetMetadataInvalidated(ptDisplaySet.displaySetInstanceUID);
  }
  return (
    <div className="invisible-scrollbar overflow-y-auto overflow-x-hidden">
      {
        <div className="flex flex-col">
          <div className="bg-primary-dark flex flex-col space-y-4 p-4">
            <Select
              id="filter-select"
              isClearable={false}
              onChange={handleChange}
              components={{
                DropdownIndicator: () => <Icon name={'chevron-down-new'} className="mr-2" />,
              }}
              isSearchable={false}
              options={selectOptions}
              value={selectOptions?.find(o => o.value)}
              className="text-aqua-pale w-30 h-[13px] text-[26px]"
            />
            <Input
              label={t('Patient Sex')}
              labelClassName="text-white mb-2"
              className="mt-1"
              value={metadata.PatientSex || ''}
              onChange={e => {
                handleMetadataChange({
                  PatientSex: e.target.value,
                });
              }}
            />
            <Input
              label={t('Patient Weight (kg)')}
              labelClassName="text-white mb-2"
              className="mt-1"
              value={metadata.PatientWeight || ''}
              onChange={e => {
                handleMetadataChange({
                  PatientWeight: e.target.value,
                });
              }}
            />
            <Input
              label={t('Acquisition Time (s)')}
              labelClassName="text-white mb-2"
              className="mt-1 mb-2"
              value={metadata.SeriesTime || ''}
              onChange={() => {}}
            />
            <Button onClick={updateMetadata}>Reload Data</Button>
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
