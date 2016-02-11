
import {
  serialize,
  deserialize,
} from './utils';


export function cacheStore({ DATASETS, DATASET_JOURNAL }) {
  localStorage['cognitosyncmgr-DATASETS'] = serialize(DATASETS);
  localStorage['cognitosyncmgr-DATASET_JOURNAL'] = serialize(DATASET_JOURNAL);
}


export function cacheRestore():Object {
  let DATASETS;
  let DATASET_JOURNAL;

  if (typeof deserialize(localStorage['cognitosyncmgr-DATASETS']) === 'object') {
    DATASETS = { ...DATASETS, ...deserialize(localStorage['cognitosyncmgr-DATASETS']) };
  }

  if (typeof deserialize(localStorage['cognitosyncmgr-DATASET_JOURNAL']) === 'object') {
    DATASET_JOURNAL = {
      ...DATASET_JOURNAL,
      ...deserialize(localStorage['cognitosyncmgr-DATASET_JOURNAL']),
    };
  }

  return { DATASETS, DATASET_JOURNAL };
}
