function diffWords(before, after) {
  const left = String(before || "").split(/(\s+)/);
  const right = String(after || "").split(/(\s+)/);
  const matrix = Array.from({ length: left.length + 1 }, () => Array(right.length + 1).fill(0));
  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      matrix[i][j] = left[i - 1] === right[j - 1]
        ? matrix[i - 1][j - 1] + 1
        : Math.max(matrix[i - 1][j], matrix[i][j - 1]);
    }
  }
  const parts = [];
  let i = left.length;
  let j = right.length;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && left[i - 1] === right[j - 1]) {
      parts.unshift({ type: "equal", value: left[i - 1] });
      i -= 1;
      j -= 1;
    } else if (j > 0 && (i === 0 || matrix[i][j - 1] >= matrix[i - 1][j])) {
      parts.unshift({ type: "added", value: right[j - 1] });
      j -= 1;
    } else {
      parts.unshift({ type: "removed", value: left[i - 1] });
      i -= 1;
    }
  }
  return parts;
}

function summarizeChange(before, after) {
  const parts = diffWords(before, after);
  const added = parts.filter(part => part.type === "added" && part.value.trim()).length;
  const removed = parts.filter(part => part.type === "removed" && part.value.trim()).length;
  if (!added && !removed) return "No textual changes";
  return `${added} words added, ${removed} words removed`;
}

function isMeaningfulChange(before, after, { minChars = 12 } = {}) {
  const left = String(before || "").trim();
  const right = String(after || "").trim();
  if (left === right) return false;
  return Math.abs(left.length - right.length) >= minChars || left !== right;
}

module.exports = { diffWords, summarizeChange, isMeaningfulChange };
