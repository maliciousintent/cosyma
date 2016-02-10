/* global AWS */

import promisify from 'es6-promisify';
import logger from 'loglevel';
export const log = logger.getLogger('cognitoSyncManager');
log.setDefaultLevel('WARN');

export type AnySerializableValue = Object|string|boolean|number;

export let client;

export function serialize(value: AnySerializableValue): string {
  return JSON.stringify(value);
}

export function deserialize(value: ?string): ?AnySerializableValue {
  if (typeof value === 'undefined') {
    return undefined;
  }

  try {
    log.debug('Deserializing', value);
    return JSON.parse(value);
  } catch (e) {
    log.debug(`Deserializing value of type '${typeof value}' failed with message
      '${e.message}'. Data might be empty, invalid or corrupted.`);
    return undefined;
  }
}

export function createCognitoSyncClient() {
  return new Promise((resolve, reject) => {
    if (!AWS.config.credentials) {
      return reject(new Error(`AWS credentials are not loaded yet.
        Check that credentials.get is called at least once before this`));
    }

    if (client) {
      log.warn(`CognitoSync client is already initialized, overwriting previous instance`);
    }

    client = new AWS.CognitoSync({ apiVersion: '2014-06-30' });
    client.listRecords = promisify(client.listRecords.bind(client));
    client.updateRecords = promisify(client.updateRecords.bind(client));
    resolve();
  });
}

export function findRecord(where: Array, key: string):?Object {
  return where.filter(record => record.Key === key)[0];
}
