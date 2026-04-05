function isValidIndex(index, itemCount) {
  return Number.isInteger(index) && index >= 0 && index < itemCount;
}

function buildRangeIndexes(start, end, isSelectable) {
  const indexes = [];

  for (let index = start; index <= end; index += 1) {
    if (isSelectable(index)) {
      indexes.push(index);
    }
  }

  return indexes;
}

export function resolveShiftSelection(options) {
  const {
    anchorIndex,
    currentIndex,
    itemCount,
    nextChecked,
    useRange,
    isSelectable = () => true,
  } = options;

  if (!isValidIndex(currentIndex, itemCount)) {
    return { indexes: [], nextChecked, nextAnchorIndex: null, usedRange: false };
  }

  const canUseRange = useRange && isValidIndex(anchorIndex, itemCount);

  if (!canUseRange) {
    return { indexes: [currentIndex], nextChecked, nextAnchorIndex: currentIndex, usedRange: false };
  }

  const start = Math.min(anchorIndex, currentIndex);
  const end = Math.max(anchorIndex, currentIndex);
  const indexes = buildRangeIndexes(start, end, isSelectable);

  return { indexes, nextChecked, nextAnchorIndex: currentIndex, usedRange: true };
}
