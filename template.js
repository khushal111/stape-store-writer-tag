﻿/// <reference path="./server-gtm-sandboxed-apis.d.ts" />

const JSON = require('JSON');
const getRequestHeader = require('getRequestHeader');
const getAllEventData = require('getAllEventData');
const getTimestampMillis = require('getTimestampMillis');
const logToConsole = require('logToConsole');
const getContainerVersion = require('getContainerVersion');
const getType = require('getType');
const sendHttpRequest = require('sendHttpRequest');
const encodeUriComponent = require('encodeUriComponent');
const makeString = require('makeString');
const generateRandom = require('generateRandom');
const BigQuery = require('BigQuery');

/*==============================================================================
==============================================================================*/

const traceId = getRequestHeader('trace-id');
const eventData = getAllEventData();

const url = eventData.page_location || getRequestHeader('referer');
if (url && url.lastIndexOf('https://gtm-msr.appspot.com/', 0) === 0) {
  return data.gtmOnSuccess();
}

const documentId = data.documentKey || generateDocumentId();
const documentUrl = getStapeStoreDocumentUrl(data, documentId);
const method = data.storeMerge ? 'PATCH' : 'PUT';
const input = data.addEventData ? eventData : {};

if (data.addTimestamp) input[data.timestampFieldName] = getTimestampMillis();
if (data.customDataList) {
  data.customDataList.forEach((d) => {
    if (data.skipNilValues) {
      const dType = getType(d.value);
      if (dType === 'undefined' || dType === 'null') return;
    }
    if (getType(d.name) === 'string' && d.name.indexOf('.') !== -1) {
      const nameParts = d.name.split('.');
      let obj = input;
      for (let i = 0; i < nameParts.length - 1; i++) {
        const part = nameParts[i];
        if (!obj[part]) {
          obj[part] = {};
        }
        obj = obj[part];
      }
      obj[nameParts[nameParts.length - 1]] = d.value;
    } else {
      input[d.name] = d.value;
    }
  });
}

log({
  Name: 'StapeStore',
  Type: 'Request',
  TraceId: traceId,
  EventName: 'Store',
  RequestMethod: method,
  RequestUrl: documentUrl,
  RequestBody: input
});

sendHttpRequest(
  documentUrl,
  { method: method, headers: { 'Content-Type': 'application/json' } },
  JSON.stringify(input)
).then(
  (response) => {
    const responseStatusCode = response.statusCode;

    log({
      Name: 'StapeStore',
      Type: 'Response',
      TraceId: traceId,
      EventName: 'Store',
      ResponseStatusCode: response.statusCode,
      ResponseHeaders: {},
      ResponseBody: response.body
    });

    if (responseStatusCode == 200) data.gtmOnSuccess();
    else data.gtmOnFailure();
  },
  (response) => {
    log({
      Name: 'StapeStore',
      Type: 'Response',
      TraceId: traceId,
      EventName: 'Store',
      ResponseStatusCode: response.statusCode,
      ResponseHeaders: {},
      ResponseBody: response.body
    });

    data.gtmOnFailure();
  }
);

/*==============================================================================
  Vendor related functions
==============================================================================*/

function getStapeStoreBaseUrl(data) {
  let containerIdentifier;
  let defaultDomain;
  let containerApiKey;
  const collectionPath =
    'collections/' + enc(data.stapeStoreCollectionName || 'default') + '/documents';

  const shouldUseDifferentStore =
    isUIFieldTrue(data.useDifferentStapeStore) &&
    getType(data.stapeStoreContainerApiKey) === 'string';
  if (shouldUseDifferentStore) {
    const containerApiKeyParts = data.stapeStoreContainerApiKey.split(':');

    const containerLocation = containerApiKeyParts[0];
    const containerRegion = containerApiKeyParts[3] || 'io';
    containerIdentifier = containerApiKeyParts[1];
    defaultDomain = containerLocation + '.stape.' + containerRegion;
    containerApiKey = containerApiKeyParts[2];
  } else {
    containerIdentifier = getRequestHeader('x-gtm-identifier');
    defaultDomain = getRequestHeader('x-gtm-default-domain');
    containerApiKey = getRequestHeader('x-gtm-api-key');
  }

  return (
    'https://' +
    enc(containerIdentifier) +
    '.' +
    enc(defaultDomain) +
    '/stape-api/' +
    enc(containerApiKey) +
    '/v2/store/' +
    collectionPath
  );
}

function getStapeStoreDocumentUrl(data, documentId) {
  const storeBaseUrl = getStapeStoreBaseUrl(data);
  return storeBaseUrl + '/' + enc(documentId);
}

function generateDocumentId() {
  const rnd = makeString(generateRandom(1000000000, 2147483647));

  return 'store_' + makeString(getTimestampMillis()) + rnd;
}

/*==============================================================================
  Helpers
==============================================================================*/

function isUIFieldTrue(field) {
  return [true, 'true', 1, '1'].indexOf(field) !== -1;
}

function enc(data) {
  return encodeUriComponent(makeString(data || ''));
}

function log(rawDataToLog) {
  const logDestinationsHandlers = {};
  if (determinateIsLoggingEnabled()) logDestinationsHandlers.console = logConsole;
  if (determinateIsLoggingEnabledForBigQuery()) logDestinationsHandlers.bigQuery = logToBigQuery;

  const keyMappings = {
    // No transformation for Console is needed.
    bigQuery: {
      Name: 'tag_name',
      Type: 'type',
      TraceId: 'trace_id',
      EventName: 'event_name',
      RequestMethod: 'request_method',
      RequestUrl: 'request_url',
      RequestBody: 'request_body',
      ResponseStatusCode: 'response_status_code',
      ResponseHeaders: 'response_headers',
      ResponseBody: 'response_body'
    }
  };

  for (const logDestination in logDestinationsHandlers) {
    const handler = logDestinationsHandlers[logDestination];
    if (!handler) continue;

    const mapping = keyMappings[logDestination];
    const dataToLog = mapping ? {} : rawDataToLog;

    if (mapping) {
      for (const key in rawDataToLog) {
        const mappedKey = mapping[key] || key;
        dataToLog[mappedKey] = rawDataToLog[key];
      }
    }

    handler(dataToLog);
  }
}

function logConsole(dataToLog) {
  logToConsole(JSON.stringify(dataToLog));
}

function logToBigQuery(dataToLog) {
  const connectionInfo = {
    projectId: data.logBigQueryProjectId,
    datasetId: data.logBigQueryDatasetId,
    tableId: data.logBigQueryTableId
  };

  dataToLog.timestamp = getTimestampMillis();

  ['request_body', 'response_headers', 'response_body'].forEach((p) => {
    dataToLog[p] = JSON.stringify(dataToLog[p]);
  });

  BigQuery.insert(connectionInfo, [dataToLog], { ignoreUnknownValues: true });
}

function determinateIsLoggingEnabled() {
  const containerVersion = getContainerVersion();
  const isDebug = !!(
    containerVersion &&
    (containerVersion.debugMode || containerVersion.previewMode)
  );

  if (!data.logType) {
    return isDebug;
  }

  if (data.logType === 'no') {
    return false;
  }

  if (data.logType === 'debug') {
    return isDebug;
  }

  return data.logType === 'always';
}

function determinateIsLoggingEnabledForBigQuery() {
  if (data.bigQueryLogType === 'no') return false;
  return data.bigQueryLogType === 'always';
}
