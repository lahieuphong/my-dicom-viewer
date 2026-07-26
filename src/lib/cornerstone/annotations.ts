// src/lib/cornerstone/annotations.ts
import { annotation as csAnnotation } from '@cornerstonejs/tools';

/**
 * Chờ một annotation có annotationUID xuất hiện trong csAnnotation.state
 * Dùng trong trường hợp Cornerstone load annotation bất đồng bộ
 */
export async function ensureAnnotationAvailable(
  annotationUID: string,
  timeout = 2000,
  interval = 100
): Promise<any | null> {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    try {
      const found = csAnnotation.state.getAnnotation?.(annotationUID);
      if (found) return found;
    } catch {
      // ignore
    }
    await new Promise((r) => setTimeout(r, interval));
  }

  return null;
}
