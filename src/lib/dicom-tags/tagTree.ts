import dicomParser from 'dicom-parser';
import type { DataSet, Element } from 'dicom-parser';

import type {
  DicomDictionary,
  DicomDictionaryEntry,
  DicomTagNode,
  DicomTagTree,
} from './types';

const MAX_TREE_DEPTH = 16;
const MAX_TREE_NODES = 10_000;
const MAX_TEXT_BYTES_TO_DECODE = 64 * 1024;
const MAX_TOTAL_TEXT_BYTES_TO_DECODE = 4 * 1024 * 1024;
const MAX_NUMERIC_BYTES_TO_DECODE = 8 * 1024;
const BINARY_VRS = new Set(['OB', 'OD', 'OF', 'OL', 'OV', 'OW', 'UN']);
const TEXT_VRS = new Set([
  'AE',
  'AS',
  'CS',
  'DA',
  'DS',
  'DT',
  'IS',
  'LO',
  'LT',
  'PN',
  'SH',
  'ST',
  'TM',
  'UC',
  'UI',
  'UR',
  'UT',
]);

type DicomDictionaryRangeEntry = {
  groupStart: number;
  groupEnd: number;
  elementStart: number;
  elementEnd: number;
  entry: DicomDictionaryEntry;
};

export type DicomDictionaryLookup = (
  rawTag: string
) => DicomDictionaryEntry | undefined;

const dictionaryRangeCache = new WeakMap<
  DicomDictionary,
  readonly DicomDictionaryRangeEntry[]
>();

function formatTag(rawTag: string): string {
  const compact = rawTag.replace(/^x/i, '').replace(/[^0-9a-f]/gi, '');
  if (compact.length !== 8) return rawTag.toUpperCase();
  return `(${compact.slice(0, 4).toUpperCase()},${compact
    .slice(4)
    .toUpperCase()})`;
}

function normalizeVr(vr: string | undefined): string {
  const normalized = String(vr ?? '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(normalized) ? normalized : '';
}

function resolveVr(
  dataSet: DataSet,
  element: Element,
  dictionaryVr: string | undefined,
  context: VrContext
): string {
  const explicitVr = normalizeVr(element.vr);
  if (explicitVr) return explicitVr;

  const rawDictionaryVr = String(dictionaryVr ?? '').trim();
  const pseudoVr = rawDictionaryVr.toLocaleLowerCase();
  if (pseudoVr === 'xs') {
    const pixelRepresentation =
      dataSet.uint16('x00280103') ?? context.pixelRepresentation;
    return pixelRepresentation === 1 ? 'SS' : 'US';
  }
  if (pseudoVr === 'ox') {
    const bitsAllocated = dataSet.uint16('x00280100') ?? context.bitsAllocated;
    return (bitsAllocated ?? 16) <= 8 ? 'OB' : 'OW';
  }
  // dcmjs uses the pseudo VR `lt` for LUT Data (0028,3006), whose
  // context-dependent standard VR is US or OW. OW is the safe implicit-VR
  // representation and prevents binary LUT bytes from being shown as text.
  if (pseudoVr === 'lt') return 'OW';
  if (pseudoVr === 'up') return 'UL';

  return normalizeVr(rawDictionaryVr) || 'UN';
}

function isPrivateTag(rawTag: string): boolean {
  const compact = rawTag.replace(/^x/i, '').replace(/[^0-9a-f]/gi, '');
  if (!/^[0-9a-f]{8}$/i.test(compact)) return false;
  return Number.parseInt(compact.slice(0, 4), 16) % 2 === 1;
}

export function createDicomDictionaryLookup(
  dictionary: DicomDictionary
): DicomDictionaryLookup {
  let ranges = dictionaryRangeCache.get(dictionary);
  if (!ranges) {
    ranges = Object.entries(dictionary).flatMap(([pattern, entry]) => {
      const match = pattern.match(
        /^\(([0-9A-F]{4})(?:-([0-9A-F]{4}))?,([0-9A-F]{4})(?:-([0-9A-F]{4}))?\)$/i
      );
      if (!match || (!match[2] && !match[4])) return [];

      return [{
        groupStart: Number.parseInt(match[1], 16),
        groupEnd: Number.parseInt(match[2] ?? match[1], 16),
        elementStart: Number.parseInt(match[3], 16),
        elementEnd: Number.parseInt(match[4] ?? match[3], 16),
        entry,
      }];
    });
    dictionaryRangeCache.set(dictionary, ranges);
  }

  return (rawTag) => {
    const formattedTag = formatTag(rawTag);
    const exact = dictionary[formattedTag];
    if (exact) return exact;
    // Odd groups are private. Never apply a broad standard repeating-group
    // pattern to a private creator/data element.
    if (isPrivateTag(rawTag)) return undefined;

    const compact = rawTag.replace(/^x/i, '').replace(/[^0-9a-f]/gi, '');
    if (compact.length !== 8) return undefined;
    const group = Number.parseInt(compact.slice(0, 4), 16);
    const element = Number.parseInt(compact.slice(4), 16);

    return ranges?.find(
      (candidate) =>
        group >= candidate.groupStart &&
        group <= candidate.groupEnd &&
        element >= candidate.elementStart &&
        element <= candidate.elementEnd
    )?.entry;
  };
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function sanitizeValue(value: string): string {
  return value
    .replace(/\0/g, '')
    .replace(/\r\n?|\n/g, ' ↵ ')
    .trim();
}

function formatPersonName(value: string): string {
  return value
    .split('\\')
    .map((personName) => personName.split('=')[0] ?? '')
    .join('\\');
}

type TextEncoding = {
  label: string;
  convertIso2022ToEightBit: boolean;
};

type ValueDecodeBudget = {
  remaining: number;
  truncated: boolean;
};

type VrContext = {
  bitsAllocated?: number;
  pixelRepresentation?: number;
};

function resolveTextEncoding(
  dataSet: DataSet,
  inheritedEncoding: TextEncoding = {
    label: 'iso-8859-1',
    convertIso2022ToEightBit: false,
  }
): TextEncoding {
  if (!dataSet.elements.x00080005) return inheritedEncoding;

  const characterSets = String(dataSet.string('x00080005') ?? '')
    .split('\\')
    .map((value) => value.trim().toUpperCase());

  if (characterSets.includes('ISO_IR 192')) {
    return { label: 'utf-8', convertIso2022ToEightBit: false };
  }
  if (characterSets.includes('GB18030')) {
    return { label: 'gb18030', convertIso2022ToEightBit: false };
  }
  if (characterSets.includes('GBK')) {
    return { label: 'gbk', convertIso2022ToEightBit: false };
  }
  if (characterSets.some((value) => value.includes('IR 149'))) {
    return { label: 'euc-kr', convertIso2022ToEightBit: true };
  }
  if (characterSets.some((value) => value.includes('IR 58'))) {
    return { label: 'gb18030', convertIso2022ToEightBit: true };
  }
  if (characterSets.some((value) => value.includes('IR 87'))) {
    return { label: 'iso-2022-jp', convertIso2022ToEightBit: false };
  }
  if (characterSets.some((value) => value.includes('IR 13'))) {
    return {
      label: 'shift_jis',
      convertIso2022ToEightBit: characterSets.some((value) =>
        value.startsWith('ISO 2022')
      ),
    };
  }

  const primary =
    characterSets.find(
      (value) => value && value !== 'ISO_IR 6' && value !== 'ISO 2022 IR 6'
    ) ?? characterSets[0];
  const singleByteEncodings: Record<string, string> = {
    'ISO_IR 100': 'iso-8859-1',
    'ISO 2022 IR 100': 'iso-8859-1',
    'ISO_IR 101': 'iso-8859-2',
    'ISO 2022 IR 101': 'iso-8859-2',
    'ISO_IR 109': 'iso-8859-3',
    'ISO 2022 IR 109': 'iso-8859-3',
    'ISO_IR 110': 'iso-8859-4',
    'ISO 2022 IR 110': 'iso-8859-4',
    'ISO_IR 144': 'iso-8859-5',
    'ISO 2022 IR 144': 'iso-8859-5',
    'ISO_IR 127': 'iso-8859-6',
    'ISO 2022 IR 127': 'iso-8859-6',
    'ISO_IR 126': 'iso-8859-7',
    'ISO 2022 IR 126': 'iso-8859-7',
    'ISO_IR 138': 'iso-8859-8',
    'ISO 2022 IR 138': 'iso-8859-8',
    'ISO_IR 148': 'iso-8859-9',
    'ISO 2022 IR 148': 'iso-8859-9',
    'ISO_IR 166': 'windows-874',
    'ISO 2022 IR 166': 'windows-874',
  };

  const label = singleByteEncodings[primary];
  return label
    ? {
        label,
        convertIso2022ToEightBit: characterSets.some((value) =>
          value.startsWith('ISO 2022')
        ),
      }
    : inheritedEncoding;
}

function convertIso2022ToEightBit(bytes: Uint8Array): Uint8Array {
  const converted: number[] = [];
  let shifted = false;

  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index];
    if (byte === 0x1b) {
      // Skip an ISO-2022 designation sequence. The following SO/SI bytes
      // select between the designated multibyte set and ASCII.
      while (index + 1 < bytes.length) {
        index += 1;
        const designationByte = bytes[index];
        if (designationByte >= 0x40 && designationByte <= 0x7e) break;
      }
      continue;
    }
    if (byte === 0x0e) {
      shifted = true;
      continue;
    }
    if (byte === 0x0f) {
      shifted = false;
      continue;
    }

    converted.push(shifted && byte >= 0x21 && byte <= 0x7e ? byte | 0x80 : byte);
  }

  return Uint8Array.from(converted);
}

function decodeTextElement(
  dataSet: DataSet,
  element: Element,
  encoding: TextEncoding,
  budget: ValueDecodeBudget
): string {
  const availableBytes = Math.max(
    0,
    Math.min(element.length, dataSet.byteArray.length - element.dataOffset)
  );
  const decodedBytes = Math.min(
    availableBytes,
    MAX_TEXT_BYTES_TO_DECODE,
    budget.remaining
  );
  if (decodedBytes <= 0) {
    budget.truncated = true;
    return `[Văn bản đã giới hạn • ${formatBytes(availableBytes)}]`;
  }
  budget.remaining -= decodedBytes;
  const bytes = new Uint8Array(
    dataSet.byteArray.buffer,
    dataSet.byteArray.byteOffset + element.dataOffset,
    decodedBytes
  );

  let value: string;
  try {
    value = new TextDecoder(encoding.label).decode(
      encoding.convertIso2022ToEightBit
        ? convertIso2022ToEightBit(bytes)
        : bytes
    );
  } catch {
    value = new TextDecoder('iso-8859-1').decode(bytes);
  }

  const sanitized = sanitizeValue(value);
  if (availableBytes <= decodedBytes) return sanitized;
  budget.truncated = true;
  return `${sanitized}… [đã giới hạn, tổng ${formatBytes(availableBytes)}]`;
}

function readInt64Values(
  dataSet: DataSet,
  element: Element,
  signed: boolean
): string {
  const count = Math.floor(element.length / 8);
  const byteArray = dataSet.byteArray;
  const view = new DataView(
    byteArray.buffer,
    byteArray.byteOffset + element.dataOffset,
    count * 8
  );
  const littleEndian =
    dataSet.byteArrayParser === dicomParser.littleEndianByteArrayParser;
  const values: string[] = [];

  for (let index = 0; index < count; index += 1) {
    const offset = index * 8;
    values.push(
      (signed
        ? view.getBigInt64(offset, littleEndian)
        : view.getBigUint64(offset, littleEndian)
      ).toString()
    );
  }

  return values.join('\\');
}

function readAttributeTagValues(dataSet: DataSet, element: Element): string {
  const count = Math.floor(element.length / 4);
  const byteArray = dataSet.byteArray;
  const view = new DataView(
    byteArray.buffer,
    byteArray.byteOffset + element.dataOffset,
    count * 4
  );
  const littleEndian =
    dataSet.byteArrayParser === dicomParser.littleEndianByteArrayParser;
  const values: string[] = [];

  for (let index = 0; index < count; index += 1) {
    const offset = index * 4;
    const group = view.getUint16(offset, littleEndian);
    const elementNumber = view.getUint16(offset + 2, littleEndian);
    values.push(
      `(${group.toString(16).padStart(4, '0').toUpperCase()},${elementNumber
        .toString(16)
        .padStart(4, '0')
        .toUpperCase()})`
    );
  }

  return values.join('\\');
}

function readElementValue(
  dataSet: DataSet,
  element: Element,
  vr: string,
  textEncoding: TextEncoding,
  valueBudget: ValueDecodeBudget
): string {
  if (element.length === 0) return '';
  if (vr === 'SQ' || element.items) return '';

  if (BINARY_VRS.has(vr) || element.encapsulatedPixelData) {
    return `[Dữ liệu nhị phân • ${formatBytes(element.length)}]`;
  }

  try {
    if (TEXT_VRS.has(vr)) {
      let textValue = decodeTextElement(
        dataSet,
        element,
        textEncoding,
        valueBudget
      );
      if (vr === 'PN') textValue = formatPersonName(textValue);
      return textValue;
    }

    if (
      element.length > MAX_NUMERIC_BYTES_TO_DECODE ||
      element.length > valueBudget.remaining
    ) {
      valueBudget.truncated = true;
      return `[Dữ liệu số • ${formatBytes(element.length)}]`;
    }
    valueBudget.remaining -= element.length;

    if (vr === 'SV' || vr === 'UV') {
      return readInt64Values(dataSet, element, vr === 'SV');
    }
    if (vr === 'AT') return readAttributeTagValues(dataSet, element);

    const elementWithVr = element.vr ? element : { ...element, vr };
    let value = dicomParser.explicitElementToString(dataSet, elementWithVr);
    if (['US', 'SS', 'UL', 'SL', 'FD', 'FL'].includes(vr)) {
      value = value.replaceAll('/', '\\');
    }
    return sanitizeValue(value);
  } catch {
    // Some implicit/private VRs cannot be converted safely. Never expose the
    // underlying byte buffer in the browser UI.
    return `[Dữ liệu • ${formatBytes(element.length)}]`;
  }
}

function makeSearchText(node: Omit<DicomTagNode, 'searchText'>): string {
  return [
    node.tag,
    node.tag.replace(/[^0-9a-f]/gi, ''),
    node.vr,
    node.keyword,
    node.value,
  ]
    .join('\n')
    .normalize('NFC')
    .toLowerCase();
}

export function buildDicomTagTree(
  dataSet: DataSet,
  dictionary: DicomDictionary
): DicomTagTree {
  let elementCount = 0;
  let nodeCount = 0;
  let truncated = false;
  const dictionaryLookup = createDicomDictionaryLookup(dictionary);
  const valueBudget: ValueDecodeBudget = {
    remaining: MAX_TOTAL_TEXT_BYTES_TO_DECODE,
    truncated: false,
  };

  const visitDataSet = (
    currentDataSet: DataSet,
    path: string,
    depth: number,
    inheritedTextEncoding: TextEncoding,
    inheritedVrContext: VrContext
  ): DicomTagNode[] => {
    if (depth > MAX_TREE_DEPTH || nodeCount >= MAX_TREE_NODES) {
      truncated = true;
      return [];
    }

    const nodes: DicomTagNode[] = [];
    // A sequence item inherits its parent's Specific Character Set unless the
    // encapsulated Data Set explicitly overrides (0008,0005).
    const textEncoding = resolveTextEncoding(
      currentDataSet,
      inheritedTextEncoding
    );
    const vrContext: VrContext = {
      bitsAllocated:
        currentDataSet.uint16('x00280100') ?? inheritedVrContext.bitsAllocated,
      pixelRepresentation:
        currentDataSet.uint16('x00280103') ??
        inheritedVrContext.pixelRepresentation,
    };
    const elements = Object.values(currentDataSet.elements).sort((left, right) =>
      left.tag.localeCompare(right.tag)
    );

    for (const element of elements) {
      if (nodeCount >= MAX_TREE_NODES) {
        truncated = true;
        break;
      }

      elementCount += 1;
      nodeCount += 1;
      const entry = dictionaryLookup(element.tag);
      const vr = resolveVr(currentDataSet, element, entry?.vr, vrContext);
      const id = `${path}/${element.tag}`;
      const children: DicomTagNode[] = [];

      if (element.items && depth < MAX_TREE_DEPTH) {
        for (let itemIndex = 0; itemIndex < element.items.length; itemIndex += 1) {
          if (nodeCount >= MAX_TREE_NODES) {
            truncated = true;
            break;
          }

          const item = element.items[itemIndex];
          nodeCount += 1;
          const itemId = `${id}/item-${itemIndex}`;
          const itemChildren = item.dataSet
            ? visitDataSet(
                item.dataSet,
                itemId,
                depth + 2,
                textEncoding,
                vrContext
              )
            : [];
          const itemNodeWithoutSearch: Omit<DicomTagNode, 'searchText'> = {
            id: itemId,
            kind: 'item',
            tag: '(FFFE,E000)',
            vr: '',
            keyword: `Item #${itemIndex}`,
            value: '',
            children: itemChildren,
          };
          children.push({
            ...itemNodeWithoutSearch,
            searchText: makeSearchText(itemNodeWithoutSearch),
          });
        }
      } else if (element.items && depth >= MAX_TREE_DEPTH) {
        truncated = true;
      }

      const nodeWithoutSearch: Omit<DicomTagNode, 'searchText'> = {
        id,
        kind: 'element',
        tag: formatTag(element.tag),
        vr,
        keyword:
          entry?.name?.replace(/^RETIRED_/, '') ||
          (isPrivateTag(element.tag) ? 'Private Tag' : 'Unknown Tag'),
        value: readElementValue(
          currentDataSet,
          element,
          vr,
          textEncoding,
          valueBudget
        ),
        children,
      };
      nodes.push({
        ...nodeWithoutSearch,
        searchText: makeSearchText(nodeWithoutSearch),
      });
    }

    return nodes;
  };

  return {
    nodes: visitDataSet(dataSet, 'root', 0, {
      label: 'iso-8859-1',
      convertIso2022ToEightBit: false,
    }, {}),
    elementCount,
    nodesTruncated: truncated,
    valuesTruncated: valueBudget.truncated,
  };
}

export function filterDicomTagTree(
  nodes: readonly DicomTagNode[],
  query: string
): DicomTagNode[] {
  const normalizedQuery = query.trim().normalize('NFC').toLowerCase();
  if (!normalizedQuery) return nodes as DicomTagNode[];

  const filterNodes = (currentNodes: readonly DicomTagNode[]): DicomTagNode[] => {
    const matches: DicomTagNode[] = [];

    for (const node of currentNodes) {
      const selfMatches =
        node.searchText.includes(normalizedQuery);
      const matchingChildren = filterNodes(node.children);
      if (!selfMatches && matchingChildren.length === 0) continue;

      matches.push({
        ...node,
        // A matching sequence/item keeps its context; a descendant match keeps
        // only the matching branch and its ancestors.
        children: selfMatches ? node.children : matchingChildren,
      });
    }

    return matches;
  };

  return filterNodes(nodes);
}
