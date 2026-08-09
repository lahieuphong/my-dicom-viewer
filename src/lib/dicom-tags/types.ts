export type DicomTagNodeKind = 'element' | 'item';

export type DicomTagNode = {
  id: string;
  kind: DicomTagNodeKind;
  tag: string;
  vr: string;
  keyword: string;
  value: string;
  children: DicomTagNode[];
  searchText: string;
};

export type DicomTagTree = {
  nodes: DicomTagNode[];
  elementCount: number;
  nodesTruncated: boolean;
  valuesTruncated: boolean;
};

export type DicomDictionaryEntry = {
  vr?: string;
  name?: string;
};

export type DicomDictionary = Record<string, DicomDictionaryEntry>;
