export const DEFAULT_EXTENSION_ID = 'default' as const;

export type DefaultExtensionManifest = Readonly<{
  id: typeof DEFAULT_EXTENSION_ID;
  layout: 'viewer-workspace';
  toolbar: 'viewer-toolbar';
  panels: readonly ['series', 'measurements'];
}>;

/**
 * Static description of the current viewer UI extension.
 *
 * This is intentionally metadata-only. The existing components remain the
 * implementation source of truth while callers get a stable extension ID.
 */
export const defaultExtension: DefaultExtensionManifest = Object.freeze({
  id: DEFAULT_EXTENSION_ID,
  layout: 'viewer-workspace',
  toolbar: 'viewer-toolbar',
  panels: ['series', 'measurements'] as const,
});
