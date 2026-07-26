'use client';

const EXPLICIT_VR_LITTLE_ENDIAN = '1.2.840.10008.1.2.1';

async function getDcmjs(): Promise<any> {
  const module = await import('dcmjs');
  return (module as any).default ?? module;
}

function readTransferSyntaxUID(dataset: any): string {
  const fromMeta = dataset?._meta?.TransferSyntaxUID;
  if (typeof fromMeta === 'string') return fromMeta;
  if (Array.isArray(fromMeta?.Value) && fromMeta.Value[0]) {
    return fromMeta.Value[0];
  }
  return dataset?.TransferSyntaxUID || EXPLICIT_VR_LITTLE_ENDIAN;
}

/**
 * Convert a naturalized dcmjs dataset into a real DICOM Part 10 file.
 *
 * Setting the transfer syntax by its hexadecimal tag avoids dcmjs writing a
 * malformed group-0002 element when a naturalized key is used in file meta.
 */
export async function datasetToDicomPart10Blob(dataset: any): Promise<Blob> {
  const dcmjs = await getDcmjs();
  const transferSyntaxUID = readTransferSyntaxUID(dataset);
  const dicomDict = dcmjs.data.datasetToDict(dataset);

  if (dicomDict?.meta) {
    dicomDict.meta['00020010'] = {
      vr: 'UI',
      Value: [transferSyntaxUID],
    };
  }

  const buffer = dicomDict.write({
    allowInvalidVRLength: false,
    fragmentMultiframe: false,
  });

  return new Blob([buffer], { type: 'application/dicom' });
}
