// Stand-in for @cornerstonejs/tools in unit tests. Tests fill
// `registeredAnnotations` to stand for Cornerstone's annotation state.
export const registeredAnnotations = new Map();

export const annotation = {
  state: {
    getAnnotation: (annotationUID) => registeredAnnotations.get(annotationUID),
  },
};

export const Enums = {
  Events: {
    ANNOTATION_ADDED: 'ANNOTATION_ADDED',
  },
};
