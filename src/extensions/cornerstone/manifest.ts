export const CORNERSTONE_EXTENSION_ID = 'cornerstone' as const;

export type CornerstoneExtensionManifest = Readonly<{
  id: typeof CORNERSTONE_EXTENSION_ID;
  capabilities: readonly [
    'bootstrap',
    'stack-viewport',
    'tools',
    'measurements',
  ];
}>;

/** Metadata for the compatibility facade around the current Cornerstone code. */
export const cornerstoneExtension: CornerstoneExtensionManifest = Object.freeze({
  id: CORNERSTONE_EXTENSION_ID,
  capabilities: [
    'bootstrap',
    'stack-viewport',
    'tools',
    'measurements',
  ] as const,
});
