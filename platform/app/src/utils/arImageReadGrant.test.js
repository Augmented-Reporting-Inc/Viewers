import {
  parseArImageReadScope,
  attachArImageReadHeaders,
  createArImageReadGrantSession,
  assertTrustedArFrameImageId,
  assertTrustedArBulkDataUri,
} from './arImageReadGrant';

const origin = 'https://dragonfoot.futurepacs.com';
const study = '1.2.840.113619.2.1';
const attempt = '507f191e810c19729de860ea';
const research = 'my-research-read-1';
const token = 'syntheticPayload.syntheticSignature';
const href = (path, params='') => origin + path + '?StudyInstanceUIDs=' + study + '&' + params;

function makeResponse({ protectedStudy = true, resultToken = token, expiresAt=1300 } = {}) {
  return {
    ok: true,
    json: async () => protectedStudy
      ? { protected: true, grant: resultToken, expiresAt }
      : { protected: false },
  };
}
const orthanc = () => ({
  namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
  configuration: {
    qidoRoot: '/orthanc/dicom-web',
    wadoRoot: origin + '/orthanc/dicom-web',
  },
});
const cdn = () => ({
  namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
  configuration: {
    qidoRoot: 'https://cdn.example.test/dicomweb',
    wadoRoot: 'https://cdn.example.test/dicomweb',
  },
});

test('iUSCAN external website and /bviewer never request or receive AR grants', async () => {
  let count = 0;
  for (const url of [
    href('/bviewer/viewer', 'arIntegration=iuscan&arLearnerSeriesId=' + attempt),
    href('/learning/viewer', 'arIntegration=iuscan&arLearnerSeriesId=' + attempt),
  ]) {
    const session = createArImageReadGrantSession({
      href: url,
      fetchImpl: async () => { count++; throw new Error('must not fetch'); },
    });
    expect(session.target).toBeNull();
    expect(await session.initialize()).toBe(false);
    expect(session.getHeaders()).toEqual({});
  }
  expect(count).toBe(0);
});

test('clinical and manager preview viewers have no new image grant side effects', async () => {
  const session = createArImageReadGrantSession({
    href: href('/rviewer/viewer', 'arResearchPreview=1'),
    fetchImpl: async () => { throw new Error('unexpected grant request'); },
  });
  expect(await session.initialize()).toBe(false);
  expect(session.getHeaders()).toEqual({});
});

test('learner grant is bound to one window and acquired before image loading', async () => {
  const calls = [];
  const session = createArImageReadGrantSession({
    href: href('/learning/viewer', 'arLearnerSeriesId=' + attempt),
    fetchImpl: async (...args) => { calls.push(args); return makeResponse(); },
    now: () => 1000 * 1000,
    schedule: () => 1,
    cancel: () => {},
  });
  expect(await session.initialize()).toBe(true);
  expect(session.getHeaders()).toEqual({ 'X-AR-Image-Grant': token });
  expect(calls).toHaveLength(1);
  const [url, options] = calls[0];
  expect(url).toBe('/formapi/api/imaging-read-access/grants');
  expect(options.credentials).toBe('include');
  expect(options.method).toBe('POST');
  expect(options.headers['X-Requested-With']).toBe('XMLHttpRequest');
  expect(JSON.parse(options.body)).toEqual({
    scope: 'educationAttempt', id: attempt, studyInstanceUID: study,
  });
  expect(href('/learning/viewer','arLearnerSeriesId='+attempt)).not.toContain(token);
  session.dispose();
  expect(session.getHeaders()).toEqual({});
});

test('research reviewer receives a distinct review-bound grant, never learner grant', () => {
  expect(parseArImageReadScope(
    href('/rviewer/viewer', 'arResearchReviewKey=' + research)
  )).toEqual({
    scope: 'researchReview', id: research, studyInstanceUID: study,
  });
});

test('multiple Study UIDs or conflicting assignments fail closed', () => {
  for (const url of [
    href('/rviewer/viewer', 'arLearnerSeriesId=' + attempt + '&arResearchReviewKey=' + research),
    origin + '/rviewer/viewer?StudyInstanceUIDs=' + study +
      '&StudyInstanceUIDs=1.2.840.2&arLearnerSeriesId=' + attempt,
    href('/rviewer/viewer', 'arLearnerSeriesId=not-an-object-id'),
    href('/rviewer/viewer', 'arLearnerSeriesId=' + attempt).replace(study,'unknown'),
  ]) expect(() => parseArImageReadScope(url)).toThrow('ar_image_read_launch_invalid');
});

test('unprotected studies continue without grant header or refresh', async () => {
  let planned = false;
  const session = createArImageReadGrantSession({
    href: href('/learning/viewer', 'arLearnerSeriesId=' + attempt),
    fetchImpl: async () => makeResponse({ protectedStudy: false }),
    schedule: () => { planned = true; return 1; },
  });
  expect(await session.initialize()).toBe(false);
  expect(session.getHeaders()).toEqual({});
  expect(planned).toBe(false);
});

test('a failed grant cannot launch a protected study', async () => {
  const session = createArImageReadGrantSession({
    href: href('/learning/viewer', 'arLearnerSeriesId=' + attempt),
    fetchImpl: async () => ({ ok: false, status: 403 }),
  });
  await expect(session.initialize()).rejects.toThrow('ar_image_read_grant_request_denied');
  expect(session.getHeaders()).toEqual({});
});

test('grant expiry refreshes in the same window, and expired grants fail closed', async () => {
  const scheduled = [];
  let now = 1000 * 1000;
  let resultToken = token;
  const session = createArImageReadGrantSession({
    href: href('/learning/viewer', 'arLearnerSeriesId=' + attempt),
    now: () => now,
    fetchImpl: async () => makeResponse({ resultToken, expiresAt: 1300 }),
    schedule: fn => { scheduled.push(fn); return scheduled.length; },
    cancel: () => {},
  });
  expect(await session.initialize()).toBe(true);
  resultToken = 'refreshedPayload.refreshedSignature';
  await scheduled[0]();
  await Promise.resolve();
  await Promise.resolve();
  expect(session.getHeaders()['X-AR-Image-Grant']).toBe(resultToken);
  now = 1300 * 1000;
  expect(session.getHeaders()).toEqual({});
});

test('protected window uses only same-origin Orthanc even when default is CDN', () => {
  const getHeaders = () => ({ 'X-AR-Image-Grant': token });
  for(const sources of [[cdn(),orthanc()],[cdn()],[orthanc()]]) {
    const config = { dataSources: sources, defaultDataSourceName:'dicomweb' };
    const result = attachArImageReadHeaders(config,getHeaders,origin,study);
    expect(result.dataSources).toHaveLength(1);
    expect(result.defaultDataSourceName).toBe('dicomweb');
    expect(result.showStudyList).toBe(false);
    expect(result.dataSources[0].configuration.qidoRoot).toBe(origin+'/orthanc/dicom-web');
    expect(result.dataSources[0].configuration.wadoRoot).toBe(origin+'/orthanc/dicom-web');
    expect(result.dataSources[0].configuration.staticWado).toBe(false);
    expect(result.dataSources[0].configuration.getAdditionalRequestHeaders()).toEqual(getHeaders());
    expect(result.getArImageReadHeaders()).toEqual(getHeaders());
    expect(JSON.stringify(result.dataSources)).not.toContain('cdn.example.test');
  }
  expect(() => attachArImageReadHeaders(
    { dataSources: [orthanc(),orthanc()] },getHeaders,origin,study
  )).toThrow('ar_image_read_secure_orthanc_source_ambiguous');
});

test('iUSCAN /bviewer config remains byte-for-byte unchanged by grant scope check',async()=>{
  const original={dataSources:[cdn(),orthanc()],defaultDataSourceName:'dicomweb'};
  const before=JSON.stringify(original);
  const session=createArImageReadGrantSession({
    href:href('/bviewer/viewer','arIntegration=iuscan&arLearnerSeriesId='+attempt),
    fetchImpl:async()=>{throw new Error('iUSCAN grant request forbidden');},
  });
  expect(await session.initialize()).toBe(false);
  expect(original).toEqual(JSON.parse(before));
});

test('frame loader cannot attach grant to another Study, CDN, or WADO-URI', () => {
  const frameId = 'wadors:' + origin + '/orthanc/dicom-web/studies/' +
    study + '/series/1.2.3/instances/1.2.4/frames/2';
  expect(assertTrustedArFrameImageId(frameId,origin,study)).toBe(true);
  const protectedConfig=attachArImageReadHeaders(
    { dataSources:[cdn(),orthanc()] },()=>({'X-AR-Image-Grant':token}),origin,study
  );
  expect(protectedConfig.assertArImageReadImageId(frameId)).toBe(true);
  for(const invalid of [
    frameId.replace(study,'1.2.840.999'),
    frameId.replace(origin,'https://cdn.example.test'),
    frameId.replace('/orthanc/dicom-web/','/ortho/'),
    frameId.replace('wadors:','wadouri:'),
    frameId.replace('/frames/2','/preview'),
  ]) {
    expect(()=>protectedConfig.assertArImageReadImageId(invalid)).toThrow(/ar_image_read_frame_/);
  }
});

test('DICOM BulkDataURI must refer to the same Orthanc Study before sending grant', () => {
  const source=attachArImageReadHeaders({
    dataSources:[cdn(),orthanc()],
  },()=>({ 'X-AR-Image-Grant':token }),origin,study);
  const policy=source.dataSources[0].configuration.assertArImageReadBulkDataUri;
  const resource='/orthanc/dicom-web/studies/'+study+
    '/series/1.2.3/instances/1.2.4/bulk/00420011';
  expect(policy(origin+resource)).toBe(true);
  expect(policy(resource)).toBe(true);
  expect(assertTrustedArBulkDataUri('studies/'+study+
    '/series/1.2.3/instances/1.2.4/bulk/00420011',origin,study)).toBe(true);
  for(const bad of [
    'https://cdn.example.test'+resource,
    origin+resource.replace(study,'1.2.840.999'),
    '/orthanc/instances/123/file',
    origin+resource.replace('/studies/','/studies%2f'),
  ]) expect(()=>policy(bad)).toThrow(/ar_image_read_bulk_/);
});
