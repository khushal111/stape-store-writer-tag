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

const isLoggingEnabled = determinateIsLoggingEnabled();
const traceId = isLoggingEnabled ? getRequestHeader('trace-id') : undefined;


let storeUrl = getStoreUrl();
let writeUrl = getWriteUrl(data.documentKey || generateDocumentKey());
let method = data.storeMerge ? 'PATCH' : 'PUT';
let input = data.addEventData ? getAllEventData() : {};

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

if (isLoggingEnabled) {
    logToConsole(
      JSON.stringify({
          Name: 'StapeStore',
          Type: 'Request',
          TraceId: traceId,
          EventName: 'Store',
          RequestMethod: method,
          RequestUrl: writeUrl,
          RequestBody: input,
      })
    );
}

sendHttpRequest(writeUrl, {method: method, headers: { 'Content-Type': 'application/json' }}, JSON.stringify(input))
  .then(() => {
      if (isLoggingEnabled) {
          logToConsole(
            JSON.stringify({
                Name: 'StapeStore',
                Type: 'Response',
                TraceId: traceId,
                EventName: 'Store',
                ResponseStatusCode: 200,
                ResponseHeaders: {},
                ResponseBody: {},
            })
          );
      }

      data.gtmOnSuccess();
  }, function () {
      if (isLoggingEnabled) {
          logToConsole(
            JSON.stringify({
                Name: 'StapeStore',
                Type: 'Response',
                TraceId: traceId,
                EventName: 'Store',
                ResponseStatusCode: 500,
                ResponseHeaders: {},
                ResponseBody: {},
            })
          );
      }

      data.gtmOnFailure();
  });


function getStoreUrl() {
    const containerIdentifier = getRequestHeader('x-gtm-identifier');
    const defaultDomain = getRequestHeader('x-gtm-default-domain');
    const containerApiKey = getRequestHeader('x-gtm-api-key');

    return (
      'https://' +
      enc(containerIdentifier) +
      '.' +
      enc(defaultDomain) +
      '/stape-api/' +
      enc(containerApiKey) +
      '/v1/store'
    );
}

function getWriteUrl(documentKey) {
    return storeUrl + '/' + enc(documentKey);
}

function generateDocumentKey() {
    const rnd = makeString(generateRandom(1000000000, 2147483647));

    return 'store_' + makeString(getTimestampMillis()) + rnd;
}

function enc(data) {
    data = data || '';
    return encodeUriComponent(data);
}



function determinateIsLoggingEnabled() {
    const containerVersion = getContainerVersion();
    const isDebug = !!(containerVersion && (containerVersion.debugMode || containerVersion.previewMode));

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
