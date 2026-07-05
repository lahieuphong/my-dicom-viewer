// src/lib/cornerstone/annotations.ts
import { annotation as csAnnotation } from "@cornerstonejs/tools";

/**
 * Kiểm tra xem annotation có bị khóa hoặc là SR (Structured Report)
 * NOTE: We removed the persistent "lock" metadata mechanism. This check now
 * only uses toolName / runtime flags if provided by the annotation object.
 */
export function isAnnotationLockedOrSR(annotation: any): boolean {
  try {
    if (!annotation) return false;
    const toolName = annotation?.metadata?.toolName ?? annotation?.toolName ?? "";
    const isSR = toolName?.toLowerCase?.()?.includes?.("sr");
    const locked = Boolean(annotation?.isLocked || annotation?.locked);
    return locked || isSR;
  } catch {
    return false;
  }
}

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

/**
 * NO-OP ensureLockAnnotation
 *
 * Bạn đã yêu cầu bỏ hoàn toàn cơ chế "lock" annotation.
 * Để tránh thay đổi API chỗ khác đang import hàm này, chúng ta giữ một hàm trả về false
 * nhưng không thực hiện trigger hay set metadata nào.
 */
export function ensureLockAnnotation(_annotationUID: string): boolean {
  // Locking disabled intentionally.
  return false;
}
