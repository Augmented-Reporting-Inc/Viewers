/**
 * Stable viewer authoring order and unique persisted question identity.
 * Question keys also identify saved rubric and measurement evidence.
 */
export function validateAndOrderAuthoringQuestions<T extends {
  questionKey?: string; sortOrder?: number;
}>(questions: T[]): T[] {
  const list = Array.isArray(questions) ? questions : [];
  const keys = list.map(item => String(item?.questionKey || '').trim());
  if (keys.some(key => !key) || new Set(keys).size !== keys.length) {
    throw new Error(
      'The saved quiz contains duplicated or missing question identifiers. ' +
      'Return to Manage Quiz to repair the draft; viewer authoring is disabled ' +
      'to protect existing TR Vmax and other gold answers.'
    );
  }
  return list.map((question, index) => ({ question, index }))
    .sort((a, b) => {
      const left = Number(a.question.sortOrder);
      const right = Number(b.question.sortOrder);
      const l = Number.isFinite(left) && left > 0 ? left : a.index + 1;
      const r = Number.isFinite(right) && right > 0 ? right : b.index + 1;
      return l - r || a.index - b.index;
    }).map(entry => entry.question);
}
