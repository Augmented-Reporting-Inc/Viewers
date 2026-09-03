import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Select } from '../../../../platform/ui/src/components';
import PropTypes from 'prop-types';
import { SyncControls } from '../../../extension-stress-echo/src/components/SyncControls';

// import { ServicesManager } from '@ohif/core';
/*
 * FilterStageView panel enables the user to select stress echo stage or view
 */

const PROTOCOL_PREFIX = 'extension-stress-echo.hangingProtocolModule.hp';

const firstDropdownOptions = [
  { value: 'Stage', label: 'by Stage' },
  { value: 'Value', label: 'by View' },
];

const secondDropdownFirstOptions = {
  Stage: 'Rest',
  Value: 'LAX',
};

const secondDropdownOptions = {
  Stage: [
    { value: 'Rest', label: 'Rest' },
    { value: 'Peak', label: 'Peak' },
    { value: 'Recovery', label: 'Recovery' },
  ],
  Value: [
    { value: 'LAX', label: 'LAX' },
    { value: 'SAXBase', label: 'SAX-BASE' },
    { value: 'SAXMid', label: 'SAX-PM' },
    { value: 'SAXApex', label: 'SAX-AP' },
    { value: 'AP4', label: 'AP4' },
    { value: 'AP2', label: 'AP2' },
    { value: 'AP3', label: 'AP3' },
    { value: 'View6', label: 'View 6' },
  ],
};

const getStudyInstanceUIDFromDisplaySet = displaySet =>
  displaySet?.StudyInstanceUID ||
  displaySet?.studyInstanceUID ||
  displaySet?.study?.StudyInstanceUID ||
  displaySet?.instances?.[0]?.StudyInstanceUID ||
  '';

const getDisplaySetValues = displaySets => {
  if (!displaySets) {
    return [];
  }

  if (Array.isArray(displaySets)) {
    return displaySets;
  }

  if (displaySets instanceof Map) {
    return Array.from(displaySets.values());
  }

  if (typeof displaySets === 'object') {
    return Object.values(displaySets);
  }

  return [];
};

const getActiveStudyUID = servicesManager => {
  const { displaySetService, viewportGridService } = servicesManager?.services || {};

  const viewportGridState = viewportGridService?.getState?.();
  const activeViewportId = viewportGridState?.activeViewportId;
  const viewports = viewportGridState?.viewports;
  const activeViewport =
    (activeViewportId && viewports?.get?.(activeViewportId)) ||
    (activeViewportId && viewports?.[activeViewportId]) ||
    null;

  const activeViewportDisplaySetUIDs = Array.isArray(activeViewport?.displaySetInstanceUIDs)
    ? activeViewport.displaySetInstanceUIDs
    : [];

  const displaySetInstanceUIDs = [
    ...activeViewportDisplaySetUIDs,
    activeViewport?.displaySetInstanceUID,
  ].filter(Boolean);

  for (const displaySetInstanceUID of displaySetInstanceUIDs) {
    const displaySet = displaySetService?.getDisplaySetByUID?.(displaySetInstanceUID);
    const studyInstanceUID = getStudyInstanceUIDFromDisplaySet(displaySet);

    if (studyInstanceUID) {
      return studyInstanceUID;
    }
  }

  const activeDisplaySets = displaySetService?.getActiveDisplaySets?.();

  for (const displaySet of getDisplaySetValues(activeDisplaySets)) {
    const studyInstanceUID = getStudyInstanceUIDFromDisplaySet(displaySet);

    if (studyInstanceUID) {
      return studyInstanceUID;
    }
  }

  const allDisplaySets = displaySetService?.getDisplaySets?.() || displaySetService?.displaySets;

  for (const displaySet of getDisplaySetValues(allDisplaySets)) {
    const studyInstanceUID = getStudyInstanceUIDFromDisplaySet(displaySet);

    if (studyInstanceUID) {
      return studyInstanceUID;
    }
  }

  return '';
};

export default function FilterStageView({ servicesManager, commandsManager }) {
  //  const { displaySetService, hangingProtocolService } = (servicesManager as ServicesManager)
  //    .services;
  //  const [svDisplaySet, setSvDisplaySet] = useState(null);

  const [firstDropdownValue, setFirstDropdownValue] = useState('Stage');
  const [filterBy, setFilterBy] = useState('Rest');
  const hasUserSelectedRef = useRef(false);

  const applyHangingProtocol = useCallback((nextFilterBy: string) => {
    if (!nextFilterBy) {
      return false;
    }

    const activeStudyUID = getActiveStudyUID(servicesManager);

    if (!activeStudyUID) {
      console.warn('[stress-echo] skipping hanging protocol switch; activeStudyUID not ready', {
        filterBy: nextFilterBy,
      });
      return false;
    }

    const protocolId = `${PROTOCOL_PREFIX}${nextFilterBy}`;

    try {
      commandsManager.runCommand('setHangingProtocol', {
        activeStudyUID,
        protocolId,
      });
      return true;
    } catch (error) {
      console.warn('[stress-echo] failed to set hanging protocol', {
        activeStudyUID,
        protocolId,
        error,
      });
      return false;
    }
  }, [commandsManager, servicesManager]);

  useEffect(() => {
    const { displaySetService } = servicesManager?.services || {};
    let cancelled = false;
    let retryTimer: number | undefined;
    let settleTimer: number | undefined;
    let defaultRestApplied = false;

    const applyDefaultRestWhenReady = () => {
      if (cancelled || defaultRestApplied || hasUserSelectedRef.current) {
        return;
      }

      const activeDisplaySets = getDisplaySetValues(
        displaySetService?.getActiveDisplaySets?.()
      );

      // A Study UID can be available before the protocol engine receives its
      // candidate display sets. Applying Rest during that gap maps every
      // viewport to an empty display set.
      if (activeDisplaySets.length > 0 && getActiveStudyUID(servicesManager)) {
        defaultRestApplied = applyHangingProtocol('Rest');
      }

      if (!defaultRestApplied) {
        retryTimer = window.setTimeout(applyDefaultRestWhenReady, 250);
      }
    };

    const scheduleDefaultRest = () => {
      if (cancelled || defaultRestApplied || hasUserSelectedRef.current) {
        return;
      }

      if (settleTimer) {
        window.clearTimeout(settleTimer);
      }

      // Debounce batched display-set additions so Rest is not applied against
      // a partially populated candidate list.
      settleTimer = window.setTimeout(applyDefaultRestWhenReady, 250);
    };

    const subscriptions = [
      displaySetService?.EVENTS?.DISPLAY_SETS_ADDED,
      displaySetService?.EVENTS?.DISPLAY_SETS_CHANGED,
    ]
      .filter(Boolean)
      .map(eventName => displaySetService.subscribe(eventName, scheduleDefaultRest));

    scheduleDefaultRest();

    return () => {
      cancelled = true;
      if (retryTimer) {
        window.clearTimeout(retryTimer);
      }
      if (settleTimer) {
        window.clearTimeout(settleTimer);
      }
      subscriptions.forEach(subscription => subscription?.unsubscribe?.());
    };
  }, [applyHangingProtocol, servicesManager]);

  const handleFirstDropdownChange = options => {
    if (!options?.value) {
      return;
    }

    const nextFirstDropdownValue = options.value;
    const nextFilterBy = secondDropdownFirstOptions[nextFirstDropdownValue];

    hasUserSelectedRef.current = true;
    setFirstDropdownValue(nextFirstDropdownValue);
    setFilterBy(nextFilterBy);
    applyHangingProtocol(nextFilterBy);
  };

  const FilterSelect = () => {
    const handleSecondDropdownChange = options => {
      if (!options?.value) {
        return;
      }

      hasUserSelectedRef.current = true;
      setFilterBy(options.value);
      applyHangingProtocol(options.value);
    };

    /**     useEffect(() => {
      // Update the second dropdown value when the first dropdown value changes
      setFilterBy('');
    }, [firstDropdownValue]);
*/

    return (
      <div>
        {/**
         */}
        {firstDropdownValue && (
          <div>
            <Select
              id="second-dropdown"
              value={filterBy}
              placeholder={filterBy}
              onChange={handleSecondDropdownChange}
              isClearable={false}
              components={
                {
                  //                DropdownIndicator: () => <Icon name="chevron-down" className="mr-2" />,
                }
              }
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
  }).isRequired,
  servicesManager: PropTypes.shape({
    services: PropTypes.object.isRequired,
  }).isRequired,
};
