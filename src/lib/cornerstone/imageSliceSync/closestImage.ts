// Framework-free: picking the slice of a stack nearest to a patient point.

/**
 * The index of the image whose position is nearest to `point` (Euclidean
 * distance in patient space), or -1 when no image has a position. Images
 * without a position are skipped; on a tie the first image wins.
 */
export function findClosestImageIndex(
  positions: Iterable<ArrayLike<number> | null | undefined>,
  point: ArrayLike<number>
): number {
  let closestIndex = -1;
  let closestDistance = Number.POSITIVE_INFINITY;
  let index = 0;
  for (const position of positions) {
    if (position && position.length === 3) {
      // The same arithmetic as gl-matrix's vec3.distance, so ties resolve
      // exactly as they did.
      const x = point[0] - position[0];
      const y = point[1] - position[1];
      const z = point[2] - position[2];
      const distance = Math.sqrt(x * x + y * y + z * z);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = index;
      }
    }
    index += 1;
  }
  return closestIndex;
}
