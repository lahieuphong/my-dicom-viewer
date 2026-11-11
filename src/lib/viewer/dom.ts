// src/lib/viewer/dom.ts

'use client';

import { normalizeImageId as normalizeImageIdFromHelpers } from '@/lib/cornerstone/helpers';

/**
 * Re-export canonical normalizer from shared helper so callers can continue
 * importing from '@/lib/viewer/dom' without having to change paths.
 *
 * This avoids duplicate implementations across the codebase.
 */
export const normalizeId = normalizeImageIdFromHelpers;
export const normalizeImageId = normalizeImageIdFromHelpers;
