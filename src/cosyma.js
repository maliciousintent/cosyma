/* global AWS */

import promisify from 'es6-promisify';
import { isEqual } from 'lodash';

import {
  log,
  findRecord,
  deserialize,
  serialize,
  createCognitoSyncClient,
  client,
} from './utils';

import {
  cacheStore,
  cacheRestore,
} from './cache';


let syncCount = 0;
let DATASETS = {};
let DATASET_JOURNAL = {};
const DATASET_SYNC_STATUS = {};
const SYNC_SESSION_TOKEN = {};
let IDENTITY_POOL_ID;


const restore = () => {
  const restoredValues = cacheRestore();
  if (restoredValues.DATASETS) {
    DATASETS = restoredValues.DATASETS;
  }

  if (restoredValues.DATASET_JOURNAL) {
    DATASET_JOURNAL = restoredValues.DATASET_JOURNAL;
  }
};
const store = () => cacheStore({ DATASETS, DATASET_JOURNAL });


// ~ internals
//

async function listRecords(datasetName: string): Array {
  const params = {
    DatasetName: datasetName,
    IdentityId: AWS.config.credentials.identityId,
    IdentityPoolId: IDENTITY_POOL_ID,
  };

  if (SYNC_SESSION_TOKEN[datasetName]) {
    params.SyncSessionToken = SYNC_SESSION_TOKEN[datasetName];
  }

  let results = [];
  let nextToken = true;

  while (nextToken) {
    if (nextToken !== true) {
      params.NextToken = nextToken;
    }

    const response = await client.listRecords(params);
    const records = response.Records;
    nextToken = response.NextToken;
    SYNC_SESSION_TOKEN[datasetName] = response.SyncSessionToken;
    results = [...results, records];
  }

  return results;
}

export const shouldSync = (datasetName: string) => {
  log.info(DATASET_JOURNAL, DATASET_SYNC_STATUS, datasetName);
  log.info(DATASET_JOURNAL[datasetName], DATASET_JOURNAL[datasetName].length);
  if (!DATASET_JOURNAL[datasetName] ||
    DATASET_JOURNAL[datasetName].length === 0 ||
    DATASET_SYNC_STATUS[datasetName] === true) {
    log.info('Nothing to sync, journal is empty');
    return false;
  }

  return true;
};


async function updateRecords(datasetName: string) {
  const params = {
    DatasetName: datasetName,
    IdentityId: AWS.config.credentials.identityId,
    IdentityPoolId: IDENTITY_POOL_ID,
    SyncSessionToken: SYNC_SESSION_TOKEN[datasetName],
    RecordPatches: DATASET_JOURNAL[datasetName],
  };

  log.info('Dataset journal before updateRecords', [...DATASET_JOURNAL]);

  let response;
  try {
    response = await client.updateRecords(params);
  } catch (updateErr) {
    log.error('Error updating with params', params);
    log.error('Error client.updateRecords', updateErr.message, updateErr.stack);
  }

  log.info('response from client.updatedRecords', response);
  syncCount = syncCount + 1;
  log.warn(`syncCount is ${syncCount}`);

  const updatedRecords = response.Records;
  DATASETS[datasetName] = DATASETS[datasetName].map(record => {
    const newRecord = findRecord(updatedRecords, record.Key);
    if (newRecord) {
      return newRecord;
    }

    return record;
  });

  DATASET_JOURNAL[datasetName] = [];
}


// ~ high-level exported API
//

function getValue(datasetName: string, key: ?string) {
  if (typeof DATASETS[datasetName] === 'undefined') {
    throw new Error(`DataSet '${datasetName}' is not initialized. use ::store and
      ::restore if you want to access this data from the local cache.`);
  }

  if (typeof key === 'undefined') {
    const ret = {};
    DATASETS[datasetName].forEach(record => ret[record.Key] = deserialize(record.Value));
    return ret;
  }

  const obj = findRecord(DATASETS[datasetName], key);

  if (typeof obj === 'undefined') {
    return undefined;
  }

  return deserialize(obj.Value);
}


function setValue(datasetName: string, key: string, value: ?any) {
  if (typeof DATASETS[datasetName] === 'undefined') {
    log.error(`Cannot set value in unitialized dataset ${datasetName}`);
    return; // throw new Error(`DataSet '${datasetName}' is not initialized`);
  }

  if (!Array.isArray(DATASET_JOURNAL[datasetName])) {
    DATASET_JOURNAL[datasetName] = [];
  }

  const currentRecord = findRecord(DATASETS[datasetName], key);
  log.info('Current record', currentRecord);
  log.info('New record', { Key: key, Value: value });

  if (currentRecord && isEqual(deserialize(currentRecord.Value), value)) {
    return;
  }

  const updateOp = {
    Key: key,
    Value: serialize(value),
  };

  if (value === '' || value.length === 0 || value === null || typeof value === 'undefined') {
    updateOp.Op = 'remove';
  } else {
    updateOp.Op = 'replace';
  }

  if (typeof currentRecord === 'undefined' || !currentRecord.SyncCount) {
    updateOp.SyncCount = 0;
  } else {
    updateOp.SyncCount = currentRecord.SyncCount;
  }

  log.info('Writing to journal', updateOp);

  DATASET_JOURNAL[datasetName] = DATASET_JOURNAL[datasetName]
    .filter(item => item.Key !== updateOp.Key);
  DATASET_JOURNAL[datasetName].push(updateOp);

  DATASETS[datasetName] = DATASETS[datasetName].filter(item => item.Key !== updateOp.Key);
  DATASETS[datasetName] = [...DATASETS[datasetName], {
    Key: key,
    Value: serialize(value),
  }];
}

async function sync(datasetName: string) {
  if (!AWS.config.credentials) {
    throw new Error(`Cannot sync '${datasetName}' because AWS is not initialized yet`);
  }

  if (!client) {
    throw new Error(`Cannot sync '${datasetName}' because Cosyma is not init()-ed yet`);
  }

  const params = {
    DatasetName: datasetName,
    IdentityId: AWS.config.credentials.identityId,
    IdentityPoolId: IDENTITY_POOL_ID,
  };

  log.info('cognito params:', params);

  cacheStore({ DATASETS, DATASET_JOURNAL });

  DATASET_SYNC_STATUS[datasetName] = true;
  const response = await client.listRecords(params);
  SYNC_SESSION_TOKEN[datasetName] = response.SyncSessionToken;

  const result = updateRecords(datasetName);

  DATASET_SYNC_STATUS[datasetName] = false;

  return result;
}


// ~ request credentials from STS and init CognitoSync client
async function init(args : {
    identityId:?string,
    cognitoToken:?string,
    region:string,
    roleArn:string,
    identityPoolId:string,
    datasetsToSync:string[],
    onSTSAssumeRoleFailed:?Function,
  }) {
  const {
    identityId,
    cognitoToken,
    region,
    roleArn,
    identityPoolId,
    datasetsToSync,
    onSTSAssumeRoleFailed,
  } = args;

  const sts = new AWS.STS();
  const assumeRoleWithWebIdentity = promisify(sts.assumeRoleWithWebIdentity.bind(sts));

  AWS.config.region = region;
  IDENTITY_POOL_ID = identityPoolId;

  log.info('Cognito::init with tokens', identityId, cognitoToken);

  if (!identityId || !cognitoToken) {
    // Init Cognito as Unauthenticated
    AWS.config.credentials = new AWS.CognitoIdentityCredentials({
      IdentityPoolId: IDENTITY_POOL_ID,
    });
  } else {
    try {
      const response = await assumeRoleWithWebIdentity({
        RoleArn: roleArn,
        WebIdentityToken: cognitoToken,
        RoleSessionName: 'web',
      });

      const { Credentials } = response;
      AWS.config.update({
        accessKeyId: Credentials.AccessKeyId,
        secretAccessKey: Credentials.SecretAccessKey,
        sessionToken: Credentials.SessionToken,
      });

      const getCredentials = promisify(AWS.config.credentials.get).bind(AWS.config.credentials);
      await getCredentials();

      // The following two lines sets the requred properties for CognitoSyncManager
      // @see https://github.com/aws/amazon-cognito-js/blob/master/src/CognitoSyncManager.js
      AWS.config.credentials.identityId = identityId;
      AWS.config.credentials.params = { IdentityPoolId: IDENTITY_POOL_ID };

      createCognitoSyncClient();

      for (const datasetName of datasetsToSync) {
        const records = await listRecords(datasetName);
        log.info('Resulting records', records);
        DATASETS[datasetName] = records[0];
      }

      log.info('Completed initialization and sync; resulting datasets =', DATASETS);
    } catch (stsError) {
      log.error(`Error while initializing syncClient. STS Token might be expired.
        Error '${stsError.name}': '${stsError.message}'.`);
      if (onSTSAssumeRoleFailed && typeof onSTSAssumeRoleFailed === 'function') {
        onSTSAssumeRoleFailed(stsError);
      } else {
        throw stsError;
      }
    }
  }
}


export {
  restore,
  store,
  getValue,
  setValue,
  sync,
  init,
  log,
};
