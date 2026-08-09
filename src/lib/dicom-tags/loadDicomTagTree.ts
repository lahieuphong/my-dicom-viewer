import wadouri from '@cornerstonejs/dicom-image-loader/wadouri';
import dicomParser from 'dicom-parser';
import type { DataSet } from 'dicom-parser';

import {
  buildDicomTagTree,
  createDicomDictionaryLookup,
} from './tagTree';
import type { DicomDictionary, DicomTagTree } from './types';

let dictionaryPromise: Promise<DicomDictionary> | null = null;

function loadDictionary(): Promise<DicomDictionary> {
  if (!dictionaryPromise) {
    dictionaryPromise = import('dcmjs')
      .then((module) => {
        const runtime = module.default ?? module;
        return runtime.data.DicomMetaDictionary.dictionary as DicomDictionary;
      })
      .catch((error) => {
        dictionaryPromise = null;
        throw error;
      });
  }
  return dictionaryPromise;
}

async function acquireDataSet(imageId: string): Promise<{
  dataSet: DataSet;
  release: () => void;
}> {
  const parsed = wadouri.parseImageId(imageId);
  const { dataSetCacheManager } = wadouri;
  const cached = dataSetCacheManager.get(parsed.url);
  if (cached) return { dataSet: cached, release: () => {} };

  const loader = wadouri.getLoaderForScheme(parsed.scheme);
  if (!loader) {
    throw new Error(`Unsupported DICOM image scheme: ${parsed.scheme}`);
  }

  const dataSet = (await dataSetCacheManager.load(
    parsed.url,
    loader,
    imageId
  )) as DataSet;
  let released = false;

  return {
    dataSet,
    release: () => {
      if (released) return;
      released = true;
      dataSetCacheManager.unload(parsed.url);
    },
  };
}

export async function loadDicomTagTree(imageId: string): Promise<DicomTagTree> {
  const acquired = await acquireDataSet(imageId);

  try {
    const dictionary = await loadDictionary();
    const dictionaryLookup = createDicomDictionaryLookup(dictionary);
    let dataSet = acquired.dataSet;

    // dicom-parser cannot identify known-length SQ elements in an implicit-VR
    // stream without a dictionary callback. Reparse the already loaded bytes
    // (never refetch) so nested metadata stays complete for implicit DICOMs.
    if (dataSet.string('x00020010') === '1.2.840.10008.1.2') {
      try {
        dataSet = dicomParser.parseDicom(dataSet.byteArray as Uint8Array, {
          vrCallback: ((rawTag: string) => {
            const vr = String(dictionaryLookup(rawTag)?.vr ?? '');
            // Lowercase dictionary values (xs/ox/lt/up) are pseudo VRs that
            // require dataset context; leave them undefined for the tree
            // serializer to resolve after parsing.
            return /^[A-Z]{2}$/.test(vr) ? vr : undefined;
          }) as unknown as (tag: string) => void,
        });
      } catch {
        // The loader's parsed dataset is still safe to inspect when a malformed
        // implicit stream cannot be reparsed with dictionary VRs.
      }
    }

    return buildDicomTagTree(dataSet, dictionary);
  } finally {
    acquired.release();
  }
}
